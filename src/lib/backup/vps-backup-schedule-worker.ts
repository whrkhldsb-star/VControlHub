/**
 * TR-043: VPS backup schedule tick worker.
 *
 * Polls every 60 seconds and dispatches due VPS backup schedules.
 * The tick worker only does lightweight DB writes; actual backup
 * execution is handled by the vps-backup-job-worker asynchronously.
 */

import { completeJob } from "@/lib/job/service";
import { prisma } from "@/lib/db";
import { dispatchDueVpsBackupSchedules } from "./vps-backup-schedule-service";

const TICK_INTERVAL_MS = 60_000; // 60 seconds
const WORKER_ID = `${process.env.HOSTNAME || "localhost"}:vps-backup-schedule:${process.pid}`;

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Process a single tick: dispatch due VPS backup schedules.
 * Uses a PostgreSQL session advisory lock so multi-process ticks cannot
 * both observe "no RUNNING tick" and create overlapping dispatch work.
 */
export async function runVpsBackupScheduleTickOnce(): Promise<number> {
	// Stable int4 keys for pg_advisory_lock (namespace + resource).
	const LOCK_K1 = 0x56505342; // 'VPSB'
	const LOCK_K2 = 0x53434844; // 'SCHD'
	await prisma.$executeRaw`SELECT pg_advisory_lock(${LOCK_K1}, ${LOCK_K2})`;
	try {
		// Prevent overlapping ticks (re-check under lock)
		const existing = await prisma.job.findFirst({
			where: {
				type: "vps-backup-schedule.tick",
				status: "RUNNING",
				// Ignore expired leases so a crashed worker cannot block forever.
				OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { gt: new Date() } }],
			},
			select: { id: true },
		});

		if (existing) return 0;

		// Mark any expired RUNNING ticks as failed before creating a new one.
		await prisma.job.updateMany({
			where: {
				type: "vps-backup-schedule.tick",
				status: "RUNNING",
				leaseExpiresAt: { lte: new Date() },
			},
			data: {
				status: "FAILED",
				errorMessage: "Stale VPS backup schedule tick lease expired",
			},
		});

		// Create a transient tick job (payload is required by schema)
		const tickJob = await prisma.job.create({
			data: {
				type: "vps-backup-schedule.tick",
				title: "VPS backup schedule tick",
				status: "RUNNING",
				workerId: WORKER_ID,
				payload: {},
				leaseExpiresAt: new Date(Date.now() + 120_000),
			},
		});

		try {
			const dispatched = await dispatchDueVpsBackupSchedules();
			await completeJob(tickJob.id, WORKER_ID, { dispatched });
			return dispatched;
		} catch (err) {
			const errMsg = err instanceof Error ? err.message : String(err);
			await prisma.job.update({
				where: { id: tickJob.id },
				data: { status: "FAILED", errorMessage: errMsg },
			});
			return 0;
		}
	} finally {
		try {
			await prisma.$executeRaw`SELECT pg_advisory_unlock(${LOCK_K1}, ${LOCK_K2})`;
		} catch {
			// Session end will release; ignore unlock races.
		}
	}
}

/**
 * Start the VPS backup schedule tick worker — polls every 60 seconds.
 */
export function startVpsBackupScheduleWorker(): ReturnType<typeof setInterval> {
	if (interval) return interval;

	interval = setInterval(async () => {
		if (running) return;
		running = true;
		try {
			await runVpsBackupScheduleTickOnce();
		} catch {
			// Swallow errors to keep the worker alive
		} finally {
			running = false;
		}
	}, TICK_INTERVAL_MS);

	return interval;
}

/** Stop the VPS backup schedule tick worker (for tests / graceful shutdown) */
export function stopVpsBackupScheduleForTests(): void {
	if (interval) {
		clearInterval(interval);
		interval = null;
	}
	running = false;
}
