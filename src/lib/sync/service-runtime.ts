/**
 * Sync service — execution layer (R28 god-file split).
 *
 * Orchestrates an `executeSyncJob` call: fetches the job, builds SSH
 * transports, runs rsync (or tar fallback when rsync is missing),
 * parses the output, and writes the result to `syncLog` + `syncJob`.
 *
 * Pure command building lives in `./service-commands`, credential
 * decryption in `./service-credentials`, prisma CRUD in `./service-crud`.
 */
import { prisma } from "@/lib/db";
import { execRemoteCommand, buildSshParamsFromServer, writeRemoteFile, type SshConnectionParams } from "@/lib/ssh/client";
import { logError } from "@/lib/logging";
import { shellQuote } from "@/lib/shell-quote";

import { buildRsyncCommand, buildTarSyncCommand, getSyncTempKeyPath } from "./service-commands";
import { decryptSyncTargetCredentials } from "./service-credentials";
import { getSyncJob } from "./service-crud";

/* ── rsync output parsing ─────────────────────────────────── */

function parseRsyncOutput(output: string) {
	let totalFiles = 0;
	let transferredFiles = 0;
	let totalSize = 0;

	const totalFileMatch = output.match(/Number of files:\s*(\d+)/);
	if (totalFileMatch) totalFiles = parseInt(totalFileMatch[1]!, 10);

	const transferredMatch = output.match(/Number of regular files transferred:\s*(\d+)/);
	if (transferredMatch) transferredFiles = parseInt(transferredMatch[1]!, 10);

	const totalSizeMatch = output.match(/Total file size:\s*([\d,]+)/);
	if (totalSizeMatch) totalSize = parseInt(totalSizeMatch[1]!.replace(/,/g, ""), 10);

	// Fallback: count lines that look like file transfers
	if (transferredFiles === 0) {
		const lines = output.split("\n").filter((l) => l && !l.startsWith("sent ") && !l.startsWith("total ") && !l.startsWith("Number") && !l.startsWith("Total") && !l.startsWith("speedup"));
		transferredFiles = lines.length;
	}

	return { totalFiles, transferredFiles, totalSize };
}

