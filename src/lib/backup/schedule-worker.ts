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
  pruneCompletedJobsByType,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import { dispatchDueSchedule, recordScheduleRun } from "./schedule-service";

const logger = createLogger("backup-schedule-worker");

export const BACKUP_SCHEDULE_TICK_JOB_TYPE = "backup-schedule.tick";

const BACKUP_SCHEDULE_TICK_INTERVAL_MS = 60_000;
const BACKUP_SCHEDULE_TICK_LEASE_MS = computeLeaseMs("backup-schedule");
const BACKUP_SCHEDULE_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:backup-schedule:${process.pid}`;
const BACKUP_SCHEDULE_TICK_KEEP_LATEST = 50;
const BACKUP_SCHEDULE_TICK_RETENTION_DAYS = 3;

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
  teamId: string | null;
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


/** Once per UTC day, enqueue a platform backup.retention job so offsite retentionDays is applied. */
async function maybeEnqueueOffsiteRetentionTick(): Promise<{
  enqueued: boolean;
  skipped?: string;
  jobId?: string;
}> {
  try {
    const dayKey = new Date().toISOString().slice(0, 10);
    const title = `Offsite retention ${dayKey}`;
    const existing = await prisma.job.findFirst({
      where: {
        type: "backup.retention",
        title,
        createdAt: { gte: new Date(`${dayKey}T00:00:00.000Z`) },
      },
      select: { id: true },
    });
    if (existing) return { enqueued: false, skipped: "already-today", jobId: existing.id };
    const { enqueueJob } = await import("@/lib/job/service");
    // teamId null + olderThanDays large: local prune is fail-closed without teamId;
    // the worker still runs offsite prune as a side effect.
    const job = await enqueueJob({
      type: "backup.retention",
      title,
      payload: { olderThanDays: 3650, keepLatestPerType: 1, teamId: null },
      createdBy: null,
      teamId: null,
      maxAttempts: 1,
    });
    return { enqueued: true, jobId: job.id };
  } catch (error) {
    logger.warn("failed to enqueue daily offsite retention tick", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      enqueued: false,
      skipped: error instanceof Error ? error.message : String(error),
    };
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
      const offsiteTick = await maybeEnqueueOffsiteRetentionTick();
      const scheduleResult = await dispatchDueBackupSchedules(reason);
      await completeJob(job.id, BACKUP_SCHEDULE_WORKER_ID, {
        offsiteRetentionTick: offsiteTick,
        dispatched: scheduleResult.dispatched,
        observed: scheduleResult.observed,
      });
      try {
        await pruneCompletedJobsByType({
          type: BACKUP_SCHEDULE_TICK_JOB_TYPE,
          keepLatest: BACKUP_SCHEDULE_TICK_KEEP_LATEST,
          olderThan: new Date(Date.now() - BACKUP_SCHEDULE_TICK_RETENTION_DAYS * 24 * 60 * 60 * 1000),
        });
      } catch (pruneError) {
        logger.warn("Failed to prune backup-schedule.tick jobs", {
          error: pruneError instanceof Error ? pruneError.message : String(pruneError),
        });
      }
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
