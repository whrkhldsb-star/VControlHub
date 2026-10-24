import { apiCopy } from "@/lib/i18n/api-copy";
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
import { executionRefusal } from "@/lib/auth/execution-actor";
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { formatBytes } from "@/lib/format/bytes";
import { execRemoteCommand, buildSshParamsFromServer, writeRemoteFile, type SshConnectionParams } from "@/lib/ssh/client";
import { logError } from "@/lib/logging";
import { shellQuote } from "@/lib/shell-quote";

import {
	buildRsyncCommand,
	buildSyncSourceProbeCommand,
	buildSyncTargetPrepareCommand,
	buildTarSyncCommand,
	getSyncTempKeyPath,
	parseSyncSourceProbe,
} from "./service-commands";
import { decryptSyncTargetCredentials } from "./service-credentials";
import {
	effectiveDeleteOrphans,
	formatBidirectionalResult,
	isBidirectionalSyncType,
	mergeSyncStats,
	rsyncFlagsForJob,
	type OneWaySyncStats,
} from "./bidirectional";
import { assertDisjointSyncEndpoints, getSyncJobForExecution } from "./service-crud";

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

/**
 * rsync --stats as numbers. Counts carry thousands separators ("1,006"), so
 * a plain \d+ read 1; a real 0 is a result, not a reason to guess from the
 * output's line count; and what this run moved is "Total transferred file
 * size", not the size of everything at the source ("Total file size").
 */
