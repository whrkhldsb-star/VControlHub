/**
 * TR-043: VPS backup job worker — durable job queue consumer.
 *
 * Polls the job queue for `vps-backup.create` jobs and executes
 * the backup flow via runVpsBackupRecord().
 */

import { claimNextJob, completeJob, failJob, heartbeatJob } from "@/lib/job/service";
import { runVpsBackupRecord, VPS_BACKUP_CREATE_JOB_TYPE } from "./vps-backup-service";

const POLL_INTERVAL_MS = 5000;
const LEASE_MS = 30 * 60 * 1000; // 30 min for large remote backups
const WORKER_ID = `${typeof process !== "undefined" ? process.env.HOSTNAME || "localhost" : "localhost"}:vps-backup:${process.pid}`;

let interval: ReturnType<typeof setInterval> | null = null;
let running = false;

/**
 * Process a single job tick: claim next job, run backup, complete/fail.
 */
export async function runVpsBackupJobWorkerOnce(): Promise<void> {
	const job = await claimNextJob({
		workerId: WORKER_ID,
		types: [VPS_BACKUP_CREATE_JOB_TYPE],
		leaseMs: LEASE_MS,
	});

	if (!job) return;

	try {
		// Heartbeat to extend lease before starting
		await heartbeatJob(job.id, WORKER_ID);

		const payload = job.payload as { recordId?: string; paths?: string[] };
		if (!payload?.recordId) {
			await failJob(job.id, WORKER_ID, "Missing recordId in job payload");
			return;
		}

		const paths = Array.isArray(payload.paths)
			? payload.paths.filter((p): p is string => typeof p === "string" && p.trim().length > 0).slice(0, 20)
			: undefined;
		const result = await runVpsBackupRecord(payload.recordId, paths?.length ? { paths } : undefined);

		if (result.success) {
			await completeJob(job.id, WORKER_ID, {
				fileSize: result.fileSize,
				checksumSha256: result.checksumSha256,
				localPath: result.localPath,
			});
		} else {
			await failJob(job.id, WORKER_ID, result.errorMessage || "Backup failed");
		}
	} catch (err) {
		const errMsg = err instanceof Error ? err.message : String(err);
		await failJob(job.id, WORKER_ID, errMsg);
	}
}

/**
 * Start the VPS backup job worker — polls every 5 seconds.
 */
export function startVpsBackupJobWorker(): ReturnType<typeof setInterval> {
	if (interval) return interval;

	interval = setInterval(async () => {
		if (running) return;
		running = true;
		try {
			await runVpsBackupJobWorkerOnce();
		} catch {
			// Swallow errors to keep the worker alive
		} finally {
			running = false;
		}
	}, POLL_INTERVAL_MS);

	return interval;
}

/** Stop the VPS backup job worker (for tests / graceful shutdown) */
export function stopVpsBackupForTests(): void {
	if (interval) {
		clearInterval(interval);
		interval = null;
	}
	running = false;
}
