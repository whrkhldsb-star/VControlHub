import { Prisma } from "@prisma/client";

import { getBackupRecord, restoreBackupRecord, runExistingBackupRecord } from "@/lib/backup/service";
import { config } from "@/lib/config/env";
import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

const logger = createLogger("backup-job-worker");

export const BACKUP_CREATE_JOB_TYPE = "backup.create";
export const BACKUP_RESTORE_JOB_TYPE = "backup.restore";

const BACKUP_JOB_TYPES = [BACKUP_CREATE_JOB_TYPE, BACKUP_RESTORE_JOB_TYPE];
const DEFAULT_POLL_MS = 5_000;
const DEFAULT_LEASE_MS = 30_000;
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:backup:${process.pid}`;

type BackupCreatePayload = {
  backupId: string;
  projectRoot?: string;
};

type BackupRestorePayload = {
  backupId: string;
  confirm: "RESTORE";
  projectRoot?: string;
};

let timer: NodeJS.Timeout | null = null;
let running = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseCreatePayload(payload: Prisma.JsonValue): BackupCreatePayload {
  if (!isRecord(payload) || typeof payload.backupId !== "string" || !payload.backupId.trim()) {
    throw new Error("备份任务 payload 缺少 backupId");
  }
  return {
    backupId: payload.backupId.trim(),
    projectRoot: typeof payload.projectRoot === "string" && payload.projectRoot.trim() ? payload.projectRoot.trim() : undefined,
  };
}

function parseRestorePayload(payload: Prisma.JsonValue): BackupRestorePayload {
  if (!isRecord(payload) || typeof payload.backupId !== "string" || !payload.backupId.trim()) {
    throw new Error("恢复任务 payload 缺少 backupId");
  }
  return {
    backupId: payload.backupId.trim(),
    confirm: "RESTORE",
    projectRoot: typeof payload.projectRoot === "string" && payload.projectRoot.trim() ? payload.projectRoot.trim() : undefined,
  };
}

async function handleJob(job: Awaited<ReturnType<typeof claimNextJob>>) {
  if (!job) return false;
  try {
    if (job.type === BACKUP_CREATE_JOB_TYPE) {
      const payload = parseCreatePayload(job.payload);
      const record = await getBackupRecord(payload.backupId);
      await heartbeatJob(job.id, WORKER_ID, { leaseMs: DEFAULT_LEASE_MS, progress: `正在执行 ${record?.type ?? "UNKNOWN"} 备份` });
      const backup = await runExistingBackupRecord({ id: payload.backupId, projectRoot: payload.projectRoot });
      await completeJob(job.id, WORKER_ID, {
        backupId: backup.id,
        status: backup.status,
        filePath: backup.filePath,
        fileSize: backup.fileSize ?? null,
      });
      return true;
    }

    if (job.type === BACKUP_RESTORE_JOB_TYPE) {
      const payload = parseRestorePayload(job.payload);
      await heartbeatJob(job.id, WORKER_ID, { leaseMs: DEFAULT_LEASE_MS, progress: "正在恢复备份" });
      const restore = await restoreBackupRecord({ id: payload.backupId, confirm: payload.confirm, projectRoot: payload.projectRoot });
      await completeJob(job.id, WORKER_ID, restore);
      return true;
    }

    throw new Error(`不支持的备份任务类型：${job.type}`);
  } catch (error) {
    const message = error instanceof Error ? error.message : "备份任务执行失败";
    await failJob(job.id, WORKER_ID, message.slice(0, 2000), { retryAfterMs: 60_000 });
    logger.error("backup job failed", { jobId: job.id, type: job.type, error: message });
    return true;
  }
}

export async function runBackupJobWorkerOnce() {
  if (running) return false;
  running = true;
  try {
    const job = await claimNextJob({ workerId: WORKER_ID, types: BACKUP_JOB_TYPES, leaseMs: DEFAULT_LEASE_MS });
    return handleJob(job);
  } finally {
    running = false;
  }
}

export function startBackupJobWorker(options: { pollMs?: number } = {}) {
  if (timer) return;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  timer = setInterval(() => {
    void runBackupJobWorkerOnce().catch((error) => {
      logger.error("backup job worker tick failed", { error: error instanceof Error ? error.message : String(error) });
    });
  }, pollMs);
  timer.unref?.();
  logger.info("backup job worker started", { workerId: WORKER_ID, pollMs });
}

export function stopBackupJobWorkerForTests() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
