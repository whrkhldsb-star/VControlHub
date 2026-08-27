/**
 * TR-043: VPS backup job worker — durable job queue consumer.
 *
 * Polls the job queue for `vps-backup.create` jobs and executes
 * the backup flow via runVpsBackupRecord().
 */

import {
  claimNextJob,
  completeJob,
  failJob,
  heartbeatJob,
} from "@/lib/job/service";
import {
  forceFailVpsBackupRecordIfRunning,
  runVpsBackupRecord,
  VPS_BACKUP_CREATE_JOB_TYPE,
} from "./vps-backup-service";
import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import { LeaseLostError, runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { createLogger } from "@/lib/logging";

const POLL_INTERVAL_MS = 5000;
const LEASE_MS = computeLeaseMs("vps-backup");
const WORKER_ID = `${config.app.hostname || "localhost"}:vps-backup:${process.pid}`;
const logger = createLogger("vps-backup-job-worker");

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Process a single job tick: claim next job, run backup, complete/fail.
 */
export async function runVpsBackupJobWorkerOnce(): Promise<void> {
  const job = await claimNextJob({
    workerId: WORKER_ID,
    types: [VPS_BACKUP_CREATE_JOB_TYPE],
    leaseMs: LEASE_MS,
  });

  if (!job) return;

  try {
    // Heartbeat to extend lease before starting
    await heartbeatJob(job.id, WORKER_ID);

    const payload = job.payload as { recordId?: string; paths?: string[] };
    if (!payload?.recordId) {
      await failJob(job.id, WORKER_ID, "Missing recordId in job payload");
      return;
    }

    const paths = Array.isArray(payload.paths)
      ? payload.paths
          .filter(
            (p): p is string => typeof p === "string" && p.trim().length > 0,
          )
          .slice(0, 20)
      : undefined;
    const result = await runWithLeaseHeartbeat({
      jobId: job.id,
      leaseMs: LEASE_MS,
      heartbeat: () =>
        heartbeatJob(job.id, WORKER_ID, {
          leaseMs: LEASE_MS,
          progress: "Running VPS backup",
        }),
      run: () =>
        runVpsBackupRecord(
          payload.recordId!,
          paths?.length ? { paths } : undefined,
        ),
    });

    if (result.success) {
      await completeJob(job.id, WORKER_ID, {
        fileSize: result.fileSize,
        checksumSha256: result.checksumSha256,
        localPath: result.localPath,
      });
    } else {
      await failJob(job.id, WORKER_ID, result.errorMessage || "Backup failed");
    }
  } catch (err) {
    // The backup work (run()) completed but the lease could no longer be
    // renewed — runWithLeaseHeartbeat throws LeaseLostError AFTER run()
    // resolves. The business record already holds its terminal state, so
    // do NOT force-fail it (that would mark a succeeded backup FAILED).
    // Let the job/lease reaper reconcile the durable job row.
    if (err instanceof LeaseLostError) {
      logger.warn("VPS backup lost its lease after completing; not force-failing the record", {
        jobId: job.id,
      });
      return;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    const payload = job.payload as { recordId?: string };
    if (payload?.recordId) {
      await forceFailVpsBackupRecordIfRunning(
        payload.recordId,
        `Job worker failed: ${errMsg}`,
      ).catch(() => undefined);
    }
    await failJob(job.id, WORKER_ID, errMsg);
  }
}

/**
 * Start the VPS backup job worker — polls every 5 seconds.
 */
export function startVpsBackupJobWorker(): ReturnType<typeof setInterval> {
  if (interval) return interval;

  interval = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      await runVpsBackupJobWorkerOnce();
    } catch {
      // Swallow errors to keep the worker alive
    } finally {
      running = false;
    }
  }, POLL_INTERVAL_MS);

  return interval;
}

/** Stop the VPS backup job worker (for tests / graceful shutdown) */
export function stopVpsBackupForTests(): void {
  if (interval) {
    clearInterval(interval);
    interval = null;
  }
  running = false;
}
