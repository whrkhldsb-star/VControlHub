import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * TR-043: VPS backup schedule service — CRUD + due dispatch.
 */

import { prisma } from "@/lib/db";
import { liveCustomerRowsWhere } from "@/lib/auth/team-scope";
import { enqueueJob } from "@/lib/job/service";
import { createVpsBackupRecord, VPS_BACKUP_CREATE_JOB_TYPE } from "./vps-backup-service";
import { invalidCustomBackupPaths, isVpsBackupPresetType } from "./vps-backup-presets";
import { createLogger } from "@/lib/logging";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { computeNextRun as sharedComputeNextRun } from "@/lib/scheduled-task/service";
import { validateCronExpression as sharedValidateCronExpression } from "./schedule-service";

const vpsSchedLogger = createLogger("vps-backup-schedule");
const VPS_BACKUP_SCHEDULE_STATUSES = ["ACTIVE", "PAUSED"] as const;
type VpsBackupScheduleStatus = (typeof VPS_BACKUP_SCHEDULE_STATUSES)[number];

/**
 * Validate cron at write-time (same parser as host backup schedules).
 * Previously create/update accepted garbage cron and computeNextRun silently
 * fell back to +24h — schedules appeared "saved" but never fired as intended.
 */
export const validateVpsCronExpression = sharedValidateCronExpression;

// Defense-in-depth: the HTTP routes already zod-validate retentionDays to
// 1..365, but the service must not trust callers (future internal callers,
// scripts) to have done so. Mirror the same bound here. null = keep forever.
const VPS_RETENTION_DAYS_MAX = 365;
function validateVpsRetentionDays(value: number | null | undefined): void {
	if (value === null || value === undefined) return;
	if (!Number.isInteger(value) || value < 1 || value > VPS_RETENTION_DAYS_MAX) {
		throw new ValidationError(t("vpsBackupApi.errorRetentionRange"));
	}
}

/* ── CRUD ────────────────────────────────────────────────── */

export async function listVpsBackupSchedules(serverId?: string) {
	return prisma.vpsBackupSchedule.findMany({
		where: serverId ? { serverId } : undefined,
		orderBy: { createdAt: "desc" },
		take: 500,
		include: {
			server: { select: { id: true, name: true, host: true } },
			_count: { select: { records: true } },
		},
	});
}

/** Reject custom paths a backup could not take as given (see invalidCustomBackupPaths). */
function assertCustomBackupPaths(paths: string[]) {
	const invalid = invalidCustomBackupPaths(paths);
	if (invalid.length > 0) {
		throw new ValidationError(t("vpsBackupApi.errorCustomPathsInvalid", { paths: invalid.join(", ") }));
	}
}

export async function createVpsBackupSchedule(input: {
	serverId: string;
	name: string;
	cronExpression: string;
	backupType: string;
	paths?: string[];
	note?: string;
	retentionDays?: number;
	createdById?: string;
}) {
	const name = input.name.trim();
	if (!name) throw new ValidationError(t("backend.backup.scheduleNameRequired"));
	if (name.length > 100) throw new ValidationError(t("backend.backup.scheduleNameTooLong"));
	const paths = (input.paths ?? []).map((path) => path.trim()).filter(Boolean);
	if (!isVpsBackupPresetType(input.backupType)) {
		throw new ValidationError(apiCopy("apiCopy.invalid.backuptype.d98f6f5a", { v0: String(input.backupType) }));
	}
	if (input.backupType === "custom" && paths.length === 0) {
		throw new ValidationError(t("vpsBackupApi.errorCustomPathsRequired"));
	}
	if (input.backupType === "custom") assertCustomBackupPaths(paths);

	const cronExpression = validateVpsCronExpression(input.cronExpression);
	validateVpsRetentionDays(input.retentionDays);
	const nextRunAt = computeNextRun(cronExpression);

	return prisma.vpsBackupSchedule.create({
		data: {
			serverId: input.serverId,
			name,
			cronExpression,
			backupType: input.backupType,
			paths,
			note: input.note?.trim() || null,
			retentionDays: input.retentionDays ?? null,
			createdById: input.createdById ?? null,
			nextRunAt,
		},
	});
}

