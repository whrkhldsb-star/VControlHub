import { JobStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { config } from "@/lib/config/env";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
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
const SCHEDULED_TASK_LEASE_MS = 5 * 60 * 1000;
const SCHEDULED_TASK_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:scheduled-task:${process.pid}`;

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
  if (await hasActiveScheduledTaskTickJob()) return null;
  return enqueueJob({
    type: SCHEDULED_TASK_TICK_JOB_TYPE,
    title: "定时任务调度 tick",
    payload: { reason, requestedAt: new Date().toISOString() },
    priority: -5,
    maxAttempts: 3,
  });
}

async function dispatchDueTask(task: {
  id: string;
  name: string;
  command: string;
  reason: string | null;
  serverIds: string[];
  createdById: string | null;
}) {
  if (task.serverIds.length === 0 || !task.createdById) {
    await recordTaskRun(task.id, "跳过：无目标服务器或无创建者");
    return;
  }

  const result = await createCommandRequest({
    title: `定时任务：${task.name}`,
    command: task.command,
    reason: task.reason ?? `由定时任务 ${task.name} 触发`,
    submissionMode: "user",
    requesterId: task.createdById,
    serverIds: task.serverIds,
  });

  await recordTaskRun(task.id, `已触发命令请求 ${result.id}`);
}

async function dispatchDueScheduledTasks(reason: string) {
  const dueTasks = await prisma.scheduledTask.findMany({
    where: {
      status: "ACTIVE",
      nextRunAt: { not: null, lte: new Date() },
    },
  });

  for (const task of dueTasks) {
    try {
      await dispatchDueTask(task);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Scheduled task execution failed", { reason, taskId: task.id, error: message });
      try {
        await recordTaskRun(task.id, `执行失败：${message}`);
      } catch (recordError) {
        logger.error("Failed to record scheduled task run after failure", {
          reason,
          taskId: task.id,
          error: recordError instanceof Error ? recordError.message : String(recordError),
        });
      }
    }
  }

  return { dispatched: dueTasks.length };
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
        progress: "正在分发到期的定时任务",
      });
      const result = await dispatchDueScheduledTasks(reason);
      await completeJob(job.id, SCHEDULED_TASK_WORKER_ID, result);
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
