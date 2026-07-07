import { Prisma } from "@prisma/client";

import {
  getBackupRecord,
  pruneOldBackupRecordsNow,
  restoreBackupRecord,
  runExistingBackupRecord,
} from "@/lib/backup/service";
import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

const logger = createLogger("backup-job-worker");

export const BACKUP_CREATE_JOB_TYPE = "backup.create";
export const BACKUP_RESTORE_JOB_TYPE = "backup.restore";
export const BACKUP_RETENTION_JOB_TYPE = "backup.retention";

const BACKUP_JOB_TYPES = [BACKUP_CREATE_JOB_TYPE, BACKUP_RESTORE_JOB_TYPE, BACKUP_RETENTION_JOB_TYPE];
const DEFAULT_POLL_MS = 5_000;
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:backup:${process.pid}`;
// TR-002 R2: 跨 worker lease 公式统一。computeLeaseMs 默认返 preset (= 30s, 等同原 LEASE_MS)。
const LEASE_MS = computeLeaseMs("backup");

type BackupCreatePayload = {
  backupId: string;
  projectRoot?: string;
};

type BackupRestorePayload = {
  backupId: string;
  confirm: "RESTORE";
  projectRoot?: string;
};

type BackupRetentionPayload = {
  olderThanDays?: number;
  keepLatestPerType?: number;
  projectRoot?: string;
};

function parseRetentionPayload(payload: Prisma.JsonValue): BackupRetentionPayload {
  if (payload == null) return {};
  if (!isRecord(payload)) {
    throw new Error("Invalid backup retention job payload format");
  }
  const olderThanDays = typeof payload.olderThanDays === "number" && Number.isFinite(payload.olderThanDays) && payload.olderThanDays > 0
    ? Math.floor(payload.olderThanDays)
    : undefined;
  const keepLatestPerType = typeof payload.keepLatestPerType === "number" && Number.isFinite(payload.keepLatestPerType) && payload.keepLatestPerType >= 0
    ? Math.floor(payload.keepLatestPerType)
    : undefined;
  const projectRoot = typeof payload.projectRoot === "string" && payload.projectRoot.trim() ? payload.projectRoot.trim() : undefined;
  return { olderThanDays, keepLatestPerType, projectRoot };
}

let timer: NodeJS.Timeout | null = null;
let running = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseCreatePayload(payload: Prisma.JsonValue): BackupCreatePayload {
  if (!isRecord(payload) || typeof payload.backupId !== "string" || !payload.backupId.trim()) {
    throw new Error("Backup job payload missing backupId");
  }
  return {
    backupId: payload.backupId.trim(),
    projectRoot: typeof payload.projectRoot === "string" && payload.projectRoot.trim() ? payload.projectRoot.trim() : undefined,
  };
}

function parseRestorePayload(payload: Prisma.JsonValue): BackupRestorePayload {
  if (!isRecord(payload) || typeof payload.backupId !== "string" || !payload.backupId.trim()) {
    throw new Error("Restore job payload missing backupId");
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
      await heartbeatJob(job.id, WORKER_ID, { leaseMs: LEASE_MS, progress: `正在执行 ${record?.type ?? "UNKNOWN"} 备份` });
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
      await heartbeatJob(job.id, WORKER_ID, { leaseMs: LEASE_MS, progress: "正在恢复备份" });
      const restore = await restoreBackupRecord({ id: payload.backupId, confirm: payload.confirm, projectRoot: payload.projectRoot });
      await completeJob(job.id, WORKER_ID, restore);
      return true;
    }

    if (job.type === BACKUP_RETENTION_JOB_TYPE) {
      const payload = parseRetentionPayload(job.payload);
      await heartbeatJob(job.id, WORKER_ID, { leaseMs: LEASE_MS, progress: "正在清理旧备份" });
      const summary = await pruneOldBackupRecordsNow({
        olderThanDays: payload.olderThanDays,
        keepLatestPerType: payload.keepLatestPerType,
        projectRoot: payload.projectRoot,
      });
      await completeJob(job.id, WORKER_ID, {
        retention: {
          deletedRecords: summary.deletedRecords,
          filesDeleted: summary.filesDeleted,
          filesSkipped: summary.filesSkipped,
          fileErrors: summary.fileErrors,
          olderThanDays: summary.olderThanDays,
          keepLatestPerType: summary.keepLatestPerType,
          cutoff: summary.cutoff.toISOString(),
          oldestKeptByType: Object.fromEntries(
            Object.entries(summary.oldestKeptByType).map(([k, v]) => [k, v ? v.toISOString() : null]),
          ),
        },
      });
      return true;
    }

    throw new Error(`Unsupported backup job type：${job.type}`);
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
    const job = await claimNextJob({ workerId: WORKER_ID, types: BACKUP_JOB_TYPES, leaseMs: LEASE_MS });
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
