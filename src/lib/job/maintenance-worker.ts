/**
 * Job maintenance — abandon stale PENDING jobs with no known consumer,
 * and finalize stale RUNNING jobs whose lease expired (including attempt-
 * exhausted rows that claimNextJob will never re-claim).
 *
 * Historical migrations / experimental job types (e.g. `playbook.command`)
 * can leave forever-PENDING rows that no worker claims. This keeps the
 * queue honest without reintroducing those dead types.
 */
import { JobStatus } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { pruneJobEvents } from "@/lib/job/events";
import { recoverStaleRunningJobs } from "@/lib/job/service";
import { MAX_LEASE_MS } from "@/lib/job/lease";
import {
  abandonStalePendingVpsBackupRecords,
  abandonStaleRunningVpsBackupRecords,
} from "@/lib/backup/vps-backup-service";
import { abandonStaleRunningBackupRecords } from "@/lib/backup/service";
import { sweepExpiredMediaUploadSessions } from "@/lib/upload/service";

const logger = createLogger("job-maintenance-worker");

/**
 * Known durable job types with a consumer. Keep this list explicit — do NOT
 * import WORKER_REGISTRY here (registry imports this module; a cycle causes
 * TDZ failures when Next collects `/api/admin/workers` page data).
 */
const KNOWN_JOB_TYPES = new Set([
  "backup.create",
  "backup.restore",
  "backup.retention",
  "backup.drill",
  "backup.offsite-sync",
  "backup-schedule.tick",
  "vps-backup.create",
  "vps-backup-schedule.tick",
  "command.execution",
  "command.maintenance",
  "download.execute",
  "playbook.trigger.tick",
  "playbook.run",
  "scheduled-task.tick",
  "health.sample",
  "alert.evaluate",
  "traffic.sample",
  "cost.snapshot",
  "ticket.sla-escalate",
  "itsm.outbound",
  "ai-ops.scan",
  "ai.ops.scan",
  // NOTE: the real type emitted by QUICK_SERVICE_JOB_TYPE uses an underscore.
  // The hyphenated spelling was never enqueued by anything; keeping only it
  // made every real quick-service job look like an "orphan type" and get
  // CANCELLED after 24h instead of the 7d hard-orphan window. Keep both so a
  // historical row of either spelling is still recognised.
  "quick_service.lifecycle",
  "quick-service.lifecycle",
  "storage.sftp-sync",
  "sftp.sync",
  "storage.sftp-stale-inventory",
  "sftp.stale-inventory",
  "sync.schedule.tick",
  "sync.schedule",
  "operation-task.retention",
  "job.maintenance",
]);

