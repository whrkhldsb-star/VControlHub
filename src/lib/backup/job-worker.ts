import { ForbiddenError } from "@/lib/errors";
import type { RoleKey } from "@/lib/auth/rbac";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

import {
  abandonStalePendingBackupRecords,
  getBackupRecord,
  drillBackupRecord,
  pruneOldBackupRecordsNow,
  runExistingBackupRecord,
} from "@/lib/backup/service";
import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";

function isLeaseLostError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "LeaseLostError");
}
import {
  claimNextJob,
  completeJob,
  failJob,
  failJobTerminal,
  heartbeatJob,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";
import { t } from "@/lib/i18n/service-translations";
import { canCreatePlatformBackup } from "./service-crud";
import { BACKUP_CREATE_JOB_TYPE } from "./service-types";

/** The offsite prune is platform-wide; keep it to one run per day across retention tasks. */
const OFFSITE_PRUNE_INTERVAL_MS = 24 * 60 * 60_000;
let lastOffsitePruneAt = 0;

const logger = createLogger("backup-job-worker");

/**
 * Marks a failure that will NEVER succeed on retry — a malformed payload, an
 * unsupported job type, or a record that is gone / outside the job's team
 * scope. These must fail terminally instead of burning all maxAttempts retries
 * (every 60s) on an outcome that cannot change.
 */
class PermanentBackupJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PermanentBackupJobError";
  }
}

// Defined beside the record helpers: the stale-record sweep there checks this job's lease.
export { BACKUP_CREATE_JOB_TYPE };
export const BACKUP_RESTORE_JOB_TYPE = "backup.restore";
export const BACKUP_RETENTION_JOB_TYPE = "backup.retention";
export const BACKUP_DRILL_JOB_TYPE = "backup.drill";
export const BACKUP_OFFSITE_SYNC_JOB_TYPE = "backup.offsite-sync";