function formatBytes(n: number): string {
	if (n === 0) return "0 B";
	const units = ["B", "KB", "MB", "GB", "TB"];
	const i = Math.floor(Math.log(n) / Math.log(1024));
	return `${(n / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

/* ── Ephemeral private key ────────────────────────────────── */

async function writeEphemeralPrivateKey(sourceSsh: SshConnectionParams, keyPath: string, privateKey: string): Promise<void> {
	await execRemoteCommand({
		...sourceSsh,
		command: `rm -f -- ${shellQuote(keyPath)} && umask 077 && : > ${shellQuote(keyPath)} && chmod 600 -- ${shellQuote(keyPath)}`,
		timeout: 15000,
	});
	await writeRemoteFile({ ...sourceSsh, remotePath: keyPath, content: privateKey });
	await execRemoteCommand({
		...sourceSsh,
		command: `chmod 600 -- ${shellQuote(keyPath)}`,
		timeout: 15000,
	});
}

/* ── tar fallback ──────────────────────────────────────────── */

/** Fallback tar-based sync when rsync is not available */
async function executeTarSync(
	sourceSsh: SshConnectionParams,
	jobId: string,
	sourcePath: string,
	_targetSsh: SshConnectionParams,
	targetHost: string,
	targetPort: number,
	targetUser: string,
	targetKey: { privateKey: string } | null,
	targetPassword: string | null,
	targetPath: string,
	_deleteOrphans: boolean,
): Promise<string> {
	// Use tar over SSH pipe — portable fallback when rsync is unavailable.
	const keyPath = targetKey ? getSyncTempKeyPath(jobId, "tar") : undefined;
	if (!targetKey && !targetPassword) {
		throw new Error("No SSH credentials for target");
	}

	const cmd = buildTarSyncCommand({
		sourcePath,
		targetPath,
		targetUser,
		targetHost,
		targetPort,
		keyPath,
		password: keyPath ? undefined : (targetPassword ?? undefined),
		deleteOrphans: _deleteOrphans,
	});
	if (targetKey && keyPath) {
		await writeEphemeralPrivateKey(sourceSsh, keyPath, targetKey.privateKey);
	}
	const result = await execRemoteCommand({ ...sourceSsh, command: cmd, timeout: 600_000 });
	return result.stdout;
}

/* ── Main entry point ─────────────────────────────────────── */

export async function executeSyncJob(jobId: string): Promise<void> {
	const job = await getSyncJob(jobId);
	if (!job) throw new Error("Sync job not found");

	await prisma.syncJob.update({ where: { id: jobId }, data: { status: "RUNNING" } });

	const logEntry = await prisma.syncLog.create({
		data: { syncJobId: jobId, status: "RUNNING" },
	});

	const startTime = Date.now();

	try {
		// Build rsync command executed on the source server, pushing to target
		const sourceSsh = await buildSshParamsFromServer(job.sourceServer, job.sourceServer.sshKey);
		const targetSsh = await buildSshParamsFromServer(job.targetServer, job.targetServer.sshKey);

		// Determine rsync flags
		const flags: string[] = ["-avz", "--stats"];
		if (job.deleteOrphans) flags.push("--delete");
		if (job.compress) flags.push("--compress");

		// Build the remote-to-remote rsync command.
		// We run rsync from the source server, pushing to target via SSH.
		const targetHost = job.targetServer.host;
		const targetPort = job.targetServer.port || 22;
		const targetUser = job.targetServer.username || "root";
		const targetCredentials = decryptSyncTargetCredentials(job.targetServer);
		const targetKeyPath = targetCredentials.privateKey ? getSyncTempKeyPath(jobId, "rsync") : undefined;

		if (!targetCredentials.privateKey && !targetCredentials.password) {
			throw new Error("Target server has no SSH key or password configured");
		}

		const rsyncCmd = buildRsyncCommand({
			flags,
			sourcePath: job.sourcePath,
			targetPath: job.targetPath,
			targetUser,
			targetHost,
			targetPort,
			keyPath: targetKeyPath,
			password: targetKeyPath ? undefined : targetCredentials.password,
		});

		// Ensure target directory exists
		await execRemoteCommand({
			...targetSsh,
			command: `mkdir -p -- ${shellQuote(job.targetPath)}`,
			timeout: 15000,
		});

		// Ensure source directory exists
		await execRemoteCommand({
			...sourceSsh,
			command: `mkdir -p -- ${shellQuote(job.sourcePath)}`,
			timeout: 15000,
		});

		// Check if rsync is available on source
		const { stdout: whichRsync } = await execRemoteCommand({
			...sourceSsh,
			command: "which rsync 2>/dev/null || echo MISSING",
			timeout: 8000,
		});

		let output: string;

		if (whichRsync.trim() === "MISSING") {
			// Fallback: use tar + ssh for incremental sync
			const targetSshKey = targetCredentials.privateKey ? { privateKey: targetCredentials.privateKey } : null;
			output = await executeTarSync(sourceSsh, jobId, job.sourcePath, targetSsh, targetHost, targetPort, targetUser, targetSshKey, targetCredentials.password ?? null, job.targetPath, job.deleteOrphans);
		} else {
			if (targetCredentials.privateKey && targetKeyPath) {
				await writeEphemeralPrivateKey(sourceSsh, targetKeyPath, targetCredentials.privateKey);
			}
			const result = await execRemoteCommand({
				...sourceSsh,
				command: rsyncCmd,
				timeout: 600_000, // 10 min max
			});
			output = result.stdout;
		}

		// Parse rsync output for stats
		const stats = parseRsyncOutput(output);
		const duration = Date.now() - startTime;

		await prisma.syncLog.update({
			where: { id: logEntry.id },
			data: {
				status: "COMPLETED",
				filesScanned: stats.totalFiles,
				filesTransferred: stats.transferredFiles,
				bytesTransferred: String(stats.totalSize),
				durationMs: duration,
				completedAt: new Date(),
			},
		});

		await prisma.syncJob.update({
			where: { id: jobId },
			data: {
				status: "IDLE",
				lastSyncAt: new Date(),
				lastSyncResult: `Success: ${stats.transferredFiles} files, ${formatBytes(stats.totalSize)}, ${Math.round(duration / 1000)}s`,
			},
		});

	} catch (error) {
		const duration = Date.now() - startTime;
		const errMsg = error instanceof Error ? error.message : String(error);

		await prisma.syncLog.update({
			where: { id: logEntry.id },
			data: {
				status: "FAILED",
				errorMessage: errMsg.slice(0, 2000),
				durationMs: duration,
				completedAt: new Date(),
			},
		});

		await prisma.syncJob.update({
			where: { id: jobId },
			data: { status: "ERROR", lastSyncResult: `Failed: ${errMsg.slice(0, 200)}` },
		});

		logError(`[SyncService] Job ${jobId} failed:`, error);
	}
}
