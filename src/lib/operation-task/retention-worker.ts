/**
 * TR-006: 操作任务跨来源保留策略的 durable job worker。
 *
 * 跟 alert-worker.ts 同范式:
 *   - durable job type "operation-task.retention"
 *   - setInterval 轮询 + claimNextJob / completeJob / failJob
 *   - state machine (started / running) 镜像到 globalThis 避免重入
 *   - 显式 stop*ForTests() 给 vitest 用
 *
 * worker tick:
 *   1. enqueueOperationTaskRetentionJob() — 幂等, 已有 PENDING/RUNNING 则 skip
 *   2. claimNextJob — 拿一个 job
 *   3. heartbeatJob — 标记进行中
 *   4. pruneOperationTaskHistory() — 跨 5 个非 job / scheduled 来源裁剪
 *   5. completeJob — 写入 result
 *   6. 任何步骤 throw → failJob 走 retry 路径
 */
import { JobStatus } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, enqueueJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import { OPERATION_TASK_RETENTION_JOB_TYPE, pruneOperationTaskHistory } from "./retention";

const logger = createLogger("operation-task-retention-worker");

const OPERATION_TASK_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h
// 5min 兜底 lease, 实际 pruneOperationTaskHistory 在大型实例可能 30s-1min 完成
const OPERATION_TASK_RETENTION_LEASE_MS = computeLeaseMs("operation-task-retention");
const OPERATION_TASK_RETENTION_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:operation-task-retention:${process.pid}`;

type OperationTaskRetentionWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type OperationTaskRetentionWorkerGlobal = typeof globalThis & {
  __vcontrolhubOperationTaskRetentionWorker?: OperationTaskRetentionWorkerState;
};

function getWorkerState(): OperationTaskRetentionWorkerState {
  const globalState = globalThis as OperationTaskRetentionWorkerGlobal;
  globalState.__vcontrolhubOperationTaskRetentionWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubOperationTaskRetentionWorker;
}

async function hasActiveRetentionJob() {
  const existing = await prisma.job.findFirst({
    where: {
      type: OPERATION_TASK_RETENTION_JOB_TYPE,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function enqueueOperationTaskRetentionJob(reason: string) {
  if (await hasActiveRetentionJob()) return null;
  return enqueueJob({
    type: OPERATION_TASK_RETENTION_JOB_TYPE,
    title: "Operation task cross-source retention policy pruning",
    payload: { reason, requestedAt: new Date().toISOString() },
    priority: -5, // 比 alert.evaluate (-10) 略低, 业务不阻塞
    maxAttempts: 2, // 失败重试一次即可, 6h 后下次 tick 自然再跑
  });
}

export async function runOperationTaskRetentionJobWorkerOnce(reason = "manual") {
  const state = getWorkerState();
  if (state.running) {
    logger.warn("Skipping operation-task retention tick because a previous tick is still running", { reason });
    return false;
  }

  state.running = true;
  try {
    await enqueueOperationTaskRetentionJob(reason);
    const job = await claimNextJob({
      workerId: OPERATION_TASK_RETENTION_WORKER_ID,
      types: [OPERATION_TASK_RETENTION_JOB_TYPE],
      leaseMs: OPERATION_TASK_RETENTION_LEASE_MS,
    });
    if (!job) return false;

    try {
      await heartbeatJob(job.id, OPERATION_TASK_RETENTION_WORKER_ID, {
        leaseMs: OPERATION_TASK_RETENTION_LEASE_MS,
        progress: "Pruning historical records across sources",
      });
      const result = await pruneOperationTaskHistory();
      await completeJob(job.id, OPERATION_TASK_RETENTION_WORKER_ID, {
        totalDeleted: result.totalDeleted,
        perSource: result.perSource,
        durationMs: result.durationMs,
        olderThan: result.olderThan,
        keepLatest: result.keepLatest,
      });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Operation task retention pruning failed";
      await failJob(job.id, OPERATION_TASK_RETENTION_WORKER_ID, message.slice(0, 2000), {
        retryAfterMs: 60 * 60 * 1000, // 1h 后重试
      });
      logger.error("Operation task retention failed", { reason, jobId: job.id, error: message });
      return true;
    }
  } finally {
    state.running = false;
  }
}

export async function startOperationTaskRetentionWorker() {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = OPERATION_TASK_RETENTION_INTERVAL_MS;

  void runOperationTaskRetentionJobWorkerOnce("startup").catch((error) => {
    logger.error("Operation task retention worker tick failed", {
      reason: "startup",
      error: error instanceof Error ? error.message : String(error),
    });
  });
  state.timer = setInterval(() => {
    void runOperationTaskRetentionJobWorkerOnce("interval").catch((error) => {
      logger.error("Operation task retention worker tick failed", {
        reason: "interval",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
  state.timer.unref?.();

  logger.info("operation-task retention durable job worker started", {
    workerId: OPERATION_TASK_RETENTION_WORKER_ID,
    intervalMs,
  });
  return state;
}

export function stopOperationTaskRetentionWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.started = false;
  state.running = false;
  state.timer = null;
}