const BACKUP_JOB_TYPES = [
  BACKUP_CREATE_JOB_TYPE,
  BACKUP_RESTORE_JOB_TYPE,
  BACKUP_RETENTION_JOB_TYPE,
  BACKUP_DRILL_JOB_TYPE,
  BACKUP_OFFSITE_SYNC_JOB_TYPE,
];
const DEFAULT_POLL_MS = 5_000;
const STALE_PENDING_SWEEP_MS = 15 * 60_000;
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:backup:${process.pid}`;
// TR-002 R2: 跨 worker lease 公式统一。computeLeaseMs 默认返 preset (= 30s, 等同原 LEASE_MS)。
const LEASE_MS = computeLeaseMs("backup");

type BackupCreatePayload = {
  backupId: string;
  projectRoot?: string;
  retentionDays?: number;
  teamId?: string | null;
  scheduleId?: string;
};

type BackupRetentionPayload = {
  olderThanDays?: number;
  keepLatestPerType?: number;
  projectRoot?: string;
  teamId?: string | null;
  /** After a scheduled backup: that schedule's retention, applied to its own backups. */
  scheduleId?: string;
  /** Retention of the platform's own backups (no customer), made in the all-customers view. */
  platformScope?: boolean;
  /** The platform's daily tick: offsite objects only; local records are pruned per customer. */
  offsiteOnly?: boolean;
};

function parseRetentionPayload(
  payload: Prisma.JsonValue,
): BackupRetentionPayload {
  if (payload == null) return {};
  if (!isRecord(payload)) {
    throw new PermanentBackupJobError("Invalid backup retention job payload format");
  }
  const olderThanDays =
    typeof payload.olderThanDays === "number" &&
    Number.isFinite(payload.olderThanDays) &&
    payload.olderThanDays > 0
      ? Math.floor(payload.olderThanDays)
      : undefined;
  const keepLatestPerType =
    typeof payload.keepLatestPerType === "number" &&
    Number.isFinite(payload.keepLatestPerType) &&
    payload.keepLatestPerType >= 0
      ? Math.floor(payload.keepLatestPerType)
      : undefined;
  const projectRoot =
    typeof payload.projectRoot === "string" && payload.projectRoot.trim()
      ? payload.projectRoot.trim()
      : undefined;
  const teamId =
    typeof payload.teamId === "string" && payload.teamId.trim()
      ? payload.teamId.trim()
      : null;
  const scheduleId = typeof payload.scheduleId === "string" && payload.scheduleId.trim() ? payload.scheduleId.trim() : undefined;
  return { olderThanDays, keepLatestPerType, projectRoot, teamId, scheduleId, platformScope: payload.platformScope === true && !teamId, offsiteOnly: payload.offsiteOnly === true };
}

/**
 * A schedule's retention covers the backups that schedule made. Manual
 * backups belong to no schedule; as for VPS backups they follow the longest
 * retention among the customer's active schedules.
 */
async function pruneScheduledBackups(payload: BackupRetentionPayload, signal?: AbortSignal) {
  signal?.throwIfAborted();
  const base = {
    keepLatestPerType: payload.keepLatestPerType,
    projectRoot: payload.projectRoot,
    teamId: payload.teamId,
    platformScope: payload.platformScope,
    ...(signal ? { signal } : {}),
  };
  const schedule = await prisma.backupSchedule.findFirst({
    where: { id: payload.scheduleId, teamId: payload.teamId ?? null, status: "ACTIVE" }, select: { retentionDays: true },
  });
  if (!schedule?.retentionDays) return null;
  const own = await pruneOldBackupRecordsNow({ ...base, olderThanDays: schedule.retentionDays, scheduleId: payload.scheduleId });
  signal?.throwIfAborted();
  // Manual backups follow the longest retention among the owner's active schedules: the customer's, or for the
  // platform's own backups the platform's (schedules made in the all-customers view have no customer).
  if (!payload.teamId && !payload.platformScope) return own;
  const longest = await prisma.backupSchedule.aggregate({
    where: { teamId: payload.teamId ?? null, status: "ACTIVE", retentionDays: { gt: 0 } },
    _max: { retentionDays: true },
  });
  if (!longest._max.retentionDays) return own;
  const manual = await pruneOldBackupRecordsNow({ ...base, olderThanDays: longest._max.retentionDays, scheduleId: null });
  return {
    ...own,
    deletedRecords: own.deletedRecords + manual.deletedRecords,
    filesDeleted: own.filesDeleted + manual.filesDeleted,
    filesSkipped: own.filesSkipped + manual.filesSkipped,
    fileErrors: [...own.fileErrors, ...manual.fileErrors],
    candidateIds: [...own.candidateIds, ...manual.candidateIds],
  };
}

let timer: NodeJS.Timeout | null = null;
let staleSweepTimer: NodeJS.Timeout | null = null;
let running = false;
let sweepingStale = false;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseCreatePayload(payload: Prisma.JsonValue): BackupCreatePayload {
  if (
    !isRecord(payload) ||
    typeof payload.backupId !== "string" ||
    !payload.backupId.trim()
  ) {
    throw new PermanentBackupJobError("Backup job payload missing backupId");
  }
  const retentionDays =
    typeof payload.retentionDays === "number" &&
    Number.isFinite(payload.retentionDays) &&
    payload.retentionDays > 0
      ? Math.floor(payload.retentionDays)
      : undefined;
  const teamId =
    typeof payload.teamId === "string" && payload.teamId.trim()
      ? payload.teamId.trim()
      : null;
  return {
    backupId: payload.backupId.trim(),
    projectRoot:
      typeof payload.projectRoot === "string" && payload.projectRoot.trim()
        ? payload.projectRoot.trim()
        : undefined,
    retentionDays,
    teamId,
    scheduleId: typeof payload.scheduleId === "string" && payload.scheduleId.trim() ? payload.scheduleId.trim() : undefined,
  };
}

function workerSession(
  job: { createdBy?: string | null; teamId?: string | null },
  payloadTeamId?: string | null,
):
  | { userId: string; roles: RoleKey[]; currentTeamId: string | null }
  | undefined {
  const teamId = (payloadTeamId && payloadTeamId.trim()) || job.teamId || null;
  if (!teamId) return undefined;
  // Do NOT elevate to admin: team:manage would make teamWhere() empty and ignore team boundaries.
  // Scope is enforced via currentTeamId only (operator-equivalent for backup job execution).
  return {
    userId: job.createdBy ?? "system",
    roles: ["operator" as RoleKey],
    currentTeamId: teamId,
  };
}

async function requirePlatformBackupOwner(userId: string | null) {
  if (!userId || !await canCreatePlatformBackup(userId)) throw new ForbiddenError(t("backend.execution.ownerInactive"));
}

async function handleJob(job: Awaited<ReturnType<typeof claimNextJob>>) {
  if (!job) return false;
  try {
    if (job.type === BACKUP_CREATE_JOB_TYPE) {
      const payload = parseCreatePayload(job.payload);
      const scope = workerSession(job, payload.teamId);
      const record = await getBackupRecord(payload.backupId, scope);
      if (!record) {
        // Terminal: a deleted record (or one outside this job's team scope)
        // never reappears, so retrying every 60s until maxAttempts is wasted.
        await failJobTerminal(
          job.id,
          WORKER_ID,
          "Backup record not found or outside job team scope",
          ...(job.attempts !== undefined ? [{ attempts: job.attempts }] : []),
        );
        return true;
      }
      const lease = await heartbeatJob(job.id, WORKER_ID, {
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}), leaseMs: LEASE_MS,
        progress: `Running ${record?.type ?? "UNKNOWN"} backup`,
      });
      if (lease && lease.count === 0) return true;
      const backup = await runWithLeaseHeartbeat({
        jobId: job.id,
        leaseMs: LEASE_MS,
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        heartbeat: () =>
          heartbeatJob(job.id, WORKER_ID, {
            leaseMs: LEASE_MS,
            ...(job.attempts !== undefined ? { attempts: job.attempts } : {}), progress: `Running ${record?.type ?? "UNKNOWN"} backup`,
          }),
        run: (signal) =>
          runExistingBackupRecord({
            signal,
            claim: { id: job.id, workerId: WORKER_ID, attempts: job.attempts },
            id: payload.backupId,
            requestedBy: job.createdBy ?? null,
            projectRoot: payload.projectRoot,
            session: scope,
          }),
      });
      // runExistingBackupRecord returns FAILED records without throwing — do not completeJob.
      // Fail terminally: a FAILED BackupRecord can never be re-claimed from PENDING,
      // so retrying would only overwrite the real failure message with ConflictError.
      if (backup.status !== "COMPLETED") {
        const message = (
          backup.errorMessage || `Backup finished with status ${backup.status}`
        ).slice(0, 2000);
        await failJobTerminal(job.id, WORKER_ID, message, ...(job.attempts !== undefined ? [{ attempts: job.attempts }] : []));
        logger.error("backup create job finished without COMPLETED status", {
          jobId: job.id,
          backupId: backup.id,
          status: backup.status,
          error: message,
        });
        return true;
      }
      const completed = await completeJob(job.id, WORKER_ID, {
        backupId: backup.id,
        status: backup.status,
        filePath: backup.filePath,
        fileSize: backup.fileSize ?? null,
      }, ...(job.attempts !== undefined ? [job.attempts] : []));
      if (completed && completed.count === 0) {
        logger.warn("skip retention enqueue: backup create job completion was rejected (lease lost or cancelled)", {
          jobId: job.id,
          backupId: backup.id,
        });
        return true;
      }
      // A schedule resolves its policy when cleanup runs. Legacy manual jobs carry days.
      if (payload.scheduleId || (payload.retentionDays && payload.retentionDays > 0)) {
        const teamId = payload.teamId ?? job.teamId ?? backup.teamId ?? null;
        // A schedule made in the all-customers view has no customer, but its retention still has to run (the
        // schedule bounds it): the backups piled up until the disk filled.
        if (teamId || payload.scheduleId) {
          try {
            const { enqueueJob } = await import("@/lib/job/service");
            await enqueueJob({
              type: BACKUP_RETENTION_JOB_TYPE,
              title: "Clean up old backups (automatic retention policy)",
              payload: {
                ...(!payload.scheduleId ? { olderThanDays: payload.retentionDays } : {}),
                ...(teamId ? { teamId } : { platformScope: true }),
                projectRoot: payload.projectRoot,
                // The schedule the payload came from: its retention used to
                // prune every backup of the customer, so a daily schedule
                // keeping 1 day deleted a monthly schedule's archives.
                scheduleId: payload.scheduleId,
              },
              createdBy: job.createdBy ?? null,
              teamId: teamId ?? null,
              maxAttempts: 1,
            });
          } catch (retentionErr) {
            logger.error("failed to enqueue backup retention after create", {
              backupId: backup.id,
              error:
                retentionErr instanceof Error
                  ? retentionErr.message
                  : String(retentionErr),
            });
          }
        } else {
          logger.warn(
            "skip retention enqueue: no teamId on backup create job",
            { backupId: backup.id },
          );
        }
      }
      return true;
    }

    if (job.type === BACKUP_RESTORE_JOB_TYPE) {
      // Restore is offline only (see prepareOfflineRestore). A restore job
      // queued by an older version fails permanently instead of running.
      throw new PermanentBackupJobError(t("backend.backup.offlineRestoreRequired"));
    }

    if (job.type === BACKUP_RETENTION_JOB_TYPE) {
      const payload = parseRetentionPayload(job.payload);
      // Only the system daily offsite sweep has no submitting account.
      if (job.createdBy || !payload.offsiteOnly) await requirePlatformBackupOwner(job.createdBy);
      const lease = await heartbeatJob(job.id, WORKER_ID, {
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        leaseMs: LEASE_MS,
        progress: "Cleaning up old backups",
      });
      if (lease && lease.count === 0) return true;
      const { summary, offsite } = await runWithLeaseHeartbeat({
        jobId: job.id,
        leaseMs: LEASE_MS,
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        heartbeat: () =>
          heartbeatJob(job.id, WORKER_ID, {
            ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
            leaseMs: LEASE_MS,
            progress: "Cleaning up old backups",
          }),
        run: async (signal) => {
          signal?.throwIfAborted();
          const localSummary = payload.offsiteOnly
            ? null
            : payload.scheduleId
              ? await pruneScheduledBackups(payload, signal)
              : await pruneOldBackupRecordsNow({
                  olderThanDays: payload.olderThanDays,
                  keepLatestPerType: payload.keepLatestPerType,
                  projectRoot: payload.projectRoot,
                  teamId: payload.teamId,
                  platformScope: payload.platformScope,
                  ...(signal ? { signal } : {}),
                });
          signal?.throwIfAborted();
          let offsiteResult: Awaited<
            ReturnType<
              typeof import("./offsite-retention").pruneOffsiteObjects
            >
          > | null = null;
          try {
            if (payload.offsiteOnly || Date.now() - lastOffsitePruneAt >= OFFSITE_PRUNE_INTERVAL_MS) {
              const { pruneOffsiteObjects } =
                await import("./offsite-retention");
              offsiteResult = await pruneOffsiteObjects(signal ? { signal } : undefined);
              lastOffsitePruneAt = Date.now();
            }
          } catch (offsiteErr) {
            if (isLeaseLostError(offsiteErr) || signal?.aborted) {
              throw offsiteErr;
            }
            logger.warn("offsite retention prune failed (non-fatal)", {
              error:
                offsiteErr instanceof Error
                  ? offsiteErr.message
                  : String(offsiteErr),
            });
          }
          return { summary: localSummary, offsite: offsiteResult };
        },
      });
      await completeJob(job.id, WORKER_ID, {
        retention: summary
          ? {
              deletedRecords: summary.deletedRecords,
              filesDeleted: summary.filesDeleted,
              filesSkipped: summary.filesSkipped,
              fileErrors: summary.fileErrors,
              olderThanDays: summary.olderThanDays,
              keepLatestPerType: summary.keepLatestPerType,
              cutoff: summary.cutoff.toISOString(),
              oldestKeptByType: Object.fromEntries(
                Object.entries(summary.oldestKeptByType).map(([k, v]) => [
                  k,
                  v ? v.toISOString() : null,
                ]),
              ),
            }
          : null,
        offsite,
      }, ...(job.attempts !== undefined ? [job.attempts] : []));
      return true;
    }

    if (job.type === BACKUP_OFFSITE_SYNC_JOB_TYPE) {
      const lease = await heartbeatJob(job.id, WORKER_ID, {
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        leaseMs: LEASE_MS,
        progress: "Uploading pending offsite backups",
      });
      if (lease && lease.count === 0) return true;
      const { retryPendingOffsiteUploads } =
        await import("@/lib/backup/offsite-uploader");
      const summary = await runWithLeaseHeartbeat({
        jobId: job.id,
        leaseMs: LEASE_MS,
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        heartbeat: () =>
          heartbeatJob(job.id, WORKER_ID, {
            ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
            leaseMs: LEASE_MS,
            progress: "Uploading pending offsite backups",
          }),
        run: async (signal) => {
          signal?.throwIfAborted();
          const local = await retryPendingOffsiteUploads({
            projectRoot: config.app.appDir,
          });
          signal?.throwIfAborted();
          const { retryPendingVpsOffsiteUploads } =
            await import("@/lib/backup/vps-backup-service");
          const vps = await retryPendingVpsOffsiteUploads();
          return {
            local,
            vps,
            observed: local.observed + vps.observed,
            uploaded: local.uploaded + vps.uploaded,
            failed: local.failed + vps.failed,
            skipped: local.skipped + vps.skipped,
          };
        },
      });
      if (summary.failed > 0) {
        if ((job.attempts ?? 1) <= 1) {
          const { sendOffsiteFailureAlert } = await import("@/lib/backup/offsite-uploader");
          const { loadOffsiteConfig } = await import("@/lib/storage/offsite/schema");
          const recipient = await loadOffsiteConfig().then((offsite) => offsite.failureAlertRecipient).catch(() => null);
          await sendOffsiteFailureAlert({
            recipient,
            backupLabel: `${summary.failed} of ${summary.observed} pending backups`,
            error: [...(summary.local.errors ?? []), ...(summary.vps.errors ?? [])].slice(0, 5).join("\n"),
          });
        }
        throw new Error(
          `Offsite backup sync failed for ${summary.failed} of ${summary.observed} record(s)`,
        );
      }
      await completeJob(job.id, WORKER_ID, summary, ...(job.attempts !== undefined ? [job.attempts] : []));
      return true;
    }

    if (job.type === BACKUP_DRILL_JOB_TYPE) {
      await requirePlatformBackupOwner(job.createdBy);
      const payload = parseCreatePayload(job.payload);
      const scope = workerSession(job, payload.teamId);
      const lease = await heartbeatJob(job.id, WORKER_ID, {
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        leaseMs: LEASE_MS,
        progress: "Running non-destructive restore drill",
      });
      if (lease && lease.count === 0) return true;
      const report = await runWithLeaseHeartbeat({
        jobId: job.id,
        leaseMs: LEASE_MS,
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        heartbeat: () =>
          heartbeatJob(job.id, WORKER_ID, {
            ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
            leaseMs: LEASE_MS,
            progress: "Verifying backup checksum and archive format",
          }),
        run: (signal) => {
          signal?.throwIfAborted();
          return drillBackupRecord({
            id: payload.backupId,
            projectRoot: payload.projectRoot,
            session: scope,
          });
        },
      });
      await completeJob(job.id, WORKER_ID, { drillReport: report }, ...(job.attempts !== undefined ? [job.attempts] : []));
      return true;
    }

    throw new PermanentBackupJobError(`Unsupported backup job type: ${job.type}`);
  } catch (error) {
    if (isLeaseLostError(error)) {
      logger.warn("backup job lost lease; leaving row for replacement worker", {
        jobId: job.id,
        type: job.type,
      });
      return true;
    }
    const message =
      error instanceof Error ? error.message : "Backup task execution failed";
    if (error instanceof PermanentBackupJobError || error instanceof ForbiddenError) {
      await failJobTerminal(job.id, WORKER_ID, message.slice(0, 2000), ...(job.attempts !== undefined ? [{ attempts: job.attempts }] : []));
    } else {
      await failJob(job.id, WORKER_ID, message.slice(0, 2000), {
        ...(job.attempts !== undefined ? { attempts: job.attempts } : {}),
        retryAfterMs: 60_000,
      });
    }
    logger.error("backup job failed", {
      jobId: job.id,
      type: job.type,
      permanent: error instanceof PermanentBackupJobError || error instanceof ForbiddenError,
      error: message,
    });
    return true;
  }
}

export async function runBackupJobWorkerOnce() {
  if (running) return false;
  running = true;
  try {
    const job = await claimNextJob({
      workerId: WORKER_ID,
      types: BACKUP_JOB_TYPES,
      leaseMs: LEASE_MS,
    });
    return await handleJob(job);
  } finally {
    running = false;
  }
}

async function sweepStalePendingBackupsOnce(reason = "interval") {
  if (sweepingStale) return { abandoned: 0, ids: [] as string[] };
  sweepingStale = true;
  try {
    const result = await abandonStalePendingBackupRecords({
      olderThanMs: 24 * 60 * 60 * 1000,
      reason: "Stale PENDING backup abandoned after 24h without worker claim",
    });
    if (result.abandoned > 0) {
      logger.warn("abandoned stale PENDING backup records", {
        reason,
        abandoned: result.abandoned,
        ids: result.ids,
      });
    }
    return result;
  } catch (error) {
    logger.error("stale PENDING backup sweep failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return { abandoned: 0, ids: [] as string[] };
  } finally {
    sweepingStale = false;
  }
}

export function startBackupJobWorker(options: { pollMs?: number } = {}) {
  if (timer) return;
  const pollMs = options.pollMs ?? DEFAULT_POLL_MS;
  timer = setInterval(() => {
    void runBackupJobWorkerOnce().catch((error) => {
      logger.error("backup job worker tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, pollMs);
  timer.unref?.();

  // One-shot + periodic cleanup for orphan PENDING records (no durable job left).
  void sweepStalePendingBackupsOnce("startup").catch(() => undefined);
  staleSweepTimer = setInterval(() => {
    void sweepStalePendingBackupsOnce().catch(() => undefined);
  }, STALE_PENDING_SWEEP_MS);
  staleSweepTimer.unref?.();

  logger.info("backup job worker started", { workerId: WORKER_ID, pollMs });
}

export function stopBackupJobWorkerForTests() {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
  if (staleSweepTimer) {
    clearInterval(staleSweepTimer);
    staleSweepTimer = null;
  }
  running = false;
  sweepingStale = false;
}
