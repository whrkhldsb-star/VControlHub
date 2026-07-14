/**
 * Sync service — pure command construction (R28 god-file split).
 *
 * Builds the rsync / tar over SSH command strings. No I/O, no prisma, no
 * decryption — those live in `./service-runtime` and `./service-credentials`.
 * Re-exports `shellQuote` for callers that need a stable import path.
 */
import { ValidationError } from "@/lib/errors";
import { shellQuote } from "@/lib/shell-quote";

export { shellQuote };

/* ── Types ────────────────────────────────────────────────── */

type SyncTargetCommandInput = {
	sourcePath: string;
	targetPath: string;
	targetUser: string;
	targetHost: string;
	targetPort: number;
	keyPath?: string;
	password?: string;
	hostKeySha256?: string | null; // OPEN-2: SSH host key pin for rsync/tar sync
	jobId?: string; // For generating temp known_hosts path
};

type RsyncCommandInput = SyncTargetCommandInput & {
	flags: string[];
};

type TarSyncCommandInput = SyncTargetCommandInput & {
	deleteOrphans: boolean;
};

/* ── Patterns ─────────────────────────────────────────────── */

const SSH_USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const HOSTNAME_PATTERN = /^[A-Za-z0-9._:-]+$/;
const RSYNC_HOST_PATTERN = /^[A-Za-z0-9.:[\]@_-]+$/;

/* ── Sanitisation helpers ─────────────────────────────────── */

function assertSafeSshUsername(username: string): void {
	if (!SSH_USERNAME_PATTERN.test(username) || username.startsWith("-")) {
		throw new ValidationError("Unsafe SSH username");
	}
}

function assertSafeHost(host: string): void {
	if (!HOSTNAME_PATTERN.test(host) || host.startsWith("-")) {
		throw new ValidationError("Unsafe SSH host");
	}
}

function formatRsyncHost(host: string): string {
	assertSafeHost(host);
	return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function formatSshHost(host: string): string {
	assertSafeHost(host);
	return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

function buildRsyncTargetAddress(targetUser: string, targetHost: string): string {
	assertSafeSshUsername(targetUser);
	const address = `${targetUser}@${formatRsyncHost(targetHost)}`;
	if (!RSYNC_HOST_PATTERN.test(address)) {
		throw new ValidationError("Unsafe rsync target address");
	}
	return address;
}

function buildSshTargetAddress(targetUser: string, targetHost: string): string {
	assertSafeSshUsername(targetUser);
	return `${targetUser}@${formatSshHost(targetHost)}`;
}

function assertSafeSshPort(targetPort: number): void {
	if (!Number.isInteger(targetPort) || targetPort < 1 || targetPort > 65535) {
		throw new ValidationError("Unsafe SSH port");
	}
}

function buildSshOptions(targetPort: number, _hostKeySha256?: string | null, _knownHostsPath?: string): string {
	assertSafeSshPort(targetPort);
	// OPEN-2: Host key verification is done in service-runtime via ssh-keyscan
	// before the rsync command is dispatched. Here we keep accept-new for
	// connectivity — the pin check is a pre-flight gate, not an SSH option.
	return [
		"-o StrictHostKeyChecking=accept-new",
		"-o UserKnownHostsFile=/dev/null",
		`-p ${targetPort}`,
	].join(" ");
}

/* ── Temp-key path ────────────────────────────────────────── */

function safeFileStem(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function getSyncTempKeyPath(jobId: string, purpose: "rsync" | "tar" | "known_hosts"): string {
	return `/tmp/app-sync-${purpose}-${safeFileStem(jobId)}`;
}

/* ── Command builders ─────────────────────────────────────── */

function shellDoubleQuote(value: string): string {
	return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

function buildSshTransport(input: SyncTargetCommandInput): string {
	const sshCommand = ["ssh", buildSshOptions(input.targetPort, input.hostKeySha256)];
	if (input.keyPath) sshCommand.push("-i", shellQuote(input.keyPath));
	const base = sshCommand.join(" ");
	if (input.password) {
		// Use SSHPASS env var to avoid leaking password in /proc/cmdline
		return `SSHPASS=${shellQuote(input.password)} sshpass -e ${base}`;
	}
	return base;
}

function withKeyCleanup(command: string, keyPath?: string): string {
	if (!keyPath) return command;
	const quotedKeyPath = shellQuote(keyPath);
	return `trap 'rm -f -- ${quotedKeyPath}' EXIT\n${command}`;
}

export function buildRsyncCommand(input: RsyncCommandInput): string {
	const transport = buildSshTransport(input);
	const target = `${buildRsyncTargetAddress(input.targetUser, input.targetHost)}:${input.targetPath.replace(/\/$/, "")}/`;
	const command = `rsync ${input.flags.join(" ")} -e ${shellDoubleQuote(transport)} ${shellQuote(`${input.sourcePath.replace(/\/$/, "")}/`)} ${shellQuote(target)} 2>&1`;
	return withKeyCleanup(command, input.keyPath);
}

export function buildTarSyncCommand(input: TarSyncCommandInput): string {
	const transport = buildSshTransport(input);
	const targetAddress = buildSshTargetAddress(input.targetUser, input.targetHost);
	const prepareTarget = input.deleteOrphans
		? `mkdir -p -- ${shellQuote(input.targetPath)} && cd -- ${shellQuote(input.targetPath)} && find . -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar xf - -C ${shellQuote(input.targetPath)}`
		: `mkdir -p -- ${shellQuote(input.targetPath)} && tar xf - -C ${shellQuote(input.targetPath)}`;
	const command = `tar cf - -C ${shellQuote(input.sourcePath)} . | ${transport} ${shellQuote(targetAddress)} ${shellQuote(prepareTarget)} 2>&1`;
	return withKeyCleanup(command, input.keyPath);
}
