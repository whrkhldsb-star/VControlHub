import { JobStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { assertRequesterMayExecuteCommand } from "@/lib/auth/command-execution-authz";
import { config } from "@/lib/config/env";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
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
import { t } from "@/lib/i18n/service-translations";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { createSingletonIntervalWorker } from "@/lib/workers/singleton-interval-worker";

import { reconcileScheduledTaskRuns, recordTaskDispatch, recordTaskRun } from "./service";

const logger = createLogger("scheduled-task-worker");

// TR-001 (T10): scheduled-task worker migrated to the durable jobs table so
// the actual dispatch work survives process restarts and can be observed via
// the same JobStatus / heartbeat / failJob paths as the other durable workers
// (alert-worker, quick-service-job-worker, backup-job-worker, sftp-sync-job).
export const SCHEDULED_TASK_TICK_JOB_TYPE = "scheduled-task.tick";

const SCHEDULED_TASK_INTERVAL_MS = 60_000;
/** How long a claimed occurrence stays invisible before another worker may re-claim it. */
const SCHEDULED_TASK_CLAIM_LEASE_MS = 10 * 60_000;
// TR-002 R2: 跨 worker lease 公式统一。computeLeaseMs 默认返 preset (= SCHEDULED_TASK_LEASE_MS 等同原值)。
const SCHEDULED_TASK_LEASE_MS = computeLeaseMs("scheduled-task");
const SCHEDULED_TASK_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:scheduled-task:${process.pid}`;
// Keep only a small diagnostic window; successful minute ticks are not business records.
const SCHEDULED_TASK_TICK_KEEP_LATEST = 50;

const scheduledTaskWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubScheduledTaskWorker",
  resolveIntervalMs: () => SCHEDULED_TASK_INTERVAL_MS,
  tick: (_state, reason) => {
    void runScheduledTaskTickJobWorkerOnce(reason).catch((error) => {
      logger.error("Scheduled task worker tick failed", {
        reason,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  },
  onStarted: (_state, intervalMs) => {
    logger.info("scheduled-task durable job worker started", { intervalMs, workerId: SCHEDULED_TASK_WORKER_ID });
  },
});

function getWorkerState() {
  return scheduledTaskWorker.getState();
}

async function hasActiveScheduledTaskTickJob() {
  const existing = await prisma.job.findFirst({
    where: {
      type: SCHEDULED_TASK_TICK_JOB_TYPE,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function enqueueScheduledTaskTickJob(reason: string) {
  // A regular transaction does not serialize two concurrent "no rows"
  // reads under READ COMMITTED. A non-blocking PostgreSQL advisory lock
  // makes the check-and-enqueue sequence genuinely single-flight.
  const release = await tryAcquireAdvisoryLock("scheduled-task-enqueue", "global");
  if (!release) return null;
  try {
    if (await hasActiveScheduledTaskTickJob()) return null;
    return await enqueueJob({
        type: SCHEDULED_TASK_TICK_JOB_TYPE,
        title: "Scheduled task dispatch tick",
        payload: { reason, requestedAt: new Date().toISOString() },
        priority: -5,
        maxAttempts: 3,
      });
  } finally {
    await release();
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
  claimedOccurrenceAt?: Date | null;
  approvalRequired: boolean;
  /** Propagate parent ScheduledTask.teamId so the spawned CommandRequest is not global (null = shared). */
  teamId: string | null;
}): Promise<boolean> {
  if (task.serverIds.length === 0 || !task.createdById) {
    await recordTaskRun(task.id, t("backend.scheduled-task.skippedMissingTargetOrCreator"), "skipped");
    return false;
  }

  // Live authorization re-check before dispatch. The stored creator may have
  // been disabled, demoted (lost command:execute), or removed from the task's
  // team since the task was created; an unattended task
  // (approvalRequired=false) would otherwise keep auto-executing commands under
  // a revoked identity. The playbook worker performs the same recheck — both
  // background execution paths now share assertRequesterMayExecuteCommand.
  // Skip-and-record (leave the task ACTIVE) rather than dispatch; the state is
  // durable, so recordTaskRun advancing nextRunAt avoids a tight retry loop.
  const authz = await assertRequesterMayExecuteCommand(task.createdById, task.teamId);
  if (!authz.ok) {
    await recordTaskRun(
      task.id,
      t("backend.scheduled-task.skippedRequesterNotAuthorized", { reason: authz.reason }),
      "skipped",
    );
    logger.warn("Scheduled task skipped: requester no longer authorized", {
      taskId: task.id,
      taskName: task.name,
      reason: authz.reason,
    });
    return false;
  }

  // New-B (2026-06-15): row-level CAS so two workers that both observed
  // the same `dueTasks` list (via findMany) cannot both call
  // createCommandRequest for the same ScheduledTask. We race an
  // updateMany with the original `nextRunAt` pinned — the loser sees
  // count === 0 and bails.
  //
  // The claim keeps the occurrence in claimedOccurrenceAt and turns nextRunAt
  // into a short lease. If this worker dies before recordTaskDispatch, the
  // row becomes due again when the lease expires and the next worker
  // dispatches the SAME occurrence: its idempotency key replays the command
  // already created (if any) instead of running it twice, and the run gets
  // recorded. (A 24 h sentinel used to replace nextRunAt here, which skipped
  // the task for a day and lost the original occurrence.)
  const occurrence = task.claimedOccurrenceAt ?? task.nextRunAt;
  const claimLease = new Date(Date.now() + SCHEDULED_TASK_CLAIM_LEASE_MS);
  const claim = await prisma.scheduledTask.updateMany({
    where: {
      id: task.id,
      status: "ACTIVE",
      nextRunAt: task.nextRunAt,
    },
    data: { nextRunAt: claimLease, claimedOccurrenceAt: occurrence },
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
    approvalRequired: task.approvalRequired,
      idempotencyKey: `scheduled-task:${task.id}:${occurrence?.toISOString() ?? "manual"}`,
    });

    try {
      await recordTaskDispatch(task.id, result.id, false, { occurrence, lease: claimLease });
    } catch (error) {
      // The request exists; only its link failed. Not an execution failure
      // (that disabled a ONCE task and lost the request's result): the claim
      // is handed back below, and the next tick replays this occurrence,
      // which returns the same request (idempotency key) and links it.
      throw new DispatchLinkError(result.id, error);
    }
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
      // Hand back only our own claim: an edit saved meanwhile set the
      // schedule the user wants, and restoring the old occurrence undid it.
      await prisma.scheduledTask.updateMany({
        where: { id: task.id, nextRunAt: claimLease, claimedOccurrenceAt: occurrence },
        data: { nextRunAt: occurrence, claimedOccurrenceAt: null },
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

/** The command request was created but linking it to its task failed. */
export class DispatchLinkError extends Error {
  constructor(readonly commandRequestId: string, cause: unknown) {
    super(`Command request ${commandRequestId} created but not linked: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "DispatchLinkError";
  }
}

