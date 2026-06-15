import { Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
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

const DOWNLOAD_EXECUTION_INTERVAL_MS = 5_000;
// Aria2 relay downloads can take up to 2 hours (maxWait = 7200 in execution.ts),
// so the worker lease must outlive the longest possible single dispatch by a
// safe margin. Direct downloads finish in seconds; the same lease is fine.
const DOWNLOAD_EXECUTION_LEASE_MS = 150 * 60 * 1000;
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
}) {
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
    priority: 0,
    maxAttempts: 1,
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
    // The execute* helpers mark the downloadTask FAILED in their own catch
    // chains; from the job's perspective the dispatch attempt is still
    // considered "failed" (transient prisma error / worker crash mid-dispatch),
    // so we record the failure on the job but rely on maxAttempts=1 to avoid
    // retrying real side-effect work that has already been recorded FAILED on
    // the downloadTask row.
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
  const intervalMs = options.intervalMs ?? DOWNLOAD_EXECUTION_INTERVAL_MS;

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
