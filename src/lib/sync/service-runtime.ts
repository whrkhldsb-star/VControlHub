import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Sync service — execution layer (R28 god-file split).
 *
 * Orchestrates an `executeSyncJob` call: fetches the job, builds SSH
 * transports, runs rsync (or tar fallback when rsync is missing),
 * parses the output, and writes the result to `syncLog` + `syncJob`.
 *
 * Pure command building lives in `./service-commands`, the run's one-time
 * target key in `./one-time-key`, prisma CRUD in `./service-crud`. The target
 * server's own password or key never leaves the hub: the hub uses it for its
 * own connection to the target, and the source gets a one-time key.
 */
import { randomBytes } from "node:crypto";

import { loadExecutionActor, executionRefusal } from "@/lib/auth/execution-actor";
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/lib/errors";
import { formatBytes } from "@/lib/format/bytes";
import { execRemoteCommand, buildSshParamsFromServer, writeRemoteFile, type SshConnectionParams } from "@/lib/ssh/client";
import { logError } from "@/lib/logging";
import { shellQuote } from "@/lib/shell-quote";

import {
	buildRsyncCommand,
	buildSyncGateScript,
	buildSyncPeerProbeCommand,
	buildSyncSourceProbeCommand,
	buildSyncTargetPrepareCommand,
	buildTarSyncCommand,
	getSyncTempKeyPath,
	parseSyncPeerProbe,
	parseSyncSourceProbe,
} from "./service-commands";
import {
	buildAuthorizedKeysGateOption,
	buildOneTimeKeyInstallCommand,
	buildOneTimeKeyRevokeCommand,
	generateOneTimeKeyPair,
	oneTimeKeyMarker,
} from "./one-time-key";
import {
	effectiveDeleteOrphans,
	formatBidirectionalResult,
	isBidirectionalSyncType,
	mergeSyncStats,
	rsyncFlagsForJob,
	type OneWaySyncStats,
} from "./bidirectional";
import { isProtectedDeleteTarget } from "./bidirectional";
import { assertDisjointSyncEndpoints, assertSyncEndpointsWithinReach, getSyncJobForExecution } from "./service-crud";

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
	const detail = remoteDetail(result);
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

