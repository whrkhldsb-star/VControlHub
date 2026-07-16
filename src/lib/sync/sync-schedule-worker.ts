/**
 * Dispatches due SyncJob rows (schedule + lastSyncAt) every minute.
 * Execution reuses executeSyncJob (CAS RUNNING + rsync/tar).
 */
import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

import { isSyncJobDue } from "./schedule";
import { executeSyncJob } from "./service-runtime";

const logger = createLogger("sync-schedule-worker");
const INTERVAL_MS = 60_000;
const WORKER_ID = `${config.app.hostname || "vcontrolhub"}:sync-schedule:${process.pid}`;

type State = { started: boolean; running: boolean; timer: NodeJS.Timeout | null };
type G = typeof globalThis & { __vcontrolhubSyncScheduleWorker?: State };

function getState(): State {
  const g = globalThis as G;
  g.__vcontrolhubSyncScheduleWorker ??= { started: false, running: false, timer: null };
  return g.__vcontrolhubSyncScheduleWorker;
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

    for (const job of jobs) {
      if (!isSyncJobDue(job)) continue;
      const release = await tryAcquireAdvisoryLock("sync-schedule", job.id);
      if (!release) continue;
      try {
        // re-check after lock
        const fresh = await prisma.syncJob.findUnique({
          where: { id: job.id },
          select: { schedule: true, lastSyncAt: true, status: true },
        });
        if (!fresh || !isSyncJobDue(fresh)) continue;
        logger.info("dispatching scheduled sync job", {
          workerId: WORKER_ID,
          jobId: job.id,
          name: job.name,
          schedule: job.schedule,
          reason,
        });
        await executeSyncJob(job.id);
        started += 1;
      } catch (error) {
        logger.error("scheduled sync job failed", {
          jobId: job.id,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        await release();
      }
    }
    return started;
  } finally {
    state.running = false;
  }
}

export async function startSyncScheduleWorker() {
  const state = getState();
  if (state.started) return state;
  state.started = true;
  void runSyncScheduleWorkerOnce("startup").catch((e) =>
    logger.error("sync schedule startup failed", e),
  );
  state.timer = setInterval(() => {
    void runSyncScheduleWorkerOnce("interval").catch((e) =>
      logger.error("sync schedule tick failed", e),
    );
  }, INTERVAL_MS);
  state.timer.unref?.();
  logger.info("sync schedule worker started", { workerId: WORKER_ID, intervalMs: INTERVAL_MS });
  return state;
}

export function stopSyncScheduleWorkerForTests() {
  const state = getState();
  if (state.timer) clearInterval(state.timer);
  state.started = false;
  state.running = false;
  state.timer = null;
}
