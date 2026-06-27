import { Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";

import {
  executeAria2RelayDownload,
  executeDirectDownload,
  type DownloadServer,
} from "./execution";

const logger = createLogger("download-execution-worker");

// TR-001 (T12): the fire-and-forget executeAria2RelayDownload / executeDirectDownload
// dispatches in src/app/api/downloads/route.ts have been migrated to durable
// jobs in the jobs table. The actual aria2 RPC + remote SCP/SSH work now runs
// from a worker poll loop (claim + lease + heartbeat) so the downloads center
// becomes observable in /operation-tasks and survives process restarts. The
// same shape is used by the other TR-001 workers (command.execution, scheduled-
// task.tick, alert.evaluate, quick_service.lifecycle, backup.create/restore).
export const DOWNLOAD_EXECUTION_JOB_TYPE = "download.execute";

// Aria2 relay downloads can take up to 2 hours (maxWait = 7200 in execution.ts),
// so the worker lease must outlive the longest possible single dispatch by a
// safe margin. Direct downloads finish in seconds; the same lease is fine.
// TR-002 R2: 跨 worker lease 公式统一。computeLeaseMs 默认返 preset (= DOWNLOAD_EXECUTION_LEASE_MS 等同原值)。
const DOWNLOAD_EXECUTION_LEASE_MS = computeLeaseMs("download-execution");
const DOWNLOAD_EXECUTION_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:download-execution:${process.pid}`;

type DownloadExecutionMode = "aria2_relay" | "direct";

type DownloadExecutionJobPayload = {
  mode: DownloadExecutionMode;
  taskId: string;
  userId?: string | null;
  requestedAt?: string;
};

type DownloadExecutionWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type DownloadExecutionWorkerGlobal = typeof globalThis & {
  __vcontrolhubDownloadExecutionWorker?: DownloadExecutionWorkerState;
};

function getWorkerState() {
  const globalState = globalThis as DownloadExecutionWorkerGlobal;
  globalState.__vcontrolhubDownloadExecutionWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubDownloadExecutionWorker;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseMode(value: unknown): DownloadExecutionMode {
  if (value === "aria2_relay" || value === "direct") return value;
  throw new Error("download.execute 任务 payload 缺少有效 mode");
}

export function parseDownloadExecutionJobPayload(
  payload: Prisma.JsonValue,
): DownloadExecutionJobPayload {
  if (!isRecord(payload)) throw new Error("download.execute 任务 payload 无效");
  const taskId =
    typeof payload.taskId === "string" && payload.taskId.trim()
      ? payload.taskId.trim()
      : null;
  if (!taskId) throw new Error("download.execute 任务缺少 taskId");
  const mode = parseMode(payload.mode);
  const userId =
    typeof payload.userId === "string" && payload.userId.trim()
      ? payload.userId.trim()
      : null;
  return {
    mode,
    taskId,
    userId,
    requestedAt: typeof payload.requestedAt === "string" ? payload.requestedAt : undefined,
  };
}

export async function enqueueDownloadExecutionJob(input: {
  mode: DownloadExecutionMode;
  taskId: string;
  userId?: string | null;
  /**
   * TR-001 T13b: storage node the download is targeting, propagated to
   * the durable job so `claimNextJob` can apply the per-node concurrency
   * cap. Caller is responsible for resolving it (the downloads route
   * already has it on the joined `server.storageNode` row).
   */
  storageNodeId?: string | null;
}) {
  // Defensive trim + non-empty check: an empty/whitespace taskId would
  // create a real durable job row that the worker cannot dispatch against
  // (the worker re-fetches by id). Keep this as a hard contract — the
  // download route is the only caller today, but the test `rejects an
  // empty taskId to surface caller bugs early` enforces it, and removing
  // the check lets a future caller silently enqueue a dead job.
  const taskId = input.taskId?.trim();
  if (!taskId) throw new Error("download.execute 任务缺少 taskId");
  const mode = input.mode;
  return enqueueJob({
    type: DOWNLOAD_EXECUTION_JOB_TYPE,
    title: mode === "aria2_relay" ? `中转下载 ${taskId}` : `直连下载 ${taskId}`,
    payload: {
      mode,
      taskId,
      userId: input.userId ?? null,
      requestedAt: new Date().toISOString(),
    },
    createdBy: input.userId ?? null,
    targetStorageNodeId: input.storageNodeId ?? null,
    priority: 0,
    maxAttempts: 3,
  });
}

async function loadTaskRow(taskId: string) {
  const { prisma } = await import("@/lib/db");
  return prisma.downloadTask.findUnique({
    where: { id: taskId },
    include: { server: { include: { sshKey: true, storageNode: true } } },
  });
}

