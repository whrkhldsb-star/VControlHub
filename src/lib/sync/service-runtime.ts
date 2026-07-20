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
import {
  formatBidirectionalResult,
  isBidirectionalSyncType,
  mergeSyncStats,
  rsyncFlagsForJob,
  type OneWaySyncStats,
} from "./bidirectional";
import { getSyncJob } from "./service-crud";

/* ── remote command result ─────────────────────────────────── */

/**
 * execRemoteCommand resolves on stream close even when the remote process
 * exits non-zero. Sync must treat that as failure — otherwise rsync/tar
 * errors (permission denied, full disk, partial transfer) are parsed as
 * success and written COMPLETED/IDLE (false success).
 *
 * exitCode null means the SSH stream closed without a status (transport /
 * abrupt disconnect). Treat null as failure too — same policy as VPS backup
 * runVpsBackupRecord — never mark COMPLETED/IDLE on soft SSH errors.
 */
export function assertSyncRemoteSucceeded(
	result: { stdout: string; stderr: string; exitCode: number | null },
	label: string,
): void {
	if (result.exitCode === 0) return;
	// rsync/tar builders often merge stderr into stdout via `2>&1`
	const detail = (result.stderr || result.stdout || "").trim().slice(0, 500);
	if (result.exitCode == null) {
		throw new Error(
			detail
				? `${label} failed (SSH connection/status missing): ${detail}`
				: `${label} failed (SSH connection/status missing)`,
		);
	}
	throw new Error(
		detail
			? `${label} failed (exit ${result.exitCode}): ${detail}`
			: `${label} failed (exit ${result.exitCode})`,
	);
}

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

async function writePinnedKnownHosts(sourceSsh: SshConnectionParams, jobId: string, targetHost: string, targetPort: number, expectedFingerprint?: string | null): Promise<void> {
	const pin = expectedFingerprint?.trim();
	if (!pin) return;
	const knownHostsPath = getSyncTempKeyPath(jobId, "known_hosts");
	const keyscanResult = await execRemoteCommand({ ...sourceSsh, command: `ssh-keyscan -p ${targetPort} -T 5 ${shellQuote(targetHost)} 2>/dev/null`, timeout: 20000 });
	if (!keyscanResult.stdout.trim()) throw new Error(`Failed to verify target SSH host key: ssh-keyscan returned empty for ${targetHost}:${targetPort}`);
	const lines = keyscanResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
	let matchedLine = "";
	const observed: string[] = [];
	for (const line of lines) {
		const fingerprintResult = await execRemoteCommand({ ...sourceSsh, command: `printf '%s\n' ${shellQuote(line)} | ssh-keygen -lf - 2>/dev/null`, timeout: 10000 });
		const fingerprint = fingerprintResult.stdout.trim().split(/\s+/)[1] || "";
		if (fingerprint) observed.push(fingerprint);
		if (fingerprint === pin) { matchedLine = line; break; }
	}
	if (!matchedLine) throw new Error(`SSH host key mismatch for target ${targetHost}: expected ${pin}, got ${observed.join(", ") || "none"}. Sync aborted to prevent MITM.`);
	await execRemoteCommand({ ...sourceSsh, command: `rm -f -- ${shellQuote(knownHostsPath)} && umask 077 && : > ${shellQuote(knownHostsPath)} && chmod 600 -- ${shellQuote(knownHostsPath)}`, timeout: 15000 });
	await writeRemoteFile({ ...sourceSsh, remotePath: knownHostsPath, content: `${matchedLine}\n` });
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
	targetHostKeySha256?: string | null,
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
		hostKeySha256: targetHostKeySha256,
		jobId,
	});
	if (targetKey && keyPath) {
		await writeEphemeralPrivateKey(sourceSsh, keyPath, targetKey.privateKey);
	}
	const result = await execRemoteCommand({ ...sourceSsh, command: cmd, timeout: 600_000 });
	assertSyncRemoteSucceeded(result, "tar sync");
	return result.stdout;
}


