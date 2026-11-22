import { cleanupEndpoint, encodeSyncRun, readSyncRun, type SyncRunReceipt } from "./run-receipt";
import { t } from "@/lib/i18n/service-translations";
import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Sync service — execution layer (R28 god-file split).
 *
 * Orchestrates an `executeSyncJob` call: fetches the job, builds SSH
 * transports, runs rsync (or tar fallback when rsync is missing),
 * parses the output, and writes the result to `syncLog` + `syncJob`.
 *
 * Pure command building lives in `./service-commands`, the run's one-time
 * target key in `./one-time-key`, credential decryption in
 * `./service-credentials`, prisma CRUD in `./service-crud`. Which of the two
 * ways the source logs in to the target ("credential" or "one-time-key") is
 * chosen per target server, see `./target-auth`.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { PERMISSIONS } from "@/lib/auth/rbac";
import { loadExecutionActor, executionRefusal } from "@/lib/auth/execution-actor";
import type { ResolvedStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import type { SessionPayload } from "@/lib/auth/session";
import type { Prisma } from "@prisma/client";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
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
	createSyncReceiverLease,
	retireSyncReceiverLease,
	syncReceiverLeasePath,
	getSyncTempKeyPath,
	preparePhysicalDirectory,
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
import { decryptSyncTargetCredentials } from "./service-credentials";
import { resolveSyncTargetAuth, SYNC_TARGET_AUTH_SETTING, type SyncTargetAuth } from "./target-auth";
import {
	effectiveDeleteOrphans,
	formatBidirectionalResult,
	syncEndpointAccess,
	isBidirectionalSyncType,
	mergeSyncStats,
	rsyncFlagsForJob,
	type OneWaySyncStats,
	isProtectedDeleteTarget,
} from "./bidirectional";
import { mirrorDirectoryIdentities } from "./mirror-directories";
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
	const result = await execRemoteCommand({
		...sourceSsh,
		command: `rm -f -- ${paths.map(shellQuote).join(" ")}`,
		timeout: 15000,
	});
	assertSyncRemoteSucceeded(result, "removing temporary SSH credential files");
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
	const commandOption = buildAuthorizedKeysGateOption(input.gateScript, expiresAt);
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
	const credential = targetUsesPassword ? "password" : "key";
	return `${targetLabel} did not accept the one-time sync key from the source server (${detail}). With a one-time key the source logs in with a key made for this run, so the target's sshd must allow public-key login for this user through ~/.ssh/authorized_keys${targetUsesPassword ? " (VControlHub itself logs in to this target with a password)" : ""}. To hand the target's own ${credential} to the source for the run instead, the original way, set this server's sync login to "Original".`;
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
	confined: boolean;
}) {
	// Jobs saved before the same check existed at creation are stopped here too.
	if (input.deleteOrphans && isProtectedDeleteTarget(input.targetPath)) {
		throw new Error(`Refusing to delete everything in ${input.targetPath} that the source does not hold: it is a system directory.`);
	}
	const probe = await execRemoteCommand({
		...input.sourceSsh,
		command: buildSyncSourceProbeCommand(input.sourcePath, input.deleteOrphans),
		timeout: 15000,
	});
	assertSyncRemoteSucceeded(probe, "source check");
	let state = parseSyncSourceProbe(probe.stdout);
	if (!state) throw new Error(`source check returned no status for ${input.sourcePath}`);
	if (state === "missing" && input.createMissingSource && !input.deleteOrphans) {
		const created = await execRemoteCommand({
			...input.sourceSsh,
			command: input.confined ? preparePhysicalDirectory(input.sourcePath) : `mkdir -p -- ${shellQuote(input.sourcePath)}`,
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
		command: buildSyncTargetPrepareCommand(input.targetPath, input.confined, input.deleteOrphans),
		timeout: 15000,
	});
	assertSyncRemoteSucceeded(prepared, "target mkdir");
	if (state === "empty" && input.deleteOrphans && prepared.stdout.includes("VCH_SYNC_TARGET=nonempty")) {
		throw new Error(`Source directory ${input.sourcePath} is empty; refusing to delete everything in ${input.targetPath}. Check that the source is mounted and populated.`);
	}
	return input.deleteOrphans ? mirrorDirectoryIdentities(input.sourcePath, probe.stdout, input.targetPath, prepared.stdout) : undefined;
}

/* ── one leg ──────────────────────────────────────────────── */

/** Forward (job source → job target) or, for bidirectional jobs, reverse. */
type SyncLeg = "fwd" | "rev";

/** Names the leg's temp files on its source host. */
function legFileStem(jobId: string, leg: SyncLeg): string {
	return `${jobId}-${leg}-leg`;
}

type SyncEndpointServer = NonNullable<Awaited<ReturnType<typeof getSyncJobForExecution>>>["sourceServer"];

async function resolveSyncDirectory(server: SyncEndpointServer, directory: string, signal: AbortSignal) {
	const ssh = await buildSshParamsFromServer(server, server.sshKey, server.teamId);
	const response = await execRemoteCommand({ ...ssh, signal, command: `realpath -m -- ${shellQuote(directory)}`, timeout: 15000 });
	assertSyncRemoteSucceeded(response, "resolve sync directory");
	const physical = response.stdout.replace(/\r?\n$/, "");
	if (!physical.startsWith("/") || /[\x00-\x1f\x7f]/.test(physical)) throw new Error("Invalid physical sync directory");
	return physical;
}

/** Fence cleanup to the same remote accounts, even when a Server record is repointed after a crash. */
function endpointIdentity(job: { sourceServer: SyncEndpointServer; targetServer: SyncEndpointServer }, legacy = false) {
	const endpoints = [job.sourceServer, job.targetServer].map(s => [
		s.id, s.teamId, s.host, s.port, s.username, s.hostKeySha256,
		...(legacy ? [] : [s.managementMode, s.operatingSystem, s.managementMode === "AGENT" ? s.agentTokenHash : null]),
	]);
	return createHash("sha256").update(JSON.stringify(endpoints)).digest("hex");
}

/** Push sourcePath → targetPath once (rsync or tar). Returns parsed stats + raw output. */
async function runOneWayRsync(input: {
	jobId: string;
	checkOwnership: () => Promise<void>;
	onCleanupPending: () => void;
	sourceConnection?: ResolvedStorageSshCredentials;
	targetConnection?: ResolvedStorageSshCredentials;
	signal: AbortSignal;
	confined: boolean;
	leg: SyncLeg;
	/** How the source logs in to the target (resolved from the target server's choice). */
	auth: SyncTargetAuth;
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
	await input.checkOwnership();
	const sourceSsh = { ...(input.sourceConnection ?? await buildSshParamsFromServer(input.sourceServer, input.sourceServer.sshKey, input.sourceServer.teamId)), signal: input.signal };
	const targetSsh = { ...(input.targetConnection ?? await buildSshParamsFromServer(input.targetServer, input.targetServer.sshKey, input.targetServer.teamId)), signal: input.signal };
	const targetHost = input.targetServer.host;
	const targetPort = input.targetServer.port || 22;
	const targetUser = input.targetServer.username || "root";
	const hostKeySha256 = input.targetServer.hostKeySha256;
	// Target setup can run entirely over the Agent, but the source still opens SSH to that target.
	if (targetSsh.enforceHostKeyPin && !hostKeySha256?.trim()) throw new Error(t("backend.ssh.hostKeyNotPinned"));
	const legJobId = legFileStem(input.jobId, input.leg);
	// Credential mode hands the target's own key or password to the source: without one there is nothing to run with.
	if (input.auth === "credential" && input.targetConnection?.passphrase) {
		throw new Error("The target SSH key cannot be unlocked for rsync");
	}
	const targetCredentials = input.auth === "credential" ? (input.targetConnection ?? decryptSyncTargetCredentials(input.targetServer)) : null;
	if (targetCredentials && !targetCredentials.privateKey && !targetCredentials.password) {
		throw new Error("Target server has no SSH key or password configured");
	}
	// Everything this leg leaves in the source host's /tmp, removed when it ends.
	const sourceFiles = hostKeySha256?.trim() ? [getSyncTempKeyPath(legJobId, "known_hosts")] : [];
	let access: OneTimeAccess | null = null;
	let receiverLease: string | undefined;
	try {
		await writePinnedKnownHosts(sourceSsh, legJobId, targetHost, targetPort, hostKeySha256);
		const directories = await assertSyncSourceUsable({
			sourceSsh,
			targetSsh,
			sourcePath: input.sourcePath,
			targetPath: input.targetPath,
			deleteOrphans: input.deleteOrphans,
			createMissingSource: input.createMissingSource,
			confined: input.confined,
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
		receiverLease = syncReceiverLeasePath(legJobId);
		const prepared = await execRemoteCommand({ ...targetSsh, command: createSyncReceiverLease(receiverLease), timeout: 15000 });
		assertSyncRemoteSucceeded(prepared, "creating receiver lease");
		await input.checkOwnership();
		let command: string;
		if (!targetCredentials) {
			const keyPath = getSyncTempKeyPath(legJobId, useTar ? "tar" : "rsync");
			sourceFiles.push(keyPath);
			const transport = { ...directories, receiverLease, confined: input.confined, auth: "one-time-key" as const, targetUser, targetHost, targetPort, keyPath, hostKeySha256, jobId: legJobId };
			command = useTar
				? buildTarSyncCommand({ ...transport, sourcePath: input.sourcePath })
				: buildRsyncCommand({ ...transport, sourcePath: input.sourcePath, flags: input.flags });
			access = await grantOneTimeTargetAccess({
				sourceSsh,
				targetSsh,
				jobId: input.jobId,
				leg: input.leg,
				transport,
				gateScript: buildSyncGateScript({ receiverLease, targetIdentity: directories?.targetIdentity, confined: input.confined, mode: useTar ? "tar" : "rsync", targetPath: input.targetPath, allowDelete: input.deleteOrphans, jobId: legJobId }),
				targetLabel: `${input.targetServer.name ? `${input.targetServer.name} ` : ""}(${targetUser}@${targetHost}:${targetPort})`,
				targetUsesPassword: input.targetServer.connectionType === "PASSWORD",
			});
		} else {
			// The original way: the target's own key, or else its password for sshpass, in the source's /tmp for the run.
			const keyPath = targetCredentials.privateKey ? getSyncTempKeyPath(legJobId, useTar ? "tar" : "rsync") : undefined;
			const passwordEnvPath = !keyPath && targetCredentials.password ? getSyncTempKeyPath(legJobId, "env") : undefined;
			const transport = { ...directories, receiverLease, confined: input.confined, auth: "credential" as const, targetUser, targetHost, targetPort, keyPath, passwordEnvPath, hostKeySha256, jobId: legJobId };
			// Built before anything secret is written, so a refused value never leaves a file behind.
			command = useTar
				? buildTarSyncCommand({ ...transport, sourcePath: input.sourcePath, targetPath: input.targetPath, deleteOrphans: input.deleteOrphans })
				: buildRsyncCommand({ ...transport, sourcePath: input.sourcePath, targetPath: input.targetPath, flags: input.flags });
			if (keyPath) {
				sourceFiles.push(keyPath);
				await writeEphemeralPrivateKey(sourceSsh, keyPath, targetCredentials.privateKey!);
			}
			if (passwordEnvPath) {
				sourceFiles.push(passwordEnvPath);
				await writeEphemeralPrivateKey(sourceSsh, passwordEnvPath, `SSHPASS=${shellQuote(targetCredentials.password!)}\n`);
			}
		}
		await input.checkOwnership();
		const result = await execRemoteCommand({
			...sourceSsh,
			command,
			signal: input.signal,
			timeout: SYNC_COMMAND_TIMEOUT_MS,
		});
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
		const [files, receiver] = await Promise.allSettled([
			removeEphemeralFiles(sourceSsh, sourceFiles),
			receiverLease && execRemoteCommand({ ...targetSsh, command: retireSyncReceiverLease(receiverLease), timeout: 15000 })
				.then(result => assertSyncRemoteSucceeded(result, "releasing receiver lease")),
		]);
		if (files.status === "rejected") logError("[Sync] Could not remove temporary SSH credential files:", files.reason);
		const failure = receiver.status === "rejected" ? receiver : (targetCredentials && files.status === "rejected" ? files : null);
		if (failure) {
			input.onCleanupPending();
			throw failure.reason;
		}
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
		expectedOccurrence?: { updatedAt: Date; schedule: string | null; lastSyncAt: Date | null };
		/** Who runs it now (a manual run); a scheduled run acts as the job's creator. */
		actor?: SessionPayload;
	},
): Promise<ExecuteSyncJobResult> {
	const job = await getSyncJobForExecution(jobId);
	if (!job) throw new Error("Sync job not found");

	const runId = randomUUID();
	const endpointsAtClaim = endpointIdentity(job);
	const leaseId = `${runId}~${endpointsAtClaim}`;
	const receipt: SyncRunReceipt = {
		scope: { sourceServerId: job.sourceServerId, sourcePath: job.sourcePath, targetServerId: job.targetServerId, targetPath: job.targetPath },
		cleanup: [cleanupEndpoint(job.sourceServer), cleanupEndpoint(job.targetServer)],
	};
	const owner = { id: jobId, status: "RUNNING" as const, activeRunId: leaseId };
	await prisma.$transaction(async (tx) => {
		const destinations = isBidirectionalSyncType(job.syncType)
			? [...new Set([job.sourceServerId, job.targetServerId])].sort() : [job.targetServerId];
		for (const id of destinations) await lockForTransaction(tx, "sync-destination", id);
		const busy = await tx.syncJob.findFirst({
			where: { status: "RUNNING", OR: [
				{ targetServerId: { in: destinations } },
				{ sourceServerId: { in: destinations }, syncType: { equals: "BIDIRECTIONAL", mode: "insensitive" } },
			] },
			select: { id: true },
		});
		if (busy) throw new Error("Sync destination is already in use");
		const claimed = await tx.syncJob.updateMany({
			where: { id: jobId, updatedAt: job.updatedAt, ...options?.expectedOccurrence, status: { in: ["IDLE", "ERROR"] } },
			data: { status: "RUNNING", activeRunId: leaseId },
		});
		if (!claimed.count) throw new Error("Sync job is already running or paused");
		await tx.syncLog.create({ data: { id: leaseId, syncJobId: jobId, status: "RUNNING", errorMessage: encodeSyncRun(receipt) } });
	});

	let cleanupPending = false;
	const onCleanupPending = () => { cleanupPending = true; };
	const finish = (status: "IDLE" | "ERROR", lastSyncResult: string, log: Prisma.SyncLogUpdateInput, lastSyncAt?: Date) =>
		prisma.$transaction(async (tx) => {
			const changed = await tx.syncJob.updateMany({
				where: owner,
				data: cleanupPending
					? { status: "RUNNING", activeRunId: CLEANUP_PREFIX + leaseId, lastSyncResult: "Cleanup pending", lastSyncAt }
					: { status, activeRunId: null, lastSyncResult: status === "ERROR" ? "Failed" : lastSyncResult, lastSyncAt },
			});
			if (!changed.count) return false;
			await tx.syncLog.update({ where: { id: leaseId }, data: { ...log, ...(cleanupPending && { status: "RUNNING", completedAt: null }), errorMessage: encodeSyncRun({
				scope: receipt.scope, cleanup: cleanupPending ? receipt.cleanup : undefined,
				result: lastSyncResult, error: typeof log.errorMessage === "string" ? log.errorMessage : undefined,
			}) } });
			return true;
		});
	const controller = new AbortController();
	const refresh = async () => {
		controller.signal.throwIfAborted();
		const result = await prisma.syncJob.updateMany({ where: owner, data: { updatedAt: new Date() } });
		if (!result.count) throw new Error("Sync run no longer owns this job");
	};
	const heartbeat = setInterval(() => { void refresh().catch(error => controller.abort(error)); }, SYNC_HEARTBEAT_MS);
	heartbeat.unref?.();
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
		const bidirectional = isBidirectionalSyncType(job.syncType);
		const deleteOrphans = effectiveDeleteOrphans(job.syncType, job.deleteOrphans);
		const authorize = async (current: typeof job, session: SessionPayload | null, reverse: boolean) => {
			const refusal = await executionRefusal({
				actor: session, createdBy: current.createdBy, teamId: current.teamId, permission: "storage:write",
				serverIds: [current.sourceServerId, current.targetServerId],
			});
			if (refusal) throw new ForbiddenError(refusal);
			assertDisjointSyncEndpoints(current);
			const access = syncEndpointAccess(current.syncType, current.deleteOrphans, reverse);
			const paths = await assertSyncEndpointsWithinReach([
				{ serverId: current.sourceServerId, server: current.sourceServer, path: current.sourcePath, ...access.source },
				{ serverId: current.targetServerId, server: current.targetServer, path: current.targetPath, ...access.target },
			], session);
			if (deleteOrphans && isProtectedDeleteTarget(current.targetPath)) throw new Error("Refusing mirror into a system directory");
			const [sourcePath, targetPath] = paths ? paths.map(path => path.remotePath) : deleteOrphans
				? await Promise.all([resolveSyncDirectory(current.sourceServer, current.sourcePath, controller.signal), resolveSyncDirectory(current.targetServer, current.targetPath, controller.signal)])
				: [current.sourcePath, current.targetPath];
			if (!sourcePath || !targetPath) throw new Error("Missing sync endpoint");
			const sameHost = current.sourceServer.host.toLowerCase() === current.targetServer.host.toLowerCase()
				&& current.sourceServer.port === current.targetServer.port;
			assertDisjointSyncEndpoints({ ...current, sourcePath, targetPath,
				targetServerId: sameHost ? current.sourceServerId : current.targetServerId });
			if (deleteOrphans && isProtectedDeleteTarget(targetPath)) throw new Error(t("backend.sync.deleteTargetIsSystemDirectory"));
			return { sourcePath, targetPath, sourceConnection: paths?.[0]?.credentials, targetConnection: paths?.[1]?.credentials, confined: !!paths || deleteOrphans };
		};
		const forwardPaths = await authorize(job, actor, false);
		const flags = rsyncFlagsForJob({
			syncType: job.syncType,
			deleteOrphans: job.deleteOrphans,
			compress: job.compress,
		});

		// Each leg's login follows the server it writes to; the platform default is
		// read once, and only when one of them follows it.
		let platformDefault: Promise<string> | null = null;
		const readPlatformDefault = () =>
			(platformDefault ??= import("@/lib/settings/service").then(({ getSetting }) => getSetting(SYNC_TARGET_AUTH_SETTING)));

		// Forward: source → target
		const forward = await runOneWayRsync({
			jobId: runId,
			checkOwnership: refresh,
			onCleanupPending,
			signal: controller.signal,
			...forwardPaths,
			leg: "fwd",
			auth: await resolveSyncTargetAuth(job.targetServer, readPlatformDefault),
			sourceServer: job.sourceServer,
			targetServer: job.targetServer,
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
				const current = await getSyncJobForExecution(jobId);
				if (!current || current.teamId !== job.teamId || current.createdBy !== job.createdBy ||
					current.syncType !== job.syncType || current.sourcePath !== job.sourcePath || current.targetPath !== job.targetPath ||
					endpointIdentity(current) !== endpointsAtClaim) {
					throw new ForbiddenError(t("backend.command.connectionChanged"));
				}
				const account = await loadExecutionActor(options?.actor?.userId ?? job.createdBy, job.teamId);
				let live = account;
				if (account && options?.actor) {
					// A limited token must not acquire all the live account's permissions on the return leg.
					const manual = options.actor;
					live = { ...account, permissions: PERMISSIONS.filter(p => sessionHasPermission(account, p) && sessionHasPermission(manual, p)),
						roles: account.roles.filter(role => manual.roles.includes(role)) };
				}
				const paths = await authorize(current, live, true);
				if (paths.sourcePath !== forwardPaths.sourcePath || paths.targetPath !== forwardPaths.targetPath) {
					throw new ForbiddenError(t("backend.command.connectionChanged"));
				}
				reverse = await runOneWayRsync({
					jobId: runId,
					checkOwnership: refresh,
					onCleanupPending,
					signal: controller.signal,
					confined: paths.confined,
					sourceConnection: paths.targetConnection,
					targetConnection: paths.sourceConnection,
					leg: "rev",
					auth: await resolveSyncTargetAuth(current.sourceServer, readPlatformDefault),
					sourceServer: current.targetServer,
					targetServer: current.sourceServer,
					sourcePath: paths.targetPath,
					targetPath: paths.sourcePath,
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

		const finished = await finish(reverseError ? "ERROR" : "IDLE", lastSyncResult, {
			status: logStatus,
			filesScanned: merged.totalFiles,
			filesTransferred: merged.transferredFiles,
			bytesTransferred: String(merged.totalSize),
			durationMs: duration,
			completedAt: new Date(),
			...(reverseError ? { errorMessage: reverseError.slice(0, 2000) } : {}),
		}, new Date());
		if (!finished) throw new Error("Sync run no longer owns this job");

		return {
			ok: !reverseError,
			status: reverseError ? "ERROR" : "IDLE",
			lastSyncResult,
		};
	} catch (error) {
		const duration = Date.now() - startTime;
		const errMsg = error instanceof Error ? error.message : String(error);
		const lastSyncResult = `Failed: ${errMsg.slice(0, 200)}`;

		await finish("ERROR", lastSyncResult, {
			status: "FAILED", errorMessage: errMsg.slice(0, 2000), durationMs: duration, completedAt: new Date(),
		});

		logError(`[SyncService] Job ${jobId} failed:`, error);
		return {
			ok: false,
			status: "ERROR",
			lastSyncResult,
			errorMessage: errMsg.slice(0, 2000),
		};
	} finally {
		clearInterval(heartbeat);
	}
}

/** RUNNING without completion after this age is treated as abandoned (OOM/kill). */
const CLEANUP_PREFIX = "cleanup:";
const STALE_SYNC_RUNNING_MS = 30 * 60 * 1000;

/**
 * A sync may legitimately run for hours (first full copy, one huge file). The
 * old 10-minute hard timeout killed those every time (A4-03); rsync's own
 * `--timeout` now catches a dead link. While the command runs, the job row is
 * touched so the 30-minute stale-RUNNING reclaim keeps meaning "worker died".
 */
const SYNC_COMMAND_TIMEOUT_MS = 12 * 60 * 60 * 1000;
const SYNC_HEARTBEAT_MS = 5 * 60 * 1000;

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
		select: { id: true, activeRunId: true },
		take: 100,
		orderBy: { updatedAt: "asc" },
	});

	const reclaimed: string[] = [];
	for (const job of stale) {
		const retry = job.activeRunId?.startsWith(CLEANUP_PREFIX);
		const leaseId = retry ? job.activeRunId!.slice(CLEANUP_PREFIX.length) : (job.activeRunId ?? job.id);
		const marker = CLEANUP_PREFIX + leaseId;
		const moved = await prisma.$transaction(async (tx) => {
			// Replace the dead owner's fence before touching either remote. Keep its run id and
			// keep the destination busy until both hosts have confirmed removal.
			const claimed = await tx.syncJob.updateMany({
				where: { id: job.id, activeRunId: job.activeRunId, status: "RUNNING", updatedAt: { lt: cutoff } },
				data: { activeRunId: marker, updatedAt: now,
					lastSyncResult: "Failed: worker lost; temporary SSH credential cleanup pending" },
			});
			if (!claimed.count) return false;
			return true;
		});
		if (!moved) continue;
		try {
			const receipt = await sweepOneTimeSyncAccess(job.id, leaseId);
			const released = await prisma.$transaction(async tx => {
				const summary = "Failed: interrupted sync; temporary SSH credential cleanup completed";
				const result = await tx.syncJob.updateMany({
					where: { id: job.id, status: "RUNNING", activeRunId: marker },
					data: { status: "ERROR", activeRunId: null, lastSyncResult: summary },
				});
				if (result.count) await tx.syncLog.updateMany({
					where: { syncJobId: job.id, ...(job.activeRunId && leaseId !== job.id ? { id: leaseId } : { status: "RUNNING" }) },
					data: { status: "FAILED", completedAt: now, errorMessage: receipt ? encodeSyncRun({ scope: receipt.scope, result: summary,
						error: receipt.error ?? apiCopy("apiCopy.reclaimed.stale.running.sync.after.process.loss.8aa169ca") }) : null },
				});
				return result;
			});
			if (released.count) reclaimed.push(job.id);
		} catch (error) {
			logError(`[Sync] Cleanup for job ${job.id}, run ${leaseId} will be retried:`, error);
		}
	}
	return reclaimed;
}

/**
 * A run that died (worker killed, hub restarted) never reached its finally:
 * a one-time key line can still be in authorized_keys on either server (the
 * reverse leg installs on the job's source), and the private key, SSHPASS env
 * file (credential mode) and known_hosts files in the other server's /tmp.
 * Remove them on both servers, best effort: a one-time key line also stops
 * working at its expiry time, and the next install on that host removes it too.
 */
async function sweepOneTimeSyncAccess(jobId: string, leaseId: string) {
	const job = await getSyncJobForExecution(jobId);
	if (!job) throw new Error("Sync job unavailable for credential cleanup");
	// Plain run ids predate endpoint binding and still name their original temporary files.
	const [runId, identity] = leaseId.split("~");
	if (!runId) throw new Error("Missing sync run identity");
	const receipt = readSyncRun((await prisma.syncLog.findUnique({ where: { id: leaseId }, select: { errorMessage: true } }))?.errorMessage, true);
	const changed = Boolean(identity && identity !== endpointIdentity(job, !receipt));
	if (changed && !receipt?.cleanup) throw new Error("Original sync endpoint unavailable for cleanup");
	const endpoints = changed && receipt?.cleanup ? receipt.cleanup : [job.sourceServer, job.targetServer];
	const servers = endpoints.filter((server, index) => endpoints.findIndex(other => other.id === server.id) === index);
	const files = (["fwd", "rev"] as const).flatMap((leg) => (["rsync", "tar", "env", "known_hosts"] as const).map((purpose) => getSyncTempKeyPath(legFileStem(runId, leg), purpose)));
	const retire = (["fwd", "rev"] as const)
		.map(leg => retireSyncReceiverLease(syncReceiverLeasePath(legFileStem(runId, leg)))).join("\n");
	const results = await Promise.allSettled(servers.map(async server => {
		const live = server.id === job.sourceServer.id ? job.sourceServer : job.targetServer;
		const sameEndpoint = !changed || (server.teamId === live.teamId && server.host === live.host && server.port === live.port
			&& server.username === live.username && server.hostKeySha256 === live.hostKeySha256 && server.managementMode === live.managementMode
			&& server.operatingSystem === live.operatingSystem && (server.managementMode !== "AGENT" || server.agentTokenHash === live.agentTokenHash));
		const sameAgent = server.managementMode === "AGENT" && !server.sshKey?.privateKey && !server.password && !!server.agentTokenHash
			&& live.managementMode === "AGENT" && server.teamId === live.teamId && server.agentTokenHash === live.agentTokenHash;
		if (!sameEndpoint && !sameAgent && !server.hostKeySha256) throw new Error("Missing original host key for cleanup");
		// A moved profile can no longer authorize a command by server ID. Its sealed SSH snapshot authenticates
		// the original host for this run's cleanup only. An unchanged agent token can still address that agent.
		const ssh = sameEndpoint ? await buildSshParamsFromServer(live, live.sshKey, live.teamId)
			: sameAgent ? await buildSshParamsFromServer(server, null, server.teamId)
			: await buildSshParamsFromServer({ ...server, managementMode: "DIRECT" }, server.sshKey);
		const result = await execRemoteCommand({
			...ssh,
			command: `${retire}\nrm -f -- ${files.map(shellQuote).join(" ")} || exit 1\n${buildOneTimeKeyRevokeCommand({ jobId: runId })}`,
			timeout: 60000,
		});
		assertSyncRemoteSucceeded(result, "removing temporary sync credentials");
	}));
	for (const result of results) if (result.status === "rejected") throw result.reason;
	return receipt;
}