function buildServerForExec(server: {
  host: string;
  port: number;
  username: string;
  sshKeyId: string | null;
  password: string | null;
  storageNode?: { id: string; basePath: string | null } | null;
  sshKey?: { privateKey: string | null } | null;
}): DownloadServer {
  const decryptedKey = server.sshKey?.privateKey
    ? decryptSshPrivateKey(server.sshKey.privateKey)
    : "";
  return {
    host: server.host,
    port: server.port,
    username: server.username,
    sshKeyId: server.sshKeyId,
    password: server.password,
    storageNode: server.storageNode
      ? { id: server.storageNode.id, basePath: server.storageNode.basePath }
      : null,
    sshKey: decryptedKey ? { privateKey: decryptedKey } : null,
  };
}

function decryptServerPasswordField(server: { password: string | null }) {
  if (!server.password) return null;
  return decryptServerPassword(server.password);
}

async function handleClaimedJob(
  job: NonNullable<Awaited<ReturnType<typeof claimNextJob>>>,
) {
  let payload: DownloadExecutionJobPayload;
  try {
    payload = parseDownloadExecutionJobPayload(job.payload);
  } catch (parseError) {
    const message =
      parseError instanceof Error ? parseError.message : "download.execute 任务 payload 解析失败";
    await failJob(job.id, DOWNLOAD_EXECUTION_WORKER_ID, message.slice(0, 2000));
    logger.error("Download execution job payload invalid", { jobId: job.id, error: message });
    return true;
  }

  try {
    await heartbeatJob(job.id, DOWNLOAD_EXECUTION_WORKER_ID, {
      leaseMs: DOWNLOAD_EXECUTION_LEASE_MS,
      progress:
        payload.mode === "aria2_relay"
          ? `准备 aria2 中转下载 ${payload.taskId}`
          : `准备直连下载 ${payload.taskId}`,
    });

    const task = await loadTaskRow(payload.taskId);
    if (!task) {
      await failJob(job.id, DOWNLOAD_EXECUTION_WORKER_ID, `下载任务 ${payload.taskId} 不存在`);
      return true;
    }
    if (!task.server) {
      await failJob(job.id, DOWNLOAD_EXECUTION_WORKER_ID, `下载任务 ${payload.taskId} 缺少 VPS 节点`);
      return true;
    }
    if (!task.server.storageNode) {
      await failJob(
        job.id,
        DOWNLOAD_EXECUTION_WORKER_ID,
        `下载任务 ${payload.taskId} 的 VPS 未绑定存储节点`,
      );
      return true;
    }

    // New-C (2026-06-15): idempotency guard. The execute* helpers mark the
    // downloadTask FAILED / CANCELLED on their own catch chains and
    // return normally (no throw). With TR-001 T13b bumping
    // `enqueueDownloadExecutionJob.maxAttempts` from 1 to 3, the durable
    // job layer now retries transient dispatch errors, so a worker
    // tick can come back and find the business row in a terminal state
    // even though the durable job itself is still "RUNNING" (this is
    // exactly the symptom another AI reviewer flagged as "operation
    // job 成功、业务下载失败"). Cross-check here and pick the right
    // outcome so the user-visible state stays consistent:
    //
    //   - COMPLETED  → business already done, just complete the job
    //                   without re-running the dispatch side effects.
    //   - FAILED     → business already failed, fail the job without
    //                   a retry that would re-trigger execute*.
    //   - CANCELLED  → user cancelled, fail the job and don't retry.
    //   - PENDING /
    //     RUNNING    → still in-flight (e.g. aria2 relay long-poll).
    //                   complete the job because the worker has
    //                   kicked off the dispatch; the execute* helpers
    //                   will mark COMPLETED / FAILED in their own
    //                   catch chains as the aria2 RPC progresses.
    if (task.status === "COMPLETED") {
      await completeJob(job.id, DOWNLOAD_EXECUTION_WORKER_ID, {
        taskId: payload.taskId,
        mode: payload.mode,
        status: "already_completed",
      });
      logger.info(
        "Download execution job found the task already COMPLETED; completing job without re-dispatching",
        { jobId: job.id, taskId: payload.taskId, mode: payload.mode },
      );
      return true;
    }
    if (task.status === "FAILED") {
      // The execute* helper already recorded the failure on the
      // downloadTask row. failJob with the row's last error so the
      // job's `lastError` matches the user-visible message.
      await failJob(
        job.id,
        DOWNLOAD_EXECUTION_WORKER_ID,
        (task.errorMessage ?? "下载任务已失败").slice(0, 2000),
        // No retry: the business side is terminal.
        { retryAfterMs: undefined },
      );
      logger.info(
        "Download execution job found the task already FAILED; failing job without retrying",
        { jobId: job.id, taskId: payload.taskId, errorMessage: task.errorMessage },
      );
      return true;
    }
    if (task.status === "CANCELLED") {
      await failJob(
        job.id,
        DOWNLOAD_EXECUTION_WORKER_ID,
        (task.errorMessage ?? "下载任务已取消").slice(0, 2000),
        { retryAfterMs: undefined },
      );
      logger.info(
        "Download execution job found the task CANCELLED; failing job without retrying",
        { jobId: job.id, taskId: payload.taskId, errorMessage: task.errorMessage },
      );
      return true;
    }

    const serverForExec = buildServerForExec(task.server);
    // The downstream execute* helpers re-decrypt server.password on demand (see
    // transferFileViaSsh2 which reads it again for sshpass). Surface the same
    // decrypted value here so the in-memory copy we dispatch with is the
    // plaintext password the original fire-and-forget path was using.
    serverForExec.password = decryptServerPasswordField(task.server);

    if (payload.mode === "aria2_relay") {
      await executeAria2RelayDownload(
        payload.taskId,
        serverForExec,
        [task.url],
        task.targetPath,
        task.fileName,
        task.maxSpeedKb,
        payload.userId ?? task.createdBy ?? undefined,
      );
    } else {
      await executeDirectDownload(
        payload.taskId,
        serverForExec,
        task.url,
        task.targetPath,
        task.fileName,
        payload.userId ?? task.createdBy ?? undefined,
      );
    }

    await completeJob(job.id, DOWNLOAD_EXECUTION_WORKER_ID, {
      taskId: payload.taskId,
      mode: payload.mode,
      status: "dispatched",
    });
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // New-C (2026-06-15): if our own dispatch path threw (i.e. the
    // execute* helper itself crashed, not the underlying download), the
    // business row may or may not already be FAILED. Re-fetch and only
    // fail the durable job if the business row is still in-flight; if
    // the business side already recorded FAILED, do not retry (avoids
    // double-launching the side effects the next worker tick would
    // otherwise pull in via T13b's bumped maxAttempts).
    const postTask = await loadTaskRow(payload.taskId);
    if (postTask && (postTask.status === "FAILED" || postTask.status === "CANCELLED" || postTask.status === "COMPLETED")) {
      if (postTask.status === "COMPLETED") {
        await completeJob(job.id, DOWNLOAD_EXECUTION_WORKER_ID, {
          taskId: payload.taskId,
          mode: payload.mode,
          status: "already_completed_after_error",
        });
      } else {
        await failJob(
          job.id,
          DOWNLOAD_EXECUTION_WORKER_ID,
          (postTask.errorMessage ?? message).slice(0, 2000),
          { retryAfterMs: undefined },
        );
      }
      logger.info(
        "Download execution job threw but the business row already reached a terminal state; not retrying",
        {
          jobId: job.id,
          taskId: payload.taskId,
          mode: payload.mode,
          businessStatus: postTask.status,
        },
      );
      return true;
    }
    await failJob(job.id, DOWNLOAD_EXECUTION_WORKER_ID, message.slice(0, 2000));
    logger.error("Download execution job failed", {
      jobId: job.id,
      taskId: payload.taskId,
      mode: payload.mode,
      error: message,
    });
    return true;
  }
}

