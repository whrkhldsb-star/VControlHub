import { Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { getSftpSyncNode, syncSftpDirectoryEntries } from "./sftp-sync";

const logger = createLogger("sftp-sync-job-worker");

export const SFTP_SYNC_JOB_TYPE = "storage.sftp-sync";
const SFTP_SYNC_WORKER_INTERVAL_MS = 15_000;
// TR-002 R2: 跨 worker lease 公式统一。computeLeaseMs 默认返 preset (= SFTP_SYNC_WORKER_LEASE_MS 等同原值)。
const SFTP_SYNC_WORKER_LEASE_MS = computeLeaseMs("sftp-sync");
const SFTP_SYNC_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:sftp-sync:${process.pid}`;

type SftpSyncJobPayload = {
  nodeId: string;
  remotePath?: string;
  recursive?: boolean;
  maxDepth?: number;
};

type SftpSyncWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type SftpSyncWorkerGlobal = typeof globalThis & {
  __vcontrolhubSftpSyncWorker?: SftpSyncWorkerState;
};

function getWorkerState() {
  const globalState = globalThis as SftpSyncWorkerGlobal;
  globalState.__vcontrolhubSftpSyncWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubSftpSyncWorker;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function parseSftpSyncJobPayload(payload: Prisma.JsonValue): SftpSyncJobPayload {
  if (!isRecord(payload) || typeof payload.nodeId !== "string" || payload.nodeId.trim().length === 0) {
    throw new Error("SFTP 同步任务缺少存储节点");
  }
  return {
    nodeId: payload.nodeId,
    remotePath: typeof payload.remotePath === "string" ? payload.remotePath : undefined,
    recursive: typeof payload.recursive === "boolean" ? payload.recursive : false,
    maxDepth: typeof payload.maxDepth === "number" ? payload.maxDepth : 1,
  };
}

async function executeSftpSyncJob(job: { id: string; payload: Prisma.JsonValue }) {
  const payload = parseSftpSyncJobPayload(job.payload);
  await heartbeatJob(job.id, SFTP_SYNC_WORKER_ID, {
    leaseMs: SFTP_SYNC_WORKER_LEASE_MS,
    progress: "正在加载 SFTP 节点",
  });

  const node = await getSftpSyncNode(payload.nodeId);
  if (!node) throw new Error("存储节点不存在");
  if (node.driver !== "SFTP") throw new Error("该节点不是 SFTP 类型");

  await heartbeatJob(job.id, SFTP_SYNC_WORKER_ID, {
    leaseMs: SFTP_SYNC_WORKER_LEASE_MS,
    progress: `正在同步 ${node.name}`,
  });
  const result = await syncSftpDirectoryEntries({
    node,
    remotePath: payload.remotePath,
    recursive: payload.recursive,
    maxDepth: payload.maxDepth,
  });

  if (result.errors.length > 0 && result.synced === 0 && result.created === 0 && result.updated === 0 && result.deleted === 0) {
    throw new Error(result.errors.join("；"));
  }

  await completeJob(job.id, SFTP_SYNC_WORKER_ID, result as unknown as Prisma.InputJsonValue);
}

export async function runSftpSyncJobWorkerOnce(state = getWorkerState(), reason = "manual") {
  if (state.running) {
    logger.warn("Skipping SFTP sync job tick because a previous tick is still running", { reason });
    return;
  }

  state.running = true;
  try {
    const job = await claimNextJob({
      workerId: SFTP_SYNC_WORKER_ID,
      types: [SFTP_SYNC_JOB_TYPE],
      leaseMs: SFTP_SYNC_WORKER_LEASE_MS,
    });
    if (!job) return;

    try {
      await executeSftpSyncJob(job);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("SFTP sync job failed", { reason, jobId: job.id, error: message });
      await failJob(job.id, SFTP_SYNC_WORKER_ID, message, { retryAfterMs: 60_000 });
    }
  } catch (error) {
    logger.error("SFTP sync job tick failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    state.running = false;
  }
}

export async function startSftpSyncJobWorker() {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = SFTP_SYNC_WORKER_INTERVAL_MS;

  void runSftpSyncJobWorkerOnce(state, "startup");
  state.timer = setInterval(() => {
    void runSftpSyncJobWorkerOnce(state, "interval");
  }, intervalMs);
  state.timer.unref?.();

  logger.info("SFTP sync job worker started", { intervalMs, workerId: SFTP_SYNC_WORKER_ID });
  return state;
}

export function stopSftpSyncJobWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.running = false;
  state.timer = null;
}