export function parseRsyncOutput(output: string) {
	const stat = (label: string): number | null => {
		const match = new RegExp(`${label}:\\s*([\\d,.]+)`).exec(output);
		if (!match) return null;
		const value = Number.parseInt(match[1]!.replace(/[,.]/g, ""), 10);
		return Number.isFinite(value) ? value : null;
	};
	const totalFiles = stat("Number of files") ?? 0;
	let transferredFiles = stat("Number of regular files transferred");
	const totalSize = stat("Total transferred file size") ?? 0;

	// No --stats block at all (tar fallback): count lines that look like files.
	if (transferredFiles === null) {
		const lines = output.split("\n").filter((l) => l && !l.startsWith("sent ") && !l.startsWith("total ") && !l.startsWith("Number") && !l.startsWith("Total") && !l.startsWith("speedup"));
		transferredFiles = lines.length;
	}

	return { totalFiles, transferredFiles, totalSize };
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

/**
 * The command's own trap removes its key and known_hosts files, but only once
 * it runs: a failed write, or an SSH session that dropped before the command
 * started, left the target's private key in the source host's /tmp.
 */
async function removeEphemeralFiles(sourceSsh: SshConnectionParams, paths: string[]): Promise<void> {
	if (paths.length === 0) return;
	await execRemoteCommand({
		...sourceSsh,
		command: `rm -f -- ${paths.map(shellQuote).join(" ")}`,
		timeout: 15000,
	}).catch((error) => logError("[Sync] Could not remove temporary SSH credential files:", error));
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

/* ── endpoint preflight ───────────────────────────────────── */

/**
 * The source must already exist and be readable. It used to be created with
 * mkdir -p, so a mistyped path, a deleted directory or a mount that was not up
 * yet turned into an empty source — and a MIRROR (or delete-orphans) run then
 * deleted everything on the target. An existing but empty source is refused
 * the same way when deletion would empty a non-empty target: there is no
 * explicit "clear the target" operation, and an unmounted mount point looks
 * exactly like an empty directory.
 */
async function assertSyncSourceUsable(input: {
	sourceSsh: SshConnectionParams;
	targetSsh: SshConnectionParams;
	sourcePath: string;
	targetPath: string;
	deleteOrphans: boolean;
	createMissingSource: boolean;
}): Promise<void> {
	const probe = await execRemoteCommand({
		...input.sourceSsh,
		command: buildSyncSourceProbeCommand(input.sourcePath),
		timeout: 15000,
	});
	assertSyncRemoteSucceeded(probe, "source check");
	let state = parseSyncSourceProbe(probe.stdout);
	if (!state) throw new Error(`source check returned no status for ${input.sourcePath}`);
	if (state === "missing" && input.createMissingSource && !input.deleteOrphans) {
		const created = await execRemoteCommand({
			...input.sourceSsh,
			command: `mkdir -p -- ${shellQuote(input.sourcePath)}`,
			timeout: 15000,
		});
		assertSyncRemoteSucceeded(created, "source mkdir");
		state = "empty";
	}
	if (state === "missing") {
		throw new Error(`Source directory ${input.sourcePath} does not exist; it is not created automatically. Check the path or mount, then retry.`);
	}
	if (state === "unreadable") {
		throw new Error(`Source directory ${input.sourcePath} is not readable by the sync user.`);
	}
	const prepared = await execRemoteCommand({
		...input.targetSsh,
		command: buildSyncTargetPrepareCommand(input.targetPath),
		timeout: 15000,
	});
	assertSyncRemoteSucceeded(prepared, "target mkdir");
	if (state === "empty" && input.deleteOrphans && prepared.stdout.includes("VCH_SYNC_TARGET=nonempty")) {
		throw new Error(`Source directory ${input.sourcePath} is empty; refusing to delete everything in ${input.targetPath}. Check that the source is mounted and populated.`);
	}
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
	let result: Awaited<ReturnType<typeof execRemoteCommand>>;
	try {
		if (targetKey && keyPath) {
			await writeEphemeralPrivateKey(sourceSsh, keyPath, targetKey.privateKey);
		}
		result = await execRemoteCommand({ ...sourceSsh, command: cmd, timeout: 600_000 });
	} catch (error) {
		await removeEphemeralFiles(sourceSsh, [keyPath, targetHostKeySha256?.trim() ? getSyncTempKeyPath(jobId, "known_hosts") : undefined].filter((path): path is string => Boolean(path)));
		throw error;
	}
	assertSyncRemoteSucceeded(result, "tar sync");
	return result.stdout;
}


/** Push sourcePath → targetPath once (rsync or tar). Returns parsed stats + raw output. */
async function runOneWayRsync(input: {
	jobId: string;
	sourceServer: NonNullable<Awaited<ReturnType<typeof getSyncJobForExecution>>>["sourceServer"];
	targetServer: NonNullable<Awaited<ReturnType<typeof getSyncJobForExecution>>>["targetServer"];
	sourcePath: string;
	targetPath: string;
	flags: string[];
	deleteOrphans: boolean;
	allowTarFallback: boolean;
	/** Only a leg that never deletes may create its own missing source. */
	createMissingSource: boolean;
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
	await assertSyncSourceUsable({
		sourceSsh,
		targetSsh,
		sourcePath: input.sourcePath,
		targetPath: input.targetPath,
		deleteOrphans: input.deleteOrphans,
		createMissingSource: input.createMissingSource,
	});
	const whichResult = await execRemoteCommand({
		...sourceSsh,
		command: "which rsync 2>/dev/null || echo MISSING",
		timeout: 8000,
	});
	// which may exit non-zero when missing; we still read stdout for MISSING
	const whichRsync = whichResult.stdout;
	let output: string;
	if (whichRsync.trim() === "MISSING") {
	if (!input.allowTarFallback) {
		throw new Error(
		"Bidirectional sync requires rsync on both VPS nodes; install rsync and retry. Tar fallback is disabled because it cannot preserve newer-wins semantics.",
		);
	}
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
		let result: Awaited<ReturnType<typeof execRemoteCommand>>;
		try {
			if (targetCredentials.privateKey && targetKeyPath) {
				await writeEphemeralPrivateKey(sourceSsh, targetKeyPath, targetCredentials.privateKey);
			}
			result = await execRemoteCommand({
				...sourceSsh,
				command: rsyncCmd,
				timeout: 600_000,
			});
		} catch (error) {
			await removeEphemeralFiles(sourceSsh, [targetKeyPath, input.targetServer.hostKeySha256?.trim() ? getSyncTempKeyPath(legJobId, "known_hosts") : undefined].filter((path): path is string => Boolean(path)));
			throw error;
		}
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
export async function executeSyncJob(
	jobId: string,
	options?: {
		onClaimed?: () => void | Promise<void>;
		/** Who runs it now (a manual run); a scheduled run acts as the job's creator. */
		actor?: SessionPayload;
	},
): Promise<ExecuteSyncJobResult> {
	const job = await getSyncJobForExecution(jobId);
	if (!job) throw new Error("Sync job not found");

	// CAS claim: only one runner can move IDLE/ERROR → RUNNING.
	const claimed = await prisma.syncJob.updateMany({
		where: { id: jobId, status: { in: ["IDLE", "ERROR"] } },
		data: { status: "RUNNING" },
	});
	if (claimed.count === 0) {
		throw new Error("Sync job is already running or paused");
	}

	// Nothing ran yet: if the log cannot be written, hand the claim back
	// instead of leaving the job RUNNING until the stale sweep (30 minutes).
	let logEntry: { id: string };
	try {
		logEntry = await prisma.syncLog.create({
			data: { syncJobId: jobId, status: "RUNNING" },
		});
	} catch (error) {
		await prisma.syncJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { status: job.status === "ERROR" ? "ERROR" : "IDLE" } })
			.catch(() => undefined);
		throw error;
	}

	const startTime = Date.now();

	try {
		// The CAS above made this runner the sole RUNNING owner, and the
		// scheduler's findMany only selects IDLE/ERROR rows — so a caller's
		// cross-process mutual-exclusion lock is now redundant and must not pin a
		// scarce advisory-lock connection for the full (possibly hours-long) rsync.
		if (options?.onClaimed) await options.onClaimed();
		// Authorised when created is not authorised now: the runner (or the
		// creator, for a scheduled run) must still reach both enabled servers.
		const refusal = await executionRefusal({
			actor: options?.actor,
			createdBy: job.createdBy,
			teamId: job.teamId,
			permission: "storage:write",
			serverIds: [job.sourceServerId, job.targetServerId],
		});
		if (refusal) throw new ForbiddenError(refusal);
		// Existing jobs must obey the same directory policy as newly saved jobs.
		assertDisjointSyncEndpoints(job);

		const bidirectional = isBidirectionalSyncType(job.syncType);
		const deleteOrphans = effectiveDeleteOrphans(job.syncType, job.deleteOrphans);
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
			allowTarFallback: !bidirectional,
			// Bidirectional legs never delete, and the reverse leg fills a newly
			// created side; one-way jobs must point at a real source.
			createMissingSource: bidirectional,
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
					allowTarFallback: false,
					createMissingSource: true,
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
			// Keep the shape parseSyncResultMessage expects: "(<n> files, <size>,
			// <secs>s)" — the report panel renders the parsed leg counts, and a
			// partial run that parsed as "0 files" contradicted this very message.
			lastSyncResult =
				`Partial: forward completed (${forward.stats.transferredFiles} files, ${formatBytes(forward.stats.totalSize)}, ${Math.round(duration / 1000)}s); ` +
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

/** RUNNING without completion after this age is treated as abandoned (OOM/kill). */
const STALE_SYNC_RUNNING_MS = 30 * 60 * 1000;

/**
 * Reclaim SyncJob rows stuck in RUNNING after process death.
 * executeSyncJob only CAS-claims IDLE/ERROR→RUNNING; without reclaim, isSyncJobDue
 * and the schedule worker skip forever and manual /run also fails CAS.
 */
export async function reclaimStaleRunningSyncJobs(options?: {
	olderThanMs?: number;
	now?: Date;
}): Promise<string[]> {
	const olderThanMs = options?.olderThanMs ?? STALE_SYNC_RUNNING_MS;
	const now = options?.now ?? new Date();
	const cutoff = new Date(now.getTime() - olderThanMs);

	const stale = await prisma.syncJob.findMany({
		where: { status: "RUNNING", updatedAt: { lt: cutoff } },
		select: { id: true },
		take: 100,
		orderBy: { updatedAt: "asc" },
	});

	const reclaimed: string[] = [];
	for (const job of stale) {
		const moved = await prisma.syncJob.updateMany({
			where: { id: job.id, status: "RUNNING", updatedAt: { lt: cutoff } },
			data: {
				status: "ERROR",
				lastSyncResult: `Failed: reclaimed stale RUNNING after ${Math.round(olderThanMs / 60_000)}m (worker may have died)`,
			},
		});
		if (moved.count === 0) continue;
		await prisma.syncLog.updateMany({
			where: { syncJobId: job.id, status: "RUNNING" },
			data: {
				status: "FAILED",
				errorMessage: apiCopy("apiCopy.reclaimed.stale.running.sync.after.process.loss.8aa169ca"),
				completedAt: now,
			},
		});
		reclaimed.push(job.id);
	}
	return reclaimed;
}
