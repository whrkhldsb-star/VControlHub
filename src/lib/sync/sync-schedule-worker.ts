/**
 * Dispatches due SyncJob rows (schedule + lastSyncAt) every minute.
 * Execution reuses executeSyncJob (CAS RUNNING + rsync/tar).
 */
import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { createSingletonIntervalWorker, type SingletonIntervalWorkerState } from "@/lib/workers/singleton-interval-worker";

import { isSyncJobDue } from "./schedule";
import { executeSyncJob, reclaimStaleRunningSyncJobs } from "./service-runtime";

const logger = createLogger("sync-schedule-worker");
const INTERVAL_MS = 60_000;
/**
 * How many due jobs one tick dispatches at a time.
 *
 * Dispatch used to be strictly sequential, so a tick's wall-clock was the SUM of
 * every due rsync. With `take: 100` and jobs that run for minutes, one tick could
 * outlast many interval periods; `state.running` then made every later tick a
 * no-op, and the jobs at the tail of the queue starved behind the head.
 *
 * Kept small on purpose: each running sync is an rsync/tar process plus an SSH
 * session, so this is a fan-out bound, not a throughput dial. Matches
 * EXECUTE_TARGETS_CONCURRENCY in the command executor.
 */
const DISPATCH_CONCURRENCY = 5;
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:sync-schedule:${process.pid}`;

type State = SingletonIntervalWorkerState;

const syncScheduleWorker = createSingletonIntervalWorker({
  globalKey: "__vcontrolhubSyncScheduleWorker",
  resolveIntervalMs: () => INTERVAL_MS,
  tick: (_state, reason) => {
    void runSyncScheduleWorkerOnce(reason).catch((e) =>
      logger.error(reason === "startup" ? "sync schedule startup failed" : "sync schedule tick failed", e),
    );
  },
  onStarted: () => {
    logger.info("sync schedule worker started", { workerId: WORKER_ID, intervalMs: INTERVAL_MS });
  },
});

function getState(): State {
  return syncScheduleWorker.getState();
}

type DueJob = {
  id: string;
  schedule: string | null;
  lastSyncAt: Date | null;
  status: string;
  name: string;
};

/**
 * Dispatch one due job under its own advisory lock. Returns whether it ran, and
 * never throws: one failed sync must not abort the rest of the batch.
 */
async function dispatchOne(job: DueJob, reason: string): Promise<boolean> {
  const release = await tryAcquireAdvisoryLock("sync-schedule", job.id);
  if (!release) return false;
  try {
    // re-check after lock
    const fresh = await prisma.syncJob.findUnique({
      where: { id: job.id },
      select: { schedule: true, lastSyncAt: true, status: true },
    });
    if (!fresh || !isSyncJobDue(fresh)) return false;
    logger.info("dispatching scheduled sync job", {
      workerId: WORKER_ID,
      jobId: job.id,
      name: job.name,
      schedule: job.schedule,
      reason,
    });
    // Release the advisory lock as soon as executeSyncJob's CAS has claimed
    // the row RUNNING — mutual exclusion then rests on the RUNNING state (the
    // findMany above only picks IDLE/ERROR), so the rsync no longer holds one
    // of the 2-4 shared advisory-lock connections for its whole duration.
    // release() is idempotent, so the finally below is a safe no-op.
    await executeSyncJob(job.id, { onClaimed: release });
    return true;
  } catch (error) {
    logger.error("scheduled sync job failed", {
      jobId: job.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    await release();
  }
}

export async function runSyncScheduleWorkerOnce(reason = "manual"): Promise<number> {
  const state = getState();
  if (state.running) {
    logger.warn("sync schedule tick skipped (already running)", { reason });
    return 0;
  }
  state.running = true;
  let started = 0;
  try {
    const reclaimed = await reclaimStaleRunningSyncJobs();
    if (reclaimed.length > 0) {
      logger.warn("reclaimed stale RUNNING sync jobs", { count: reclaimed.length, ids: reclaimed });
    }

    const jobs = await prisma.syncJob.findMany({
      where: {
        status: { in: ["IDLE", "ERROR"] },
        schedule: { not: null },
      },
      select: {
        id: true,
        schedule: true,
        lastSyncAt: true,
        status: true,
        name: true,
      },
      take: 100,
      orderBy: { lastSyncAt: "asc" },
    });

    const dueJobs = jobs.filter((job) => isSyncJobDue(job));
    for (let i = 0; i < dueJobs.length; i += DISPATCH_CONCURRENCY) {
      const batch = dueJobs.slice(i, i + DISPATCH_CONCURRENCY);
      const outcomes = await Promise.all(batch.map((job) => dispatchOne(job, reason)));
      started += outcomes.filter(Boolean).length;
    }
    return started;
  } finally {
    state.running = false;
  }
}

export async function startSyncScheduleWorker() {
  return (await syncScheduleWorker.start()).state;
}

export function stopSyncScheduleWorkerForTests() {
  syncScheduleWorker.stopForTests();
}
