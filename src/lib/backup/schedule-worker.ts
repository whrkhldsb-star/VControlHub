/**
 * Backup schedule tick worker — TR-038.
 *
 * Mirrors the scheduled-task tick worker pattern: every 60s, enqueue a
 * `backup-schedule.tick` durable job. The worker claims the job, finds all
 * BackupSchedule rows with status=ACTIVE and nextRunAt <= now, CAS-claims
 * each (set nextRunAt to a far-future sentinel to prevent duplicate
 * dispatch across workers), calls `dispatchDueSchedule` (which creates a
 * PENDING BackupRecord + enqueues a `backup.create` durable job), then
 * records the run result.
 *
 * The actual backup execution (bash deploy/backup.sh) is done by the
 * existing backup-job-worker when it picks up the `backup.create` job —
 * this tick only does lightweight DB writes. This separation keeps the
 * tick fast and survives process restarts.
 */
import { JobStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { computeLeaseMs } from "@/lib/job/lease";
import {
  claimNextJob,
  completeJob,
  enqueueJob,
  failJob,
  heartbeatJob,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import { dispatchDueSchedule, recordScheduleRun } from "./schedule-service";

const logger = createLogger("backup-schedule-worker");

export const BACKUP_SCHEDULE_TICK_JOB_TYPE = "backup-schedule.tick";

const BACKUP_SCHEDULE_TICK_INTERVAL_MS = 60_000;
const BACKUP_SCHEDULE_TICK_LEASE_MS = computeLeaseMs("backup-schedule");
const BACKUP_SCHEDULE_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:backup-schedule:${process.pid}`;

type BackupScheduleWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type BackupScheduleWorkerGlobal = typeof globalThis & {
  __vcontrolhubBackupScheduleWorker?: BackupScheduleWorkerState;
};

function getWorkerState() {
  const globalState = globalThis as BackupScheduleWorkerGlobal;
  globalState.__vcontrolhubBackupScheduleWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubBackupScheduleWorker;
}

async function hasActiveTickJob(tx?: Prisma.TransactionClient) {
  const client = tx ?? prisma;
  const existing = await client.job.findFirst({
    where: {
      type: BACKUP_SCHEDULE_TICK_JOB_TYPE,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
    },
    select: { id: true },
  });
  return Boolean(existing);
}

async function enqueueTickJob(reason: string) {
  // Same race-guard pattern as scheduled-task/worker.ts: the
  // existence-check + enqueue runs inside a single transaction so
  // PostgreSQL MVCC + implicit row locks serialise concurrent enqueues
  // from multiple workers (cluster deploy / overlapping restarts).
  try {
    return await prisma.$transaction(async (tx) => {
      if (await hasActiveTickJob(tx)) return null;
      return enqueueJob({
        type: BACKUP_SCHEDULE_TICK_JOB_TYPE,
        title: "Backup schedule dispatch tick",
        payload: { reason, requestedAt: new Date().toISOString() },
        priority: -5,
        maxAttempts: 3,
      });
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("could not serialize") ||
      message.includes("deadlock detected") ||
      message.includes("conflict")
    ) {
      logger.warn("Skipping backup-schedule tick enqueue because of a serialisation conflict", {
        reason,
        error: message,
      });
      return null;
    }
    throw error;
  }
}

async function dispatchDueScheduleRow(schedule: {
  id: string;
  name: string;
  backupType: string;
  note: string | null;
  retentionDays: number | null;
  createdById: string | null;
  nextRunAt: Date | null;
}): Promise<boolean> {
  if (!schedule.createdById) {
    await recordScheduleRun(schedule.id, "Skipped: backup schedule has no creator");
    return false;
  }

  // CAS claim: pin nextRunAt to the original value and advance it to a
  // far-future sentinel. The loser (count === 0) bails; the winner
  // proceeds. recordScheduleRun (called by dispatchDueSchedule) will
  // recompute the real next cron firing time.
  const claimSentinel = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const claim = await prisma.backupSchedule.updateMany({
    where: {
      id: schedule.id,
      status: "ACTIVE",
      nextRunAt: schedule.nextRunAt,
    },
    data: { nextRunAt: claimSentinel },
  });
  if (claim.count === 0) {
    logger.info("Backup schedule already claimed by another worker, skipping duplicate dispatch", {
      scheduleId: schedule.id,
      name: schedule.name,
    });
    return false;
  }

  try {
    await dispatchDueSchedule(schedule);
    return true;
  } catch (error) {
    // We claimed the row but dispatch failed. Roll the claim back so a
    // future tick or operator can retry.
    logger.error("Backup schedule CAS claimed but dispatch failed; rolling claim back", {
      scheduleId: schedule.id,
      error: error instanceof Error ? error.message : String(error),
    });
    try {
      await prisma.backupSchedule.update({
        where: { id: schedule.id },
        data: { nextRunAt: schedule.nextRunAt },
      });
    } catch (rollbackError) {
      logger.error("Failed to roll back the backup-schedule CAS claim after dispatch error", {
        scheduleId: schedule.id,
        error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
      });
    }
    throw error;
  }
}

async function dispatchDueBackupSchedules(reason: string) {
  const dueSchedules = await prisma.backupSchedule.findMany({
    where: {
      status: "ACTIVE",
      nextRunAt: { not: null, lte: new Date() },
    },
    take: 500, // >500 due schedules in one tick is anomalous
  });

  let dispatchedCount = 0;
  for (const schedule of dueSchedules) {
    try {
      const dispatched = await dispatchDueScheduleRow(schedule);
      if (dispatched) dispatchedCount += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error("Backup schedule dispatch failed", {
        reason,
        scheduleId: schedule.id,
        error: message,
      });
      try {
        await recordScheduleRun(schedule.id, `Execution failed: ${message.slice(0, 400)}`);
      } catch (recordError) {
        logger.error("Failed to record backup schedule run after failure", {
          reason,
          scheduleId: schedule.id,
          error: recordError instanceof Error ? recordError.message : String(recordError),
        });
      }
    }
  }

  return { dispatched: dispatchedCount, observed: dueSchedules.length };
}

export async function runBackupScheduleTickJobWorkerOnce(reason = "manual") {
  const state = getWorkerState();
  if (state.running) {
    logger.warn("Skipping backup schedule tick because a previous tick is still running", { reason });
    return false;
  }

  state.running = true;
  try {
    await enqueueTickJob(reason);
    const job = await claimNextJob({
      workerId: BACKUP_SCHEDULE_WORKER_ID,
      types: [BACKUP_SCHEDULE_TICK_JOB_TYPE],
      leaseMs: BACKUP_SCHEDULE_TICK_LEASE_MS,
    });
    if (!job) return false;

    try {
      await heartbeatJob(job.id, BACKUP_SCHEDULE_WORKER_ID, {
        leaseMs: BACKUP_SCHEDULE_TICK_LEASE_MS,
        progress: "Dispatching due backup schedules",
      });
      const result = await dispatchDueBackupSchedules(reason);
      await completeJob(job.id, BACKUP_SCHEDULE_WORKER_ID, result);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await failJob(job.id, BACKUP_SCHEDULE_WORKER_ID, message.slice(0, 2000), { retryAfterMs: 60_000 });
      logger.error("Backup schedule tick job failed", { reason, jobId: job.id, error: message });
      return true;
    }
  } catch (error) {
    logger.error("Backup schedule tick failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  } finally {
    state.running = false;
  }
}

export async function startBackupScheduleWorker() {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = BACKUP_SCHEDULE_TICK_INTERVAL_MS;

  void runBackupScheduleTickJobWorkerOnce("startup").catch((error) => {
    logger.error("Backup schedule worker tick failed", {
      reason: "startup",
      error: error instanceof Error ? error.message : String(error),
    });
  });
  state.timer = setInterval(() => {
    void runBackupScheduleTickJobWorkerOnce("interval").catch((error) => {
      logger.error("Backup schedule worker tick failed", {
        reason: "interval",
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);
  state.timer.unref?.();

  logger.info("backup-schedule durable job worker started", {
    intervalMs,
    workerId: BACKUP_SCHEDULE_WORKER_ID,
  });
  return state;
}

export function stopBackupScheduleWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.started = false;
  state.running = false;
  state.timer = null;
}
