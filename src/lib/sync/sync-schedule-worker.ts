/**
 * Dispatches due SyncJob rows (schedule + lastSyncAt) every minute.
 * Execution reuses executeSyncJob (CAS RUNNING + rsync/tar).
 */
import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { liveCustomerRowsWhere } from "@/lib/auth/team-scope";
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
 * When each failed job last tried to run. A failure leaves lastSyncAt alone,
 * so a failed job stayed due and was retried on every tick — a FAILED log and
 * another connection to its servers a minute — until it succeeded. Its failed
 * attempt now counts as the occurrence: it waits for the next one (a manual run
 * is always available). Only ERROR jobs need the lookup: a job whose last run
 * succeeded has a lastSyncAt after that run's log started.
 */
async function lastFailedAttempts(jobs: Array<{ id: string; status: string }>): Promise<Map<string, Date>> {
  const ids = jobs.filter((job) => job.status === "ERROR").map((job) => job.id);
  if (ids.length === 0) return new Map();
  const rows = await prisma.syncLog.groupBy({
    by: ["syncJobId"],
    where: { syncJobId: { in: ids } },
    _max: { startedAt: true },
  });
  return new Map(rows.flatMap((row) => (row._max.startedAt ? [[row.syncJobId, row._max.startedAt] as const] : [])));
}

function dueAfterAttempt(job: Parameters<typeof isSyncJobDue>[0], attemptedAt: Date | undefined): boolean {
  const last = attemptedAt && (!job.lastSyncAt || job.lastSyncAt < attemptedAt) ? attemptedAt : job.lastSyncAt;
  return isSyncJobDue({ ...job, lastSyncAt: last });
}

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
      select: { schedule: true, lastSyncAt: true, createdAt: true, status: true, updatedAt: true },
    });
    if (!fresh) return false;
    const attempts = await lastFailedAttempts([{ id: job.id, status: fresh.status }]);
    if (!dueAfterAttempt(fresh, attempts.get(job.id))) return false;
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
    await executeSyncJob(job.id, { onClaimed: release, expectedOccurrence: { schedule: fresh.schedule, lastSyncAt: fresh.lastSyncAt, updatedAt: fresh.updatedAt } });
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

const SCHEDULE_SCAN_PAGE = 500;

const active = new Map<string, Promise<boolean>>();
const queued = new Set<string>();
let cleanup: Promise<void> | undefined;

export async function runSyncScheduleWorkerOnce(reason = "manual"): Promise<number> {
  const state = getState();
  if (state.running) {
    logger.warn("sync schedule tick skipped (already running)", { reason });
    return 0;
  }
  state.running = true;
  const dueJobs: DueJob[] = [];
  try {
    cleanup ??= reclaimStaleRunningSyncJobs().then(ids => {
      if (ids.length) logger.warn("reclaimed stale RUNNING sync jobs", { count: ids.length, ids });
    }).catch(error => logger.error("stale sync cleanup failed", { error: String(error) })).finally(() => { cleanup = undefined; });

    // Whether a job is due is decided here, not in SQL, so every scheduled
    // job is read: a fixed first page (oldest lastSyncAt, where PostgreSQL
    // sorts never-run jobs last) could hold back due jobs indefinitely.

    let cursor: string | undefined;
    do {
      const page = await prisma.syncJob.findMany({
        where: {
          status: { in: ["IDLE", "ERROR"] },
          schedule: { not: null },
          // A deleted customer's jobs wait for its restoration: they could
          // only fail (their owner can no longer act for it).
          ...liveCustomerRowsWhere(),
        },
        select: {
          id: true,
          schedule: true,
          lastSyncAt: true,
          createdAt: true,
          status: true,
          name: true,
        },
        orderBy: { id: "asc" },
        take: SCHEDULE_SCAN_PAGE,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      const attempts = await lastFailedAttempts(page);
      dueJobs.push(...page.filter(job => !queued.has(job.id) && dueAfterAttempt(job, attempts.get(job.id))));
      cursor = page.length === SCHEDULE_SCAN_PAGE ? page[page.length - 1]!.id : undefined;
    } while (cursor);
    // Never-run jobs first, then the longest waiting.
    dueJobs.sort((a, b) => (a.lastSyncAt?.getTime() ?? -Infinity) - (b.lastSyncAt?.getTime() ?? -Infinity));
    for (const job of dueJobs) queued.add(job.id);
  } finally {
    state.running = false;
  }
  const work: Promise<boolean>[] = [];
  for (const job of dueJobs) {
    while (active.size >= DISPATCH_CONCURRENCY) await Promise.race(active.values());
    const transfer = dispatchOne(job, reason).catch(error => {
      logger.error("sync dispatch failed", { jobId: job.id, error: String(error) });
      return false;
    }).finally(() => { active.delete(job.id); queued.delete(job.id); });
    active.set(job.id, transfer);
    work.push(transfer);
  }
  return (await Promise.all(work)).filter(Boolean).length;
}

export async function startSyncScheduleWorker() {
  return (await syncScheduleWorker.start()).state;
}

export function stopSyncScheduleWorkerForTests() {
  syncScheduleWorker.stopForTests();
}