export async function updateVpsBackupSchedule(
	id: string,
	serverId: string,
	input: Partial<{
		name: string;
		cronExpression: string;
		backupType: string;
		paths: string[];
		note: string;
		retentionDays: number | null;
		status: VpsBackupScheduleStatus;
	}>,
) {
	// Read once before calculating the resulting schedule. Besides giving a
	// friendly not-found error, this avoids the old resume bug where ACTIVE was
	// restored but nextRunAt remained null forever.
	const existing = await prisma.vpsBackupSchedule.findUnique({
		where: { id, serverId },
		select: {
			backupType: true,
			paths: true,
			cronExpression: true,
			status: true,
		},
	});
	if (!existing) {
		throw new NotFoundError(t("vpsBackupApi.errorScheduleNotFound"));
	}

	const data: Record<string, unknown> = {};
	if (input.name !== undefined) {
		const name = input.name.trim();
		if (!name) throw new ValidationError(t("backend.backup.scheduleNameRequired"));
		if (name.length > 100) throw new ValidationError(t("backend.backup.scheduleNameTooLong"));
		data.name = name;
	}
	if (input.cronExpression !== undefined) {
		data.cronExpression = validateVpsCronExpression(input.cronExpression);
	}
	if (input.backupType !== undefined) {
		if (!isVpsBackupPresetType(input.backupType)) {
			throw new ValidationError(apiCopy("apiCopy.invalid.backuptype.d98f6f5a", { v0: String(input.backupType) }));
		}
		data.backupType = input.backupType;
	}
	if (input.paths !== undefined) data.paths = input.paths.map((path) => path.trim()).filter(Boolean);
	if (input.note !== undefined) data.note = input.note.trim() || null;
	if (input.retentionDays !== undefined) {
		validateVpsRetentionDays(input.retentionDays);
		data.retentionDays = input.retentionDays;
	}
	if (input.status !== undefined) {
		if (!VPS_BACKUP_SCHEDULE_STATUSES.includes(input.status)) {
			throw new ValidationError(t("backend.backup.statusInvalid"));
		}
		data.status = input.status;
	}

	const nextType = (data.backupType as string | undefined) ?? existing.backupType;
	const nextPaths = (data.paths as string[] | undefined) ?? existing.paths;
	if (nextType === "custom" && nextPaths.length === 0) {
		throw new ValidationError(t("vpsBackupApi.errorCustomPathsRequired"));
	}
	if (nextType === "custom") assertCustomBackupPaths(nextPaths);

	const nextStatus = (data.status as VpsBackupScheduleStatus | undefined) ?? (existing.status as VpsBackupScheduleStatus);
	if (nextStatus !== "ACTIVE") {
		// A paused schedule must never remain eligible for a delayed worker tick.
		data.nextRunAt = null;
	} else if (input.cronExpression !== undefined || existing.status !== "ACTIVE") {
		data.nextRunAt = computeNextRun(
			(data.cronExpression as string | undefined) ?? existing.cronExpression,
		);
	}

	return prisma.vpsBackupSchedule.update({ where: { id, serverId }, data });
}

export async function deleteVpsBackupSchedule(
	id: string,
	serverId: string,
): Promise<void> {
	await prisma.vpsBackupSchedule.delete({ where: { id, serverId } });
}

/* ── Schedule dispatch ───────────────────────────────────── */

/**
 * Find all due VPS backup schedules and dispatch backup jobs.
 * Called by the schedule tick worker.
 */
