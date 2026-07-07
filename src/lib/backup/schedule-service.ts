/**
 * Backup schedule service — CRUD + run-record helpers for TR-038.
 *
 * The schedule tick worker (`./schedule-worker`) calls `dispatchDueSchedules`
 * every 60s; for each due row it CAS-claims the row, creates a PENDING
 * BackupRecord via `createBackupRecord`, enqueues a `backup.create` durable
 * job (which the existing backup-job-worker picks up and runs locally via
 * `runExistingBackupRecord`), then records the run result.
 *
 * Reuses `computeNextRun` + `describeCron` from the scheduled-task service
 * so cron semantics stay identical across both schedule kinds.
 */
import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { computeNextRun, describeCron } from "@/lib/scheduled-task/service";
import { CronExpressionParser } from "cron-parser";
import { isBackupType, type BackupType } from "./service-types";
import { createBackupRecord } from "./service-crud";
import { BACKUP_CREATE_JOB_TYPE } from "./job-worker";
import { enqueueJob } from "@/lib/job/service";

/* ── Types ────────────────────────────────────────────────── */

export type BackupScheduleStatus = "ACTIVE" | "PAUSED" | "DISABLED";

export type CreateBackupScheduleInput = {
  name: string;
  cronExpression: string;
  backupType: BackupType;
  note?: string;
  retentionDays?: number | null;
  createdById?: string;
};

export type UpdateBackupScheduleInput = Partial<Omit<CreateBackupScheduleInput, "createdById">> & {
  status?: BackupScheduleStatus;
};

/* ── Validation ───────────────────────────────────────────── */

/**
 * Validate cron expression using the same cron-parser the ScheduledTask
 * worker uses. Throws ValidationError on invalid expressions so the API
 * layer surfaces a 400 instead of silently storing a broken schedule.
 */
export function validateCronExpression(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) throw new ValidationError("Cron expression is required");
  try {
    CronExpressionParser.parse(trimmed, { currentDate: new Date() });
  } catch {
    throw new ValidationError("Cron expression format is invalid");
  }
  return trimmed;
}

export function validateBackupType(value: string): BackupType {
  if (!isBackupType(value)) throw new ValidationError("Backup type is invalid");
  return value;
}

export function validateRetentionDays(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 1 || value > 3650) {
    throw new ValidationError("Retention days must be between 1 and 3650");
  }
  return Math.floor(value);
}

/* ── CRUD ─────────────────────────────────────────────────── */

export async function createBackupSchedule(input: CreateBackupScheduleInput) {
  const cronExpression = validateCronExpression(input.cronExpression);
  const backupType = validateBackupType(input.backupType);
  const retentionDays = validateRetentionDays(input.retentionDays ?? null);
  const name = input.name.trim();
  if (!name) throw new ValidationError("Schedule name is required");
  if (name.length > 100) throw new ValidationError("Schedule name is too long");
  const note = input.note?.trim() || null;
  if (note && note.length > 500) throw new ValidationError("Note is too long");

  return prisma.backupSchedule.create({
    data: {
      name,
      cronExpression,
      backupType,
      note,
      retentionDays,
      createdById: input.createdById ?? null,
      nextRunAt: computeNextRun(cronExpression),
    },
    include: { creator: { select: { username: true, displayName: true } } },
  });
}

export async function listBackupSchedules(limit = 200) {
  return prisma.backupSchedule.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { creator: { select: { username: true, displayName: true } } },
  });
}

export async function getBackupSchedule(id: string) {
  return prisma.backupSchedule.findUnique({ where: { id } });
}

