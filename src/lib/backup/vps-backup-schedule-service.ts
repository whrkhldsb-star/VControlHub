/**
 * TR-043: VPS backup schedule service — CRUD + due dispatch.
 */

import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/job/service";
import { createVpsBackupRecord, VPS_BACKUP_CREATE_JOB_TYPE, pruneOldVpsBackupRecords } from "./vps-backup-service";
import { isVpsBackupPresetType } from "./vps-backup-presets";

/* ── CRUD ────────────────────────────────────────────────── */

export async function listVpsBackupSchedules(serverId?: string) {
	return prisma.vpsBackupSchedule.findMany({
		where: serverId ? { serverId } : undefined,
		orderBy: { createdAt: "desc" },
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
	if (!isVpsBackupPresetType(input.backupType)) {
		throw new Error(`Invalid backupType: ${input.backupType}`);
	}

	// Compute next run from cron expression
	const nextRunAt = computeNextRun(input.cronExpression);

	return prisma.vpsBackupSchedule.create({
		data: {
			serverId: input.serverId,
			name: input.name,
			cronExpression: input.cronExpression,
			backupType: input.backupType,
			paths: input.paths ?? [],
			note: input.note ?? null,
			retentionDays: input.retentionDays ?? null,
			createdById: input.createdById ?? null,
			nextRunAt,
		},
	});
}

export async function updateVpsBackupSchedule(
	id: string,
	input: Partial<{
		name: string;
		cronExpression: string;
		backupType: string;
		paths: string[];
		note: string;
		retentionDays: number;
		status: string;
	}>,
) {
	const data: Record<string, unknown> = {};
	if (input.name !== undefined) data.name = input.name;
	if (input.cronExpression !== undefined) {
		data.cronExpression = input.cronExpression;
		data.nextRunAt = computeNextRun(input.cronExpression);
	}
	if (input.backupType !== undefined) {
		if (!isVpsBackupPresetType(input.backupType)) {
			throw new Error(`Invalid backupType: ${input.backupType}`);
		}
		data.backupType = input.backupType;
	}
	if (input.paths !== undefined) data.paths = input.paths;
	if (input.note !== undefined) data.note = input.note;
	if (input.retentionDays !== undefined) data.retentionDays = input.retentionDays;
	if (input.status !== undefined) data.status = input.status;

	return prisma.vpsBackupSchedule.update({ where: { id }, data });
}

export async function deleteVpsBackupSchedule(id: string): Promise<void> {
	await prisma.vpsBackupSchedule.delete({ where: { id } });
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

			// Enqueue backup job
			await enqueueJob({
				type: VPS_BACKUP_CREATE_JOB_TYPE,
				title: `VPS backup: ${schedule.name}`,
				payload: { recordId },
			});

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
				await pruneOldVpsBackupRecords(schedule.serverId, schedule.retentionDays).catch(() => {});
			}

			dispatched++;
		} catch {
			// Rollback CAS claim on failure
			try {
				const nextRunAt = computeNextRun(schedule.cronExpression);
				await prisma.vpsBackupSchedule.update({
					where: { id: schedule.id },
					data: { nextRunAt, lastResult: "DISPATCH_FAILED" },
				});
			} catch {
				// Ignore rollback failure
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
	const parts = cronExpression.trim().split(/\s+/);
	if (parts.length !== 5) {
		// Fallback: 24h from now
		return new Date(from.getTime() + 24 * 60 * 60 * 1000);
	}

	const [minute, hour, dayOfMonth, month, dayOfWeek] = parts.map((p) => {
		if (p === "*") return null;
		return p.split(",").map((v) => {
			if (v.includes("/")) {
				const [base, step] = v.split("/");
				return { base: base === "*" ? 0 : parseInt(base ?? "0"), step: parseInt(step ?? "1") };
			}
			return parseInt(v);
		});
	});

	// Brute-force: scan next 7 days minute by minute
	const result = new Date(from);
	result.setSeconds(0, 0);
	result.setMinutes(result.getMinutes() + 1); // Start from next minute

	for (let i = 0; i < 7 * 24 * 60; i++) {
		const m = result.getMinutes();
		const h = result.getHours();
		const dom = result.getDate();
		const mon = result.getMonth() + 1; // 1-12
		const dow = result.getDay(); // 0-6 (0=Sunday)

		if (matchField(minute, m) && matchField(hour, h) && matchField(dayOfMonth, dom) && matchField(month, mon) && matchField(dayOfWeek, dow)) {
			return new Date(result);
		}

		result.setMinutes(result.getMinutes() + 1);
	}

	// Fallback: 24h from now
	return new Date(from.getTime() + 24 * 60 * 60 * 1000);
}

function matchField(field: (number | { base: number; step: number })[] | null | undefined, value: number): boolean {
	if (field === null || field === undefined) return true; // * matches everything
	return field.some((f) => {
		if (typeof f === "number") return f === value;
		// Step pattern: base/step
		if (value < f.base) return false;
		return (value - f.base) % f.step === 0;
	});
}