/** Push sourcePath → targetPath once (rsync or tar). Returns parsed stats + raw output. */
async function runOneWayRsync(input: {
  jobId: string;
  sourceServer: NonNullable<Awaited<ReturnType<typeof getSyncJob>>>["sourceServer"];
  targetServer: NonNullable<Awaited<ReturnType<typeof getSyncJob>>>["targetServer"];
  sourcePath: string;
  targetPath: string;
  flags: string[];
  deleteOrphans: boolean;
}): Promise<{ output: string; stats: OneWaySyncStats }> {
  const sourceSsh = await buildSshParamsFromServer(input.sourceServer, input.sourceServer.sshKey);
  const targetSsh = await buildSshParamsFromServer(input.targetServer, input.targetServer.sshKey);
  const targetHost = input.targetServer.host;
  const targetPort = input.targetServer.port || 22;
  const targetUser = input.targetServer.username || "root";
  const targetCredentials = decryptSyncTargetCredentials(input.targetServer);
  const targetKeyPath = targetCredentials.privateKey ? getSyncTempKeyPath(input.jobId, "rsync") : undefined;
  if (!targetCredentials.privateKey && !targetCredentials.password) {
    throw new Error("Target server has no SSH key or password configured");
  }
  const legJobId = `${input.jobId}-leg`;
  const rsyncCmd = buildRsyncCommand({
    flags: input.flags,
    sourcePath: input.sourcePath,
    targetPath: input.targetPath,
    targetUser,
    targetHost,
    targetPort,
    keyPath: targetKeyPath,
    password: targetKeyPath ? undefined : targetCredentials.password,
    hostKeySha256: input.targetServer.hostKeySha256,
    jobId: legJobId,
  });
  await writePinnedKnownHosts(sourceSsh, legJobId, targetHost, targetPort, input.targetServer.hostKeySha256);
  const mkdirTarget = await execRemoteCommand({
    ...targetSsh,
    command: `mkdir -p -- ${shellQuote(input.targetPath)}`,
    timeout: 15000,
  });
  assertSyncRemoteSucceeded(mkdirTarget, "target mkdir");
  const mkdirSource = await execRemoteCommand({
    ...sourceSsh,
    command: `mkdir -p -- ${shellQuote(input.sourcePath)}`,
    timeout: 15000,
  });
  assertSyncRemoteSucceeded(mkdirSource, "source mkdir");
  const whichResult = await execRemoteCommand({
    ...sourceSsh,
    command: "which rsync 2>/dev/null || echo MISSING",
    timeout: 8000,
  });
  // which may exit non-zero when missing; we still read stdout for MISSING
  const whichRsync = whichResult.stdout;
  let output: string;
  if (whichRsync.trim() === "MISSING") {
    const targetSshKey = targetCredentials.privateKey ? { privateKey: targetCredentials.privateKey } : null;
    output = await executeTarSync(
      sourceSsh,
      legJobId,
      input.sourcePath,
      targetSsh,
      targetHost,
      targetPort,
      targetUser,
      targetSshKey,
      targetCredentials.password ?? null,
      input.targetPath,
      input.deleteOrphans,
      input.targetServer.hostKeySha256,
    );
  } else {
    if (targetCredentials.privateKey && targetKeyPath) {
      await writeEphemeralPrivateKey(sourceSsh, targetKeyPath, targetCredentials.privateKey);
    }
    const result = await execRemoteCommand({
      ...sourceSsh,
      command: rsyncCmd,
      timeout: 600_000,
    });
    assertSyncRemoteSucceeded(result, "rsync");
    output = result.stdout;
  }
  const stats = parseRsyncOutput(output);
  return {
    output,
    stats: {
      totalFiles: stats.totalFiles,
      transferredFiles: stats.transferredFiles,
      totalSize: stats.totalSize,
    },
  };
}

/* ── Main entry point ─────────────────────────────────────── */

export type ExecuteSyncJobResult = {
	ok: boolean;
	status: "IDLE" | "ERROR" | "RUNNING";
	lastSyncResult: string | null;
	errorMessage?: string;
};

/**
 * Run a sync job once. Always persists COMPLETED/FAILED on SyncLog and
 * IDLE/ERROR on SyncJob. Returns a structured result so HTTP callers can
 * surface failures instead of always returning success:true after a
 * swallowed catch.
 */