export async function updateBackupSchedule(id: string, input: UpdateBackupScheduleInput) {
  const existing = await prisma.backupSchedule.findUnique({ where: { id } });
  if (!existing) throw new NotFoundError("Backup schedule not found");

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw new ValidationError("Schedule name is required");
    if (name.length > 100) throw new ValidationError("Schedule name is too long");
    data.name = name;
  }
  if (input.cronExpression !== undefined) {
    data.cronExpression = validateCronExpression(input.cronExpression);
    data.nextRunAt = computeNextRun(data.cronExpression as string);
  }
  if (input.backupType !== undefined) {
    data.backupType = validateBackupType(input.backupType);
  }
  if (input.note !== undefined) {
    const note = input.note.trim();
    if (note.length > 500) throw new ValidationError("Note is too long");
    data.note = note || null;
  }
  if (input.retentionDays !== undefined) {
    data.retentionDays = validateRetentionDays(input.retentionDays);
  }
  if (input.status !== undefined) {
    if (!["ACTIVE", "PAUSED", "DISABLED"].includes(input.status)) {
      throw new ValidationError("Status value is invalid");
    }
    data.status = input.status;
    // Pausing/disabling clears nextRunAt; (re)activating recomputes it.
    if (input.status !== "ACTIVE") {
      data.nextRunAt = null;
    } else if (existing.status !== "ACTIVE" && !data.nextRunAt) {
      data.nextRunAt = computeNextRun(existing.cronExpression);
    }
  }
  return prisma.backupSchedule.update({
    where: { id },
    data,
    include: { creator: { select: { username: true, displayName: true } } },
  });
}

export async function deleteBackupSchedule(id: string) {
  const existing = await prisma.backupSchedule.findUnique({ where: { id }, select: { id: true } });
  if (!existing) throw new NotFoundError("Backup schedule not found");
  await prisma.backupSchedule.delete({ where: { id } });
  return { id };
}

export async function toggleBackupSchedule(id: string) {
  const existing = await prisma.backupSchedule.findUnique({
    where: { id },
    select: { status: true, cronExpression: true },
  });
  if (!existing) throw new NotFoundError("Backup schedule not found");
  const newStatus: BackupScheduleStatus = existing.status === "ACTIVE" ? "PAUSED" : "ACTIVE";
  return updateBackupSchedule(id, { status: newStatus });
}

/* ── Run recording ────────────────────────────────────────── */

export async function recordScheduleRun(id: string, result: string) {
  const schedule = await prisma.backupSchedule.findUnique({
    where: { id },
    select: { cronExpression: true, runCount: true },
  });
  if (!schedule) return;
  return prisma.backupSchedule.update({
    where: { id },
    data: {
      lastRunAt: new Date(),
      lastResult: result.slice(0, 500),
      runCount: schedule.runCount + 1,
      nextRunAt: computeNextRun(schedule.cronExpression),
    },
  });
}

/* ── Dispatch (called by schedule-worker tick) ───────────── */

export type DispatchedBackupSchedule = {
  scheduleId: string;
  backupRecordId: string;
  jobId: string;
};

/**
 * Create a PENDING BackupRecord for the schedule and enqueue a
 * `backup.create` durable job. The backup-job-worker picks up the job
 * and runs `runExistingBackupRecord` locally. Separating "schedule tick"
 * (lightweight DB writes) from "backup execution" (heavy bash) keeps the
 * tick fast and survives process restarts.
 */
export async function dispatchDueSchedule(schedule: {
  id: string;
  name: string;
  backupType: string;
  note: string | null;
  createdById: string | null;
  retentionDays: number | null;
  nextRunAt: Date | null;
}): Promise<DispatchedBackupSchedule | null> {
  if (!schedule.createdById) {
    await recordScheduleRun(schedule.id, "Skipped: backup schedule has no creator");
    return null;
  }
  if (!isBackupType(schedule.backupType)) {
    await recordScheduleRun(schedule.id, `Skipped: invalid backup type ${schedule.backupType}`);
    return null;
  }

  const note = schedule.note
    ? `${schedule.note} (scheduled: ${schedule.name})`
    : `Scheduled backup: ${schedule.name}`;

  const backup = await createBackupRecord({
    type: schedule.backupType,
    createdBy: schedule.createdById,
    note,
  });

  const job = await enqueueJob({
    type: BACKUP_CREATE_JOB_TYPE,
    title: `Scheduled backup: ${schedule.name}`,
    payload: {
      backupId: backup.id,
      scheduleId: schedule.id,
      retentionDays: schedule.retentionDays,
    },
    createdBy: schedule.createdById,
    maxAttempts: 1,
  });

  await recordScheduleRun(schedule.id, `Backup task ${backup.id} triggered (job ${job.id})`);
  return { scheduleId: schedule.id, backupRecordId: backup.id, jobId: job.id };
}

/* ── Description helper (re-export for UI) ───────────────── */

export { describeCron, computeNextRun };