export async function dispatchDueVpsBackupSchedules(): Promise<number> {
	const now = new Date();
	const due = await prisma.vpsBackupSchedule.findMany({
		where: {
			status: "ACTIVE",
			nextRunAt: { lte: now },
			// A deleted customer's servers are no longer backed up (a system
			// job, no owner check stopped it): kept for history, not run.
			server: liveCustomerRowsWhere(),
		},
		include: { server: { select: { id: true, teamId: true, name: true } } },
		orderBy: { nextRunAt: "asc" },
		take: 500,
	});

	let dispatched = 0;
	for (const schedule of due) {
		try {
			// Claim the occurrence, create the record and enqueue the job in one
			// transaction. The claim is a compare-and-set that moves nextRunAt to
			// the next cron time; a process dying mid-way commits nothing, so the
			// occurrence stays due. (It used to park nextRunAt on 2099-01-01 first
			// and do the rest in separate writes: a crash in between disabled the
			// schedule for good.)
			const outcome = await prisma.$transaction(async (tx) => {
				const claimed = await tx.vpsBackupSchedule.updateMany({
					where: { id: schedule.id, status: "ACTIVE", nextRunAt: schedule.nextRunAt },
					data: { nextRunAt: computeNextRun(schedule.cronExpression) },
				});
				if (claimed.count === 0) return "claimed-elsewhere" as const;
				// Overlap guard: if the previous cycle for this server is still
				// PENDING/RUNNING (slow backup + short cron), skip this occurrence
				// instead of stacking concurrent SSH backup sessions against the
				// same host. The stale-record reaper (job maintenance) fails any
				// RUNNING row whose worker actually died, so this cannot wedge.
				const inFlight = await tx.vpsBackupRecord.count({
					where: { serverId: schedule.serverId, status: { in: ["PENDING", "RUNNING"] } },
				});
				if (inFlight > 0) {
					await tx.vpsBackupSchedule.update({ where: { id: schedule.id }, data: { lastResult: "SKIPPED_OVERLAP" } });
					return { skipped: inFlight };
				}
				// The record carries what this run backs up: a retry is a new record
				// without the schedule, and with no paths of its own a failed custom
				// backup could only ever fail again ("requires at least one path").
				const { id: recordId } = await createVpsBackupRecord({
					serverId: schedule.serverId,
					backupType: schedule.backupType,
					scheduleId: schedule.id,
					paths: schedule.paths,
					createdBy: schedule.createdById,
				}, tx);
				await enqueueJob({
					type: VPS_BACKUP_CREATE_JOB_TYPE,
					title: `VPS backup: ${schedule.name}`,
					payload: {
						recordId,
						serverId: schedule.serverId,
						teamId: schedule.server?.teamId ?? null,
						scheduleId: schedule.id,
					},
					teamId: schedule.server?.teamId ?? null,
					createdBy: schedule.createdById,
					maxAttempts: 1,
				}, tx);
				await tx.vpsBackupSchedule.update({
					where: { id: schedule.id },
					data: { lastRunAt: now, runCount: { increment: 1 }, lastResult: "DISPATCHED" },
				});
				return "dispatched" as const;
			});
			if (outcome === "claimed-elsewhere") continue;
			if (outcome !== "dispatched") {
				vpsSchedLogger.warn("VPS backup skipped: previous run still in flight", {
					scheduleId: schedule.id,
					serverId: schedule.serverId,
					inFlight: outcome.skipped,
				});
				continue;
			}

			// Retention runs after a backup succeeds (vps-backup-job-worker), not
			// here: pruning at dispatch, before knowing whether the new backup
			// works, removed old backups while every new one was failing.

			dispatched++;
		} catch (error) {
			// The claim transaction rolled back, so this occurrence is still
			// unclaimed. Retry it shortly (never later than the next cron time)
			// instead of skipping it, and only while nobody else has claimed or
			// changed the schedule since we read it: the compare-and-set keeps a
			// failed tick from overwriting another worker's successful claim.
			const errMsg = error instanceof Error ? error.message : String(error);
			vpsSchedLogger.error("VPS backup schedule dispatch failed", {
				scheduleId: schedule.id,
				serverId: schedule.serverId,
				error: errMsg,
			});
			try {
				const retryAt = new Date(Math.min(Date.now() + VPS_DISPATCH_RETRY_MS, computeNextRun(schedule.cronExpression).getTime()));
				await prisma.vpsBackupSchedule.updateMany({
					where: { id: schedule.id, status: "ACTIVE", nextRunAt: schedule.nextRunAt },
					data: {
						nextRunAt: retryAt,
						lastResult: `DISPATCH_FAILED: ${errMsg}`.slice(0, 500),
					},
				});
			} catch (rollbackError) {
				vpsSchedLogger.error("Failed to roll back VPS schedule CAS claim after dispatch error", {
					scheduleId: schedule.id,
					error: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
				});
			}
		}
	}

	return dispatched;
}

/* ── Cron next-run ────────────────────────────────────────── */

/**
 * Shared scheduled-task parser, wrapped so the dispatch loop never throws:
 * legacy rows written before write-time validation may hold invalid cron, and
 * retrying in 24h keeps the schedule observable instead of wedging it at the
 * CAS far-future sentinel.
 */
/** A failed dispatch is retried after this long (or at the next cron time, if sooner). */
export const VPS_DISPATCH_RETRY_MS = 5 * 60_000;

export function computeNextRun(cronExpression: string, from: Date = new Date()): Date {
	try {
		return sharedComputeNextRun(cronExpression, from);
	} catch {
		return new Date(from.getTime() + 24 * 60 * 60 * 1000);
	}
}