export async function executeSyncJob(jobId: string): Promise<ExecuteSyncJobResult> {
	const job = await getSyncJob(jobId);
	if (!job) throw new Error("Sync job not found");

	// CAS claim: only one runner can move IDLE/ERROR → RUNNING.
	const claimed = await prisma.syncJob.updateMany({
		where: { id: jobId, status: { in: ["IDLE", "ERROR"] } },
		data: { status: "RUNNING" },
	});
	if (claimed.count === 0) {
		throw new Error("Sync job is already running or paused");
	}

	const logEntry = await prisma.syncLog.create({
		data: { syncJobId: jobId, status: "RUNNING" },
	});

	const startTime = Date.now();

	try {
		const bidirectional = isBidirectionalSyncType(job.syncType);
		const deleteOrphans = bidirectional ? false : job.deleteOrphans;
		const flags = rsyncFlagsForJob({
			syncType: job.syncType,
			deleteOrphans: job.deleteOrphans,
			compress: job.compress,
		});

		// Forward: source → target
		const forward = await runOneWayRsync({
			jobId: `${jobId}-fwd`,
			sourceServer: job.sourceServer,
			targetServer: job.targetServer,
			sourcePath: job.sourcePath,
			targetPath: job.targetPath,
			flags,
			deleteOrphans,
		});

		let reverse: { stats: OneWaySyncStats } | null = null;
		let reverseError: string | null = null;
		if (bidirectional) {
			// Reverse: target → source (newer-wins via --update).
			// Bidirectional is not transactional — if reverse fails after forward,
			// record PARTIAL so operators see "forward done, reverse failed".
			try {
				reverse = await runOneWayRsync({
					jobId: `${jobId}-rev`,
					sourceServer: job.targetServer,
					targetServer: job.sourceServer,
					sourcePath: job.targetPath,
					targetPath: job.sourcePath,
					flags,
					deleteOrphans: false,
				});
			} catch (revErr) {
				reverseError = revErr instanceof Error ? revErr.message : String(revErr);
			}
		}

		const duration = Date.now() - startTime;
		const merged = mergeSyncStats(forward.stats, reverse?.stats);
		let lastSyncResult: string;
		let logStatus: "COMPLETED" | "FAILED" = "COMPLETED";
		if (reverseError) {
			logStatus = "FAILED";
			lastSyncResult =
				`Partial: forward completed (${forward.stats.transferredFiles} files, ${formatBytes(forward.stats.totalSize)}); ` +
				`reverse failed: ${reverseError.slice(0, 180)}. Bidirectional sync is not transactional.`;
		} else if (reverse) {
			lastSyncResult = formatBidirectionalResult({
				forward: forward.stats,
				reverse: reverse.stats,
				durationMs: duration,
			});
		} else {
			lastSyncResult = `Success: ${forward.stats.transferredFiles} files, ${formatBytes(forward.stats.totalSize)}, ${Math.round(duration / 1000)}s`;
		}

		await prisma.syncLog.update({
			where: { id: logEntry.id },
			data: {
				status: logStatus,
				filesScanned: merged.totalFiles,
				filesTransferred: merged.transferredFiles,
				bytesTransferred: String(merged.totalSize),
				durationMs: duration,
				completedAt: new Date(),
				...(reverseError ? { errorMessage: reverseError.slice(0, 2000) } : {}),
			},
		});

		await prisma.syncJob.update({
			where: { id: jobId },
			data: {
				status: reverseError ? "ERROR" : "IDLE",
				lastSyncAt: new Date(),
				lastSyncResult,
			},
		});

		return {
			ok: !reverseError,
			status: reverseError ? "ERROR" : "IDLE",
			lastSyncResult,
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const errMsg = error instanceof Error ? error.message : String(error);
		const lastSyncResult = `Failed: ${errMsg.slice(0, 200)}`;

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
			data: { status: "ERROR", lastSyncResult },
		});

		logError(`[SyncService] Job ${jobId} failed:`, error);
		return {
			ok: false,
			status: "ERROR",
			lastSyncResult,
			errorMessage: errMsg.slice(0, 2000),
		};
	}
}
