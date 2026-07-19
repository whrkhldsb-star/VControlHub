import { JobStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
  pruneCompletedJobsByType,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import { recordTaskRun } from "./service";

const logger = createLogger("scheduled-task-worker");

// TR-001 (T10): scheduled-task worker migrated to the durable jobs table so
// the actual dispatch work survives process restarts and can be observed via
// the same JobStatus / heartbeat / failJob paths as the other durable workers
// (alert-worker, quick-service-job-worker, backup-job-worker, sftp-sync-job).
export const SCHEDULED_TASK_TICK_JOB_TYPE = "scheduled-task.tick";

const SCHEDULED_TASK_INTERVAL_MS = 60_000;
// TR-002 R2: 跨 worker lease 公式统一。computeLeaseMs 默认返 preset (= SCHEDULED_TASK_LEASE_MS 等同原值)。
const SCHEDULED_TASK_LEASE_MS = computeLeaseMs("scheduled-task");
const SCHEDULED_TASK_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:scheduled-task:${process.pid}`;
// Minute ticks without retention were ~48k completed rows and growing.
const SCHEDULED_TASK_TICK_KEEP_LATEST = 50;
const SCHEDULED_TASK_TICK_RETENTION_DAYS = 3;

type ScheduledTaskWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type ScheduledTaskWorkerGlobal = typeof globalThis & {
  __vcontrolhubScheduledTaskWorker?: ScheduledTaskWorkerState;
};

function getWorkerState() {
  const globalState = globalThis as ScheduledTaskWorkerGlobal;
  globalState.__vcontrolhubScheduledTaskWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubScheduledTaskWorker;
}

async function hasActiveScheduledTaskTickJob(tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const existing = await client.job.findFirst({
    where: {
      type: SCHEDULED_TASK_TICK_JOB_TYPE,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function enqueueScheduledTaskTickJob(reason: string) {
  // New-B (2026-06-15): the previous "findFirst then enqueue" pair was a
  // textbook read-then-write race — in a multi-process / cluster deploy
  // (or even with two short-overlapping `tsx src/server.ts` invocations
  // during a systemd restart) both workers could observe "no active tick
  // job" simultaneously and each enqueue their own, leading to two
  // parallel `scheduled-task.tick` jobs that each dispatch every due task
  // twice.
  //
  // We now run the existence check + enqueue inside a single Prisma
  // transaction so PostgreSQL's MVCC + the implicit row locks serialise
  // the two halves. The loser's findFirst then sees the winner's enqueued
  // row and returns early. The in-process `state.running` guard is no
  // longer the only safety net.
  try {
    return await prisma.$transaction(async (tx) => {
      if (await hasActiveScheduledTaskTickJob(tx)) return null;
      return enqueueJob({
        type: SCHEDULED_TASK_TICK_JOB_TYPE,
        title: "Scheduled task dispatch tick",
        payload: { reason, requestedAt: new Date().toISOString() },
        priority: -5,
        maxAttempts: 3,
      });
    });
  } catch (error) {
    // Belt-and-braces guard for cluster deployments that share the DB:
    // if PostgreSQL aborts the transaction with a serialisation error
    // (because another worker just committed its enqueue), treat it the
    // same as "an active job exists" and bail.
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("could not serialize") ||
      message.includes("deadlock detected") ||
      message.includes("conflict")
    ) {
      logger.warn(
        "Skipping scheduled-task tick enqueue because of a serialisation conflict",
        { reason, error: message },
      );
      return null;
    }
    throw error;
  }
}

async function dispatchDueTask(task: {
  id: string;
  name: string;
  command: string;
  reason: string | null;
  serverIds: string[];
  createdById: string | null;
  nextRunAt: Date | null;
  /** Propagate parent ScheduledTask.teamId so the spawned CommandRequest is not global (null = shared). */
  teamId: string | null;
}): Promise<boolean> {
  if (task.serverIds.length === 0 || !task.createdById) {
    await recordTaskRun(task.id, "Skipped: no target server or no creator");
    return false;
  }

  // New-B (2026-06-15): row-level CAS so two workers that both observed
  // the same `dueTasks` list (via findMany) cannot both call
  // createCommandRequest for the same ScheduledTask. We race an
  // updateMany with the original `nextRunAt` pinned — the loser sees
  // count === 0 and bails. The CAS advances `nextRunAt` to a far-future
  // sentinel so the row is also invisible to subsequent findMany calls
  // in this tick; recordTaskRun (called below on success) will recompute
  // the real next cron firing time and persist it as the final state.
  const claimSentinel = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const claim = await prisma.scheduledTask.updateMany({
    where: {
      id: task.id,
      status: "ACTIVE",
      nextRunAt: task.nextRunAt,
    },
    data: { nextRunAt: claimSentinel },
  });
  if (claim.count === 0) {
    // Another worker already claimed this row. Skip silently — the
    // winner will record its own run and recompute nextRunAt; we don't
    // want a noisy duplicate dispatch.
    logger.info(
      "Scheduled task already claimed by another worker, skipping duplicate dispatch",
      { taskId: task.id, taskName: task.name },
    );
    return false;
  }

  try {
    // System worker has no session: stamp teamId from the parent task so
    // listCommandRequests(teamWhere) does not treat the request as shared null-team.
    const result = await createCommandRequest({
      title: `Scheduled task: ${task.name}`,
      command: task.command,
      reason: task.reason ?? `Triggered by scheduled task ${task.name}`,
      submissionMode: "user",
      requesterId: task.createdById,
      serverIds: task.serverIds,
      teamId: task.teamId,
    });

    await recordTaskRun(task.id, `Triggered command request ${result.id}`);
    return true;
  } catch (error) {
    // We claimed the row (so no one else will dispatch it this tick),
    // but createCommandRequest still failed. Roll our claim back so a
    // future tick or operator can retry, and let the outer dispatch
    // loop log the failure via recordTaskRun("执行失败: ...").
    logger.error(
      "Scheduled task CAS claimed but createCommandRequest failed; rolling claim back",
      { taskId: task.id, error: error instanceof Error ? error.message : String(error) },
    );
    try {
      await prisma.scheduledTask.update({
        where: { id: task.id },
        data: { nextRunAt: task.nextRunAt },
      });
    } catch (rollbackError) {
      logger.error(
        "Failed to roll back the scheduled-task CAS claim after dispatch error",
        {
          taskId: task.id,
          error:
            rollbackError instanceof Error
              ? rollbackError.message
              : String(rollbackError),
        },
      );
    }
    throw error;
  }
}

async function dispatchDueScheduledTasks(reason: string) {
  const dueTasks = await prisma.scheduledTask.findMany({
    where: {
      status: "ACTIVE",
      nextRunAt: { not: null, lte: new Date() },
    },
    take: 500, // P2: 单 tick due 任务数,>500 即异常
  });

  // New-B (2026-06-15): only count tasks that actually went through
  // createCommandRequest (CAS won + downstream succeeded). Skipped tasks
  // (no servers / no creator / CAS lost / downstream error) don't add
  // to this counter so the durable job's `dispatched` value reflects
  // real work, not the size of the observed due-list.
  let dispatchedCount = 0;

  for (const task of dueTasks) {
    try {
      const dispatched = await dispatchDueTask(task);
      if (dispatched) {
        dispatchedCount += 1;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Scheduled task execution failed", { reason, taskId: task.id, error: message });
      try {
        await recordTaskRun(task.id, `Execution failed: ${message}`);
      } catch (recordError) {
        logger.error("Failed to record scheduled task run after failure", {
          reason,
          taskId: task.id,
          error: recordError instanceof Error ? recordError.message : String(recordError),
        });
      }
    }
  }

  return { dispatched: dispatchedCount };
}

export async function runScheduledTaskTickJobWorkerOnce(reason = "manual") {
  const state = getWorkerState();
  if (state.running) {
    logger.warn("Skipping scheduled task tick because a previous tick is still running", { reason });
    return false;
  }

  state.running = true;
  try {
    await enqueueScheduledTaskTickJob(reason);
    const job = await claimNextJob({
      workerId: SCHEDULED_TASK_WORKER_ID,
      types: [SCHEDULED_TASK_TICK_JOB_TYPE],
      leaseMs: SCHEDULED_TASK_LEASE_MS,
    });
    if (!job) return false;

    try {
      await heartbeatJob(job.id, SCHEDULED_TASK_WORKER_ID, {
        leaseMs: SCHEDULED_TASK_LEASE_MS,
        progress: "Dispatching due scheduled tasks",
      });
      const result = await dispatchDueScheduledTasks(reason);
      await completeJob(job.id, SCHEDULED_TASK_WORKER_ID, result);
      try {
        await pruneCompletedJobsByType({
          type: SCHEDULED_TASK_TICK_JOB_TYPE,
          keepLatest: SCHEDULED_TASK_TICK_KEEP_LATEST,
          olderThan: new Date(Date.now() - SCHEDULED_TASK_TICK_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        });
      } catch (pruneError) {
        logger.warn("Failed to prune scheduled-task.tick jobs", {
          error: pruneError instanceof Error ? pruneError.message : String(pruneError),
        });
      }
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, SCHEDULED_TASK_WORKER_ID, message.slice(0, 2000), { retryAfterMs: 60_000 });
      logger.error("Scheduled task tick job failed", { reason, jobId: job.id, error: message });
      return true;
    }
  } catch (error) {
    logger.error("Scheduled task tick failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    state.running = false;
  }
}

export async function startScheduledTaskWorker() {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = SCHEDULED_TASK_INTERVAL_MS;

  void runScheduledTaskTickJobWorkerOnce("startup").catch((error) => {
    logger.error("Scheduled task worker tick failed", {
      reason: "startup",
      error: error instanceof Error ? error.message : String(error),
    });
  });
  state.timer = setInterval(() => {
    void runScheduledTaskTickJobWorkerOnce("interval").catch((error) => {
      logger.error("Scheduled task worker tick failed", {
        reason: "interval",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
  state.timer.unref?.();

  logger.info("scheduled-task durable job worker started", { intervalMs, workerId: SCHEDULED_TASK_WORKER_ID });
  return state;
}

export function stopScheduledTaskWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.started = false;
  state.running = false;
  state.timer = null;
}
