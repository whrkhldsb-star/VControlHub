/**
 * TR-043: VPS backup schedule service — CRUD + due dispatch.
 */

import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/job/service";
import { createVpsBackupRecord, VPS_BACKUP_CREATE_JOB_TYPE, pruneOldVpsBackupRecords } from "./vps-backup-service";
import { isVpsBackupPresetType } from "./vps-backup-presets";
import { createLogger } from "@/lib/logging";
import { CronExpressionParser } from "cron-parser";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { APP_TIME_ZONE } from "@/lib/datetime/time-zone";

const vpsSchedLogger = createLogger("vps-backup-schedule");
const VPS_BACKUP_SCHEDULE_STATUSES = ["ACTIVE", "PAUSED"] as const;
type VpsBackupScheduleStatus = (typeof VPS_BACKUP_SCHEDULE_STATUSES)[number];

/**
 * Validate cron at write-time (same parser as host backup schedules).
 * Previously create/update accepted garbage cron and computeNextRun silently
 * fell back to +24h — schedules appeared "saved" but never fired as intended.
 */
export function validateVpsCronExpression(expr: string): string {
	const trimmed = expr.trim();
	if (!trimmed) throw new ValidationError(t("backend.backup.cronRequired"));
	try {
		CronExpressionParser.parse(trimmed, { currentDate: new Date(), tz: APP_TIME_ZONE });
	} catch {
		throw new ValidationError(t("backend.backup.cronInvalid"));
	}
	return trimmed;
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
		throw new ValidationError(`Invalid backupType: ${input.backupType}`);
	}
	if (input.backupType === "custom" && paths.length === 0) {
		throw new ValidationError(t("vpsBackupApi.errorCustomPathsRequired"));
	}

	const cronExpression = validateVpsCronExpression(input.cronExpression);
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
			throw new ValidationError(`Invalid backupType: ${input.backupType}`);
		}
		data.backupType = input.backupType;
	}
	if (input.paths !== undefined) data.paths = input.paths.map((path) => path.trim()).filter(Boolean);
	if (input.note !== undefined) data.note = input.note.trim() || null;
	if (input.retentionDays !== undefined) data.retentionDays = input.retentionDays;
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
		},
		include: { server: { select: { id: true, teamId: true, name: true } } },
		take: 10,
	});

	let dispatched = 0;
	for (const schedule of due) {
		try {
			// CAS claim: pin nextRunAt to far-future sentinel to prevent
			// concurrent dispatch by another tick
			const claimed = await prisma.vpsBackupSchedule.updateMany({
				where: { id: schedule.id, nextRunAt: schedule.nextRunAt },
				data: { nextRunAt: new Date("2099-01-01T00:00:00Z") },
			});

			if (claimed.count === 0) continue; // Already claimed by another worker

			// Create PENDING record
			const { id: recordId } = await createVpsBackupRecord({
				serverId: schedule.serverId,
				backupType: schedule.backupType,
				scheduleId: schedule.id,
			});

			// Enqueue backup job; compensate orphan PENDING if enqueue fails.
			try {
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
					maxAttempts: 1,
				});
			} catch (enqueueError) {
				const errMsg = enqueueError instanceof Error ? enqueueError.message : String(enqueueError);
				await prisma.vpsBackupRecord
					.updateMany({
						where: { id: recordId, status: "PENDING" },
						data: {
							status: "FAILED",
							errorMessage: `Dispatch enqueue failed: ${errMsg}`.slice(0, 500),
							completedAt: new Date(),
						},
					})
					.catch((compErr) => {
						vpsSchedLogger.error("Failed to compensate orphan VPS backup record after enqueue error", {
							recordId,
							error: compErr instanceof Error ? compErr.message : String(compErr),
						});
					});
				throw enqueueError;
			}

			// Record schedule run
			const nextRunAt = computeNextRun(schedule.cronExpression);
			await prisma.vpsBackupSchedule.update({
				where: { id: schedule.id },
				data: {
					lastRunAt: now,
					nextRunAt,
					runCount: { increment: 1 },
					lastResult: "DISPATCHED",
				},
			});

			// Auto-prune old records if retentionDays is set
			if (schedule.retentionDays && schedule.retentionDays > 0) {
				await pruneOldVpsBackupRecords(schedule.serverId, schedule.retentionDays).catch((err) => { vpsSchedLogger.warn("pruneOldVpsBackupRecords failed", { error: err instanceof Error ? err.message : String(err) }); });
			}

			dispatched++;
		} catch (error) {
			// Rollback CAS claim on failure — never silent (ops need lastResult + logs).
			const errMsg = error instanceof Error ? error.message : String(error);
			vpsSchedLogger.error("VPS backup schedule dispatch failed", {
				scheduleId: schedule.id,
				serverId: schedule.serverId,
				error: errMsg,
			});
			try {
				const nextRunAt = computeNextRun(schedule.cronExpression);
				await prisma.vpsBackupSchedule.update({
					where: { id: schedule.id },
					data: {
						nextRunAt,
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

/* ── Cron expression parser ──────────────────────────────── */

/**
 * Simple cron next-run calculator.
 * Supports standard 5-field cron: minute hour day month weekday
 * Does NOT support special strings (@daily, star-slash-N, ranges with steps).
 * For simplicity, uses a brute-force minute-by-minute scan.
 */
export function computeNextRun(cronExpression: string, from: Date = new Date()): Date {
	const trimmed = cronExpression.trim();
	// Support @daily / @hourly / @weekly / @monthly aliases (cron-parser).
	try {
		const expr = CronExpressionParser.parse(trimmed, { currentDate: from, tz: APP_TIME_ZONE });
		const next = expr.next().toDate();
		return next;
	} catch {
		// Invalid expression: fail closed to 24h (same as previous custom parser fallback).
		return new Date(from.getTime() + 24 * 60 * 60 * 1000);
	}
}