export async function dispatchDueScheduledTasks(reason: string) {
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
      if (error instanceof DispatchLinkError) continue;
      try {
        // Structured "failed" outcome — the prefix on this string is display
        // copy only; failure detection must never parse it (see recordTaskRun).
        await recordTaskRun(task.id, `Execution failed: ${message}`, "failed");
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
      const result = await runWithLeaseHeartbeat({
        jobId: job.id,
        leaseMs: SCHEDULED_TASK_LEASE_MS,
        heartbeat: () => heartbeatJob(job.id, SCHEDULED_TASK_WORKER_ID, {
          leaseMs: SCHEDULED_TASK_LEASE_MS,
          progress: "Dispatching due scheduled tasks",
        }),
        run: async () => {
          const reconciliation = await reconcileScheduledTaskRuns();
          return { ...(await dispatchDueScheduledTasks(reason)), reconciled: reconciliation.reconciled };
        },
      });
      await completeJob(job.id, SCHEDULED_TASK_WORKER_ID, result);
      try {
        await pruneCompletedJobsByType({
          type: SCHEDULED_TASK_TICK_JOB_TYPE,
          keepLatest: SCHEDULED_TASK_TICK_KEEP_LATEST,
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
  return (await scheduledTaskWorker.start()).state;
}

export function stopScheduledTaskWorkerForTests() {
  scheduledTaskWorker.stopForTests();
}