const DEFAULT_INTERVAL_MS = 15 * 60_000;
const STALE_PENDING_MS = 24 * 60 * 60 * 1000;
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:job-maintenance:${process.pid}`;

type State = { started: boolean; running: boolean; timer: NodeJS.Timeout | null };
type G = typeof globalThis & { __vcontrolhubJobMaintenanceWorker?: State };

function getState(): State {
  const g = globalThis as G;
  g.__vcontrolhubJobMaintenanceWorker ??= { started: false, running: false, timer: null };
  return g.__vcontrolhubJobMaintenanceWorker;
}

/**
 * Cancel PENDING jobs that are:
 *  - older than 24h, AND
 *  - of an unknown type (no registered consumer), OR
 *  - of a known type but never claimed and older than 7d (hard orphan).
 */
export async function abandonOrphanPendingJobs(options?: {
  olderThanMs?: number;
  hardOrphanMs?: number;
  limit?: number;
}) {
  const olderThanMs = options?.olderThanMs ?? STALE_PENDING_MS;
  const hardOrphanMs = options?.hardOrphanMs ?? 7 * 24 * 60 * 60 * 1000;
  const limit = Math.min(Math.max(options?.limit ?? 100, 1), 500);
  const softCutoff = new Date(Date.now() - olderThanMs);
  const hardCutoff = new Date(Date.now() - hardOrphanMs);

  const candidates = await prisma.job.findMany({
    where: {
      status: JobStatus.PENDING,
      createdAt: { lt: softCutoff },
    },
    select: { id: true, type: true, createdAt: true, title: true },
    orderBy: { createdAt: "asc" },
    take: limit,
  });

  const toCancel = candidates.filter((job) => {
    if (!KNOWN_JOB_TYPES.has(job.type)) return true;
    return job.createdAt < hardCutoff;
  });
  if (toCancel.length === 0) return { cancelled: 0, ids: [] as string[] };

  const ids: string[] = [];
  for (const job of toCancel) {
    const updated = await prisma.job.updateMany({
      where: { id: job.id, status: JobStatus.PENDING },
      data: {
        status: JobStatus.CANCELLED,
        cancelledAt: new Date(),
        errorMessage: KNOWN_JOB_TYPES.has(job.type)
          ? "Stale PENDING job abandoned after 7d without claim"
          : `Orphan job type cancelled (no consumer): ${job.type}`,
        workerId: null,
        workerHeartbeatAt: null,
        leaseExpiresAt: null,
      },
    });
    if (updated.count > 0) ids.push(job.id);
  }

  if (ids.length > 0) {
    logger.warn("abandoned orphan PENDING jobs", {
      workerId: WORKER_ID,
      cancelled: ids.length,
      ids,
      types: [...new Set(toCancel.map((j) => j.type))],
    });
  }
  return { cancelled: ids.length, ids };
}

async function tick(reason: string) {
  const state = getState();
  if (state.running) return;
  state.running = true;
  try {
    await abandonOrphanPendingJobs();
    // Free concurrency slots held by dead workers: re-queue retryable
    // expired leases, terminal-fail attempt-exhausted RUNNING rows.
    // Without this, recoverStaleRunningJobs is only unit-tested and
    // claimNextJob alone cannot clear attempts>=maxAttempts zombies.
    const staleBefore = new Date();
    const recovered = await recoverStaleRunningJobs({
      staleBefore,
      // Modern claims always carry leaseExpiresAt. This fallback is only for
      // historical RUNNING rows created before leases were introduced.
      heartbeatStaleBefore: new Date(staleBefore.getTime() - MAX_LEASE_MS),
    });
    if (recovered.count > 0) {
      logger.warn("recovered stale RUNNING jobs", {
        workerId: WORKER_ID,
        recovered: recovered.recovered.length,
        failed: recovered.failed.length,
        recoveredIds: recovered.recovered,
        failedIds: recovered.failed,
      });
    }
    // VpsBackupRecord rows are downstream of the jobs recovered above but are
    // NOT touched by recoverStaleRunningJobs (which only finalizes Job rows).
    // Without this, a worker that dies mid-backup (OOM/SIGKILL, so the in-proc
    // catch never runs) leaves the record stuck RUNNING forever — invisible as
    // a failure and un-deletable (deleteVpsBackupRecord refuses RUNNING rows).
    const abandonedVpsBackups = await abandonStaleRunningVpsBackupRecords();
    if (abandonedVpsBackups.abandoned > 0) {
      logger.warn("abandoned stale RUNNING vps backup records", {
        workerId: WORKER_ID,
        abandoned: abandonedVpsBackups.abandoned,
        ids: abandonedVpsBackups.ids,
      });
    }
    // PENDING VpsBackupRecords are stranded when a worker dies/throws BEFORE the
    // PENDING→RUNNING CAS (transient DB error on the pre-claim findUnique/initial
    // heartbeat, or OOM/redeploy in that window). The RUNNING reaper above cannot
    // see them, and an orphaned PENDING row permanently wedges that server's
    // schedule via dispatchDueVpsBackupSchedules' overlap guard (counts
    // PENDING+RUNNING). Mirror of the LOCAL path's stale-PENDING sweep.
    const abandonedPendingVpsBackups = await abandonStalePendingVpsBackupRecords();
    if (abandonedPendingVpsBackups.abandoned > 0) {
      logger.warn("abandoned stale PENDING vps backup records", {
        workerId: WORKER_ID,
        abandoned: abandonedPendingVpsBackups.abandoned,
        ids: abandonedPendingVpsBackups.ids,
      });
    }
    // LOCAL BackupRecords have the same crashed-mid-run gap as VPS: the backup
    // job-worker's own sweep only clears stale PENDING, and a worker killed
    // mid-run (OOM/SIGKILL) strands the record RUNNING forever — un-voidable and
    // un-retryable. Reap them here alongside the VPS RUNNING reaper.
    const abandonedRunningBackups = await abandonStaleRunningBackupRecords();
    if (abandonedRunningBackups.abandoned > 0) {
      logger.warn("abandoned stale RUNNING backup records", {
        workerId: WORKER_ID,
        abandoned: abandonedRunningBackups.abandoned,
        ids: abandonedRunningBackups.ids,
      });
    }
    // Reclaim temp chunks + session rows from uploads abandoned mid-flight
    // (tab closed / network dropped). The sweep function existed but was never
    // scheduled, so /tmp and mediaUploadSession grew unbounded.
    const sweptUploads = await sweepExpiredMediaUploadSessions();
    if (sweptUploads > 0) {
      logger.info("swept expired media upload sessions", {
        workerId: WORKER_ID,
        swept: sweptUploads,
      });
    }
    // Bound job_events growth: drop events older than 30d while always
    // retaining the newest KEEP_LATEST rows so recent timelines stay intact.
    const olderThan = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const pruned = await pruneJobEvents({ olderThan, keepLatest: 5000 });
    if (pruned.count > 0) {
      logger.info("pruned job events", {
        workerId: WORKER_ID,
        deleted: pruned.count,
        olderThan: olderThan.toISOString(),
      });
    }
  } catch (error) {
    logger.error("job maintenance tick failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    state.running = false;
  }
}

export async function startJobMaintenanceWorker(options?: { intervalMs?: number }) {
  const state = getState();
  if (state.started) return state;
  state.started = true;
  const intervalMs = options?.intervalMs ?? DEFAULT_INTERVAL_MS;
  void tick("startup");
  state.timer = setInterval(() => {
    void tick("interval");
  }, intervalMs);
  state.timer.unref?.();
  logger.info("job maintenance worker started", { workerId: WORKER_ID, intervalMs });
  return state;
}

export function stopJobMaintenanceWorkerForTests() {
  const state = getState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.running = false;
  state.timer = null;
}

/** Test helper */
export function _knownJobTypesForTests() {
  return new Set(KNOWN_JOB_TYPES);
}