function remoteDetail(result: { stdout: string; stderr: string }): string {
	return (result.stderr || result.stdout || "").trim().slice(0, 500);
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

/* ── One-time private key on the source ───────────────────── */

async function writeEphemeralPrivateKey(sourceSsh: SshConnectionParams, keyPath: string, privateKey: string): Promise<void> {
	const created = await execRemoteCommand({
		...sourceSsh,
		command: `rm -f -- ${shellQuote(keyPath)} && umask 077 && : > ${shellQuote(keyPath)} && chmod 600 -- ${shellQuote(keyPath)}`,
		timeout: 15000,
	});
	// Otherwise the write below would create the file with the default mode.
	assertSyncRemoteSucceeded(created, "creating the one-time key file on the source");
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
 * started, left the key in the source host's /tmp. The runtime removes them
 * after every run as well.
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

/* ── One-time access to the target ────────────────────────── */

/**
 * A one-time key line stays valid on the target, even if nobody removes it,
 * for the longest a transfer may run (the tar commit connects again at its
 * end) plus this margin for clock differences between hub and target.
 */
const ONE_TIME_KEY_GRACE_MS = 60 * 60 * 1000;

type OneTimeAccess = { revoke: () => Promise<void> };

/**
 * Give the source a one-time key to the target for this leg (see
 * `./one-time-key`): install the key, pinned to `gateScript`, on the target
 * over the hub's own connection; write the private half on the source; let the
 * source connect once to prove the target accepts it and learn the address it
 * connects from; re-add the line with `from=` that address. Any failure
 * removes the line again before the error propagates.
 *
 * There is deliberately no fallback to the target's own password or key: a
 * target that cannot take a key fails here with a message that says why.
 */
async function grantOneTimeTargetAccess(input: {
	sourceSsh: SshConnectionParams;
	targetSsh: SshConnectionParams;
	jobId: string;
	leg: SyncLeg;
	transport: Parameters<typeof buildSyncPeerProbeCommand>[0] & { keyPath: string };
	gateScript: string;
	targetLabel: string;
	targetUsesPassword: boolean;
}): Promise<OneTimeAccess> {
	const run = `${input.leg}-${randomBytes(6).toString("hex")}`;
	const expiresAt = new Date(Date.now() + SYNC_COMMAND_TIMEOUT_MS + ONE_TIME_KEY_GRACE_MS);
	const keys = generateOneTimeKeyPair(oneTimeKeyMarker({ jobId: input.jobId, run, expiresAt }));
	const commandOption = buildAuthorizedKeysGateOption(input.gateScript);
	const install = async (from: string | null) => {
		const result = await execRemoteCommand({
			...input.targetSsh,
			command: buildOneTimeKeyInstallCommand({ user: input.transport.targetUser, publicKey: keys.publicKey, commandOption, jobId: input.jobId, expiresAt, from }),
			timeout: 60000,
		});
		if (result.exitCode !== 0 || !result.stdout.includes("VCH_SYNC_KEY_INSTALLED")) {
			throw new Error(`Could not add the one-time sync key to ${input.targetLabel}'s authorized_keys: ${remoteDetail(result) || `exit ${result.exitCode ?? "unknown"}`}`);
		}
	};
	const revoke = async () => {
		try {
			const result = await execRemoteCommand({
				...input.targetSsh,
				command: buildOneTimeKeyRevokeCommand({ jobId: input.jobId, run }),
				timeout: 60000,
			});
			assertSyncRemoteSucceeded(result, "removing the one-time sync key");
		} catch (error) {
			// It stops working at its expiry time, and the next install on this
			// host or the stale-run reclaim removes it.
			logError(`[Sync] Could not remove the one-time sync key ${run} from ${input.targetLabel}:`, error);
		}
	};
	try {
		await install(null);
		await writeEphemeralPrivateKey(input.sourceSsh, input.transport.keyPath, keys.privateKey);
		const probe = await execRemoteCommand({ ...input.sourceSsh, command: buildSyncPeerProbeCommand(input.transport), timeout: 60000 });
		const peer = probe.exitCode === 0 ? parseSyncPeerProbe(probe.stdout) : undefined;
		if (peer === undefined) {
			throw new Error(oneTimeKeyRefusedMessage(input.targetLabel, remoteDetail(probe) || `exit ${probe.exitCode ?? "unknown"}`, input.targetUsesPassword));
		}
		if (peer) await install(peer);
		else logError(`[Sync] ${input.targetLabel} did not report a usable source address; the one-time key stays without from=.`);
		return { revoke };
	} catch (error) {
		await revoke();
		throw error;
	}
}

function oneTimeKeyRefusedMessage(targetLabel: string, detail: string, targetUsesPassword: boolean): string {
	const why = targetUsesPassword
		? "VControlHub logs in to this target with a password, and sync no longer hands that password to the source server"
		: "Sync no longer copies the target's own key or password to the source server";
	return `${targetLabel} did not accept the one-time sync key from the source server (${detail}). ${why}: the source logs in with a key made for this run, so the target's sshd must allow public-key login for this user through ~/.ssh/authorized_keys.`;
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
	// Jobs saved before the same check existed at creation are stopped here too.
	if (input.deleteOrphans && isProtectedDeleteTarget(input.targetPath)) {
		throw new Error(`Refusing to delete everything in ${input.targetPath} that the source does not hold: it is a system directory.`);
	}
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

/* ── one leg ──────────────────────────────────────────────── */

/** Forward (job source → job target) or, for bidirectional jobs, reverse. */
type SyncLeg = "fwd" | "rev";

/** Names the leg's temp files on its source host. */
function legFileStem(jobId: string, leg: SyncLeg): string {
	return `${jobId}-${leg}-leg`;
}

type SyncEndpointServer = NonNullable<Awaited<ReturnType<typeof getSyncJobForExecution>>>["sourceServer"];

/** Push sourcePath → targetPath once (rsync or tar). Returns parsed stats + raw output. */
async function runOneWayRsync(input: {
	jobId: string;
	leg: SyncLeg;
	sourceServer: SyncEndpointServer;
	targetServer: SyncEndpointServer;
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
	const hostKeySha256 = input.targetServer.hostKeySha256;
	const legJobId = legFileStem(input.jobId, input.leg);
	// Everything this leg leaves in the source host's /tmp, removed when it ends.
	const sourceFiles = hostKeySha256?.trim() ? [getSyncTempKeyPath(legJobId, "known_hosts")] : [];
	let access: OneTimeAccess | null = null;
	try {
		await writePinnedKnownHosts(sourceSsh, legJobId, targetHost, targetPort, hostKeySha256);
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
		const useTar = whichResult.stdout.trim() === "MISSING";
		if (useTar && !input.allowTarFallback) {
			throw new Error(
				"Bidirectional sync requires rsync on both VPS nodes; install rsync and retry. Tar fallback is disabled because it cannot preserve newer-wins semantics.",
			);
		}
		const keyPath = getSyncTempKeyPath(legJobId, useTar ? "tar" : "rsync");
		sourceFiles.push(keyPath);
		const transport = { targetUser, targetHost, targetPort, keyPath, hostKeySha256, jobId: legJobId };
		access = await grantOneTimeTargetAccess({
			sourceSsh,
			targetSsh,
			jobId: input.jobId,
			leg: input.leg,
			transport,
			gateScript: buildSyncGateScript({ mode: useTar ? "tar" : "rsync", targetPath: input.targetPath, allowDelete: input.deleteOrphans, jobId: legJobId }),
			targetLabel: `${input.targetServer.name ? `${input.targetServer.name} ` : ""}(${targetUser}@${targetHost}:${targetPort})`,
			targetUsesPassword: input.targetServer.connectionType === "PASSWORD",
		});
		const command = useTar
			? buildTarSyncCommand({ ...transport, sourcePath: input.sourcePath })
			: buildRsyncCommand({ ...transport, sourcePath: input.sourcePath, flags: input.flags });
		// The heartbeat touches the job's own row: the leg's file stem matched no row,
		// so the stale-RUNNING reclaim took every run longer than 30 minutes for dead.
		const result = await runWithSyncHeartbeat(input.jobId, () => execRemoteCommand({
			...sourceSsh,
			command,
			timeout: SYNC_COMMAND_TIMEOUT_MS,
		}));
		assertSyncRemoteSucceeded(result, useTar ? "tar sync" : "rsync");
		const stats = parseRsyncOutput(result.stdout);
		return {
			output: result.stdout,
			stats: {
				totalFiles: stats.totalFiles,
				transferredFiles: stats.transferredFiles,
				totalSize: stats.totalSize,
			},
		};
	} finally {
		await access?.revoke();
		await removeEphemeralFiles(sourceSsh, sourceFiles);
	}
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
		const actor = options?.actor ?? await loadExecutionActor(job.createdBy, job.teamId);
		const refusal = await executionRefusal({
			actor,
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
		await assertSyncEndpointsWithinReach([
			{ serverId: job.sourceServerId, path: job.sourcePath, operations: bidirectional ? ["read", "write"] : ["read"] },
			{ serverId: job.targetServerId, path: job.targetPath, operations: [...(bidirectional ? ["read" as const] : []), "write", ...(deleteOrphans ? ["delete" as const] : [])] },
		], actor);
		const flags = rsyncFlagsForJob({
			syncType: job.syncType,
			deleteOrphans: job.deleteOrphans,
			compress: job.compress,
		});

		// Forward: source → target
		const forward = await runOneWayRsync({
			jobId,
			leg: "fwd",
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
					jobId,
					leg: "rev",
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
 * A sync may legitimately run for hours (first full copy, one huge file). The
 * old 10-minute hard timeout killed those every time (A4-03); rsync's own
 * `--timeout` now catches a dead link. While the command runs, the job row is
 * touched so the 30-minute stale-RUNNING reclaim keeps meaning "worker died".
 */
const SYNC_COMMAND_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const SYNC_HEARTBEAT_MS = 5 * 60 * 1000;

async function runWithSyncHeartbeat<T>(jobId: string | undefined, run: () => Promise<T>): Promise<T> {
	if (!jobId) return run();
	const beat = () => {
		try {
			void Promise.resolve(prisma.syncJob.updateMany({ where: { id: jobId, status: "RUNNING" }, data: { updatedAt: new Date() } })).catch(() => undefined);
		} catch { /* a mocked or closed client must not break the transfer */ }
	};
	const timer = setInterval(beat, SYNC_HEARTBEAT_MS);
	timer.unref?.();
	try {
		return await run();
	} finally {
		clearInterval(timer);
	}
}

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
	for (const jobId of reclaimed) await sweepOneTimeSyncAccess(jobId);
	return reclaimed;
}

/**
 * A run that died (worker killed, hub restarted) never reached its finally:
 * its one-time key line can still be in authorized_keys on either server (the
 * reverse leg installs on the job's source), and its private key and
 * known_hosts files in the other server's /tmp. Remove both on both servers,
 * best effort: the line also stops working at its expiry time, and the next
 * install on that host removes it too.
 */
export async function sweepOneTimeSyncAccess(jobId: string): Promise<void> {
	let job: Awaited<ReturnType<typeof getSyncJobForExecution>>;
	try {
		job = await getSyncJobForExecution(jobId);
	} catch (error) {
		logError(`[Sync] Could not load job ${jobId} to remove its one-time keys:`, error);
		return;
	}
	if (!job) return;
	const servers = [job.sourceServer, job.targetServer].filter((server, index, all) => all.findIndex((other) => other.id === server.id) === index);
	const files = (["fwd", "rev"] as const).flatMap((leg) => (["rsync", "tar", "known_hosts"] as const).map((purpose) => getSyncTempKeyPath(legFileStem(jobId, leg), purpose)));
	await Promise.all(servers.map(async (server) => {
		try {
			const ssh = await buildSshParamsFromServer(server, server.sshKey);
			const result = await execRemoteCommand({
				...ssh,
				command: `rm -f -- ${files.map(shellQuote).join(" ")}\n${buildOneTimeKeyRevokeCommand({ jobId })}`,
				timeout: 60000,
			});
			assertSyncRemoteSucceeded(result, "removing one-time sync keys");
		} catch (error) {
			logError(`[Sync] Could not remove one-time sync keys of job ${jobId} on server ${server.id}:`, error);
		}
	}));
}