export async function runDownloadExecutionJobWorkerOnce() {
  const state = getWorkerState();
  if (state.running) {
    logger.warn("Skipping download execution tick because a previous tick is still running");
    return false;
  }

  state.running = true;
  try {
    const job = await claimNextJob({
      workerId: DOWNLOAD_EXECUTION_WORKER_ID,
      types: [DOWNLOAD_EXECUTION_JOB_TYPE],
      leaseMs: DOWNLOAD_EXECUTION_LEASE_MS,
    });
    if (!job) return false;
    return await handleClaimedJob(job);
  } catch (error) {
    logger.error("Download execution worker tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    state.running = false;
  }
}

export async function startDownloadJobWorker(options: { intervalMs?: number } = {}) {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = options.intervalMs ?? config.worker.downloadExecutionIntervalMs;

  void runDownloadExecutionJobWorkerOnce().catch((error) => {
    logger.error("Download execution worker startup tick failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
  state.timer = setInterval(() => {
    void runDownloadExecutionJobWorkerOnce().catch((error) => {
      logger.error("Download execution worker interval tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
  state.timer.unref?.();

  logger.info("download execution durable job worker started", {
    intervalMs,
    workerId: DOWNLOAD_EXECUTION_WORKER_ID,
    leaseMs: DOWNLOAD_EXECUTION_LEASE_MS,
  });
  return state;
}

export function stopDownloadJobWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.started = false;
  state.running = false;
  state.timer = null;
}

// Internal helper used by tests to peek at the live worker state without
// leaking the global symbol across module boundaries.
export function getDownloadExecutionWorkerStateForTests(): DownloadExecutionWorkerState {
  return getWorkerState();
}

// Internal helper used by tests / recovery scripts to verify there is no
// other in-flight worker polling the same job type on this process.
export const DOWNLOAD_EXECUTION_INTERNAL_WORKER_ID = DOWNLOAD_EXECUTION_WORKER_ID;
