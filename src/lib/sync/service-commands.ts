/**
 * Sync service — pure command construction (R28 god-file split).
 *
 * Builds the rsync / tar over SSH command strings that run on the SOURCE host,
 * in either login mode (`./target-auth`): "credential", the original way, where
 * the source uses the target's own key or password and names the target path
 * itself; or "one-time-key", where the source uses a key made for the run and
 * the gate script that key is pinned to on the TARGET host decides where data
 * goes (see `./one-time-key`). No I/O, no prisma — the runtime lives in
 * `./service-runtime`.
 * Re-exports `shellQuote` for callers that need a stable import path.
 */
import { isIP } from "node:net";

import { ValidationError } from "@/lib/errors";
import { isValidTcpPort } from "@/lib/runtime/listen-port";
import { shellQuote } from "@/lib/shell-quote";
import { t } from "@/lib/i18n/service-translations";

export { shellQuote };

/* ── Types ────────────────────────────────────────────────── */

type SyncTransportBase = {
	targetUser: string;
	targetHost: string;
	targetPort: number;
	hostKeySha256?: string | null; // OPEN-2: SSH host key pin for rsync/tar sync
	jobId?: string; // For generating temp known_hosts path
};

/** The run's one-time key (`./one-time-key`); the target's own credential stays on the hub. */
type OneTimeKeyTransport = SyncTransportBase & {
	auth: "one-time-key";
	keyPath?: string;
};

/** The original way: the target's own credential, written to the source for the run. */
type CredentialTransport = SyncTransportBase & {
	auth: "credential";
	/** The target's own private key, written to the source host. */
	keyPath?: string;
	/**
	 * A 0600 file on the source host holding `SSHPASS='…'` (written by the
	 * runtime, A4-08). The script sources it instead of carrying the password
	 * in its own text, which `ps` showed to every local user for the whole run.
	 */
	passwordEnvPath?: string;
};

type SyncTransportInput = OneTimeKeyTransport | CredentialTransport;

type RsyncCommandInput = { sourcePath: string; flags: string[] } & (
	| OneTimeKeyTransport
	| (CredentialTransport & { targetPath: string })
);

type TarSyncCommandInput = { sourcePath: string } & (
	| OneTimeKeyTransport
	| (CredentialTransport & { targetPath: string; deleteOrphans: boolean })
);

/* ── Patterns ─────────────────────────────────────────────── */

const SSH_USERNAME_PATTERN = /^[A-Za-z0-9._-]+$/;
const HOSTNAME_PATTERN = /^[A-Za-z0-9._:-]+$/;
const RSYNC_HOST_PATTERN = /^[A-Za-z0-9.:[\]@_-]+$/;

/* ── Sanitisation helpers ─────────────────────────────────── */

function assertSafeSshUsername(username: string): void {
	if (!SSH_USERNAME_PATTERN.test(username) || username.startsWith("-")) {
		throw new ValidationError(t("backend.sync.unsafeSshUsername"));
	}
}

function assertSafeHost(host: string): void {
	if (!HOSTNAME_PATTERN.test(host) || host.startsWith("-")) {
		throw new ValidationError(t("backend.sync.unsafeSshHost"));
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
		throw new ValidationError(t("backend.sync.unsafeRsyncTargetAddress"));
	}
	return address;
}

function buildSshTargetAddress(targetUser: string, targetHost: string): string {
	assertSafeSshUsername(targetUser);
	return `${targetUser}@${formatSshHost(targetHost)}`;
}

function assertSafeSshPort(targetPort: number): void {
	if (!isValidTcpPort(targetPort)) {
		throw new ValidationError(t("backend.sync.unsafeSshPort"));
	}
}

/**
 * Sink for unpinned `UserKnownHostsFile=` in the sync transport. This
 * literal is deliberate: unlike the hub-local NULL_DEVICE (platform-paths),
 * these ssh argv run on the REMOTE source host — always POSIX, always
 * /dev/null. Do not "unify" it with the local null device.
 */
const REMOTE_NULL_DEVICE = "/dev/null";

function buildSshOptions(targetPort: number, hostKeySha256: string | null | undefined, knownHostsPath: string | undefined, quote: TransportQuote, batchMode: boolean): string {
	assertSafeSshPort(targetPort);
	const pinned = Boolean(hostKeySha256?.trim());
	if (pinned && !knownHostsPath) throw new ValidationError(t("backend.sync.pinnedSshSyncRequiresAKnownHostsPath"));
	return [
		`-o StrictHostKeyChecking=${pinned ? "yes" : "accept-new"}`,
		`-o UserKnownHostsFile=${quote(pinned ? knownHostsPath! : REMOTE_NULL_DEVICE)}`,
		// Nobody can answer a prompt on the source host. (Not in credential mode:
		// sshpass answers the password prompt, which BatchMode would suppress.)
		...(batchMode ? ["-o BatchMode=yes"] : []),
		`-p ${targetPort}`,
	].join(" ");
}

/* ── Temp-key path ────────────────────────────────────────── */

export function safeFileStem(value: string): string {
	return value.replace(/[^A-Za-z0-9_-]/g, "_");
}

export function getSyncTempKeyPath(jobId: string, purpose: "rsync" | "tar" | "known_hosts" | "env"): string {
	return `/tmp/app-sync-${purpose}-${safeFileStem(jobId)}`;
}

/* ── Command builders ─────────────────────────────────────── */

function shellDoubleQuote(value: string): string {
	return `"${value.replace(/(["\\$`])/g, "\\$1")}"`;
}

/**
 * How the consumer of a transport string treats quotes.
 *
 * rsync's `--rsh` value is not parsed by a shell: rsync splits it on
 * whitespace and execs the tokens directly, so shell quoting survives into
 * ssh's argv — `-i '/tmp/k'` makes ssh report "Identity file '/tmp/k' not
 * accessible" and silently fall through to another auth method. The tar
 * fallback pipes the same transport into a remote shell, where the quotes are
 * consumed as intended. Each builder therefore picks its own quoting.
 */
type TransportQuote = (value: string) => string;

/**
 * Every path we place inside an rsync transport is generated by
 * {@link getSyncTempKeyPath} (stem filtered to `[A-Za-z0-9_-]`) or is the
 * literal `/dev/null`, so none of them can contain anything that would need
 * quoting. Assert that invariant rather than quoting a value rsync would hand
 * to ssh with the quotes attached.
 */
function assertUnquotedTransportPath(value: string): string {
	if (!/^[A-Za-z0-9._/-]+$/.test(value)) {
		throw new ValidationError(t("backend.sync.unsafeSshTransportPath"));
	}
	return value;
}

/**
 * The ssh command that carries the transfer from the source host, plus any
 * environment assignment that must be applied to the *outer* command instead
 * of the transport itself.
 */
function buildSshTransport(
	input: SyncTransportInput,
	quote: TransportQuote,
): { transport: string; envSetup: string } {
	const knownHostsPath = input.hostKeySha256?.trim()
		? getSyncTempKeyPath(input.jobId ?? "sync", "known_hosts")
		: undefined;
	const oneTimeKey = input.auth === "one-time-key";
	const sshCommand = ["ssh", buildSshOptions(input.targetPort, input.hostKeySha256, knownHostsPath, quote, oneTimeKey)];
	if (oneTimeKey) {
		// Offer only the one-time key. Otherwise ssh also tries the source user's
		// own keys and agent, and one the target accepts without the gate would
		// carry the transfer past it.
		if (input.keyPath) sshCommand.push("-o IdentitiesOnly=yes", "-i", quote(input.keyPath));
		return { transport: sshCommand.join(" "), envSetup: "" };
	}
	if (input.keyPath) sshCommand.push("-i", quote(input.keyPath));
	const base = sshCommand.join(" ");
	if (input.passwordEnvPath) {
		// SSHPASS keeps the password out of /proc/cmdline. It has to ride on the
		// outer command: rsync would exec a program literally named `SSHPASS=…`
		// ("Failed to exec"), so only the caller's shell can honour it. The value
		// comes from the env file, never from this script's text.
		return { transport: `sshpass -e ${base}`, envSetup: `. ${shellQuote(input.passwordEnvPath)} && export SSHPASS` };
	}
	return { transport: base, envSetup: "" };
}

function withCredentialCleanup(command: string, input: SyncTransportInput): string {
	const paths = [
		input.keyPath,
		input.auth === "credential" ? input.passwordEnvPath : undefined,
		input.hostKeySha256?.trim() ? getSyncTempKeyPath(input.jobId ?? "sync", "known_hosts") : undefined,
	].filter((value): value is string => Boolean(value));
	if (paths.length === 0) return command;
	return `trap 'rm -f -- ${paths.map(shellQuote).join(" ")}' EXIT\n${command}`;
}

/**
 * One-time key mode: the remote side is the gate ({@link buildSyncGateScript}):
 * it runs `rsync --server` into the directory the hub fixed when it installed
 * the key and ignores whatever path the source names, so only a placeholder is
 * sent. Without `-s` the remote command line is the only place rsync puts its
 * options, which is where the gate checks them (with `-s` they would arrive
 * through the data stream instead, so the gate refuses it); unsetting
 * RSYNC_PROTECT_ARGS keeps the source host's environment from turning it on.
 *
 * Credential mode (the original): the source names the target path. `-s`
 * (--protect-args) sends it through rsync's own protocol stream instead of the
 * target host's login shell. Without it an rsync older than 3.2.4 on the source
 * host hands `user@host:/path` to the remote shell unescaped, so a job's
 * targetPath could carry `;`/`$()` and run commands on the target as the sync
 * user. shellQuote only protects the source shell.
 */
export function buildRsyncCommand(input: RsyncCommandInput): string {
	const { transport, envSetup } = buildSshTransport(input, assertUnquotedTransportPath);
	const address = buildRsyncTargetAddress(input.targetUser, input.targetHost);
	// `--` ends the options, and a relative source gets "./": otherwise a path that begins with "-" is an option and one
	// holding "host:" is another machine (jobs stored before the path check existed could still carry such a value).
	const source = input.sourcePath.replace(/\/$/, "");
	const sourceArg = shellQuote(`${source.startsWith("/") ? source : `./${source}`}/`);
	const command = input.auth === "one-time-key"
		? `unset RSYNC_PROTECT_ARGS; rsync ${input.flags.join(" ")} -e ${shellDoubleQuote(transport)} -- ${sourceArg} ${shellQuote(`${address}:.`)} 2>&1`
		: `${envSetup ? `${envSetup} && ` : ""}rsync ${input.flags.join(" ")} -s -e ${shellDoubleQuote(transport)} -- ${sourceArg} ${shellQuote(`${address}:${input.targetPath.replace(/\/$/, "")}/`)} 2>&1`;
	return withCredentialCleanup(command, input);
}

const TAR_STAGE_PREFIX = ".vch-sync-stage-";
const TAR_PREV_PREFIX = ".vch-sync-prev-";

/**
 * Mirror commit, run on the target inside the target directory. The current
 * entries are moved aside into PREV (not deleted), the staged entries moved in,
 * and only then is PREV removed. A failing move puts the old entries back. If
 * the commit is killed outright (dropped SSH session), PREV survives with the
 * old data and the next run refuses to commit until an operator has looked at
 * it. Other jobs' stage/prev directories are never touched. `find -exec … {} +`
 * through `sh -c` is used because `-exec … \;` swallows a failed mv.
 */
function buildMirrorCommitScript(target: string, stage: string, prev: string): string {
	const moveInto = (destination: string) => `-exec sh -c 'mv -f -- "$@" "$0"' ${destination} {} +`;
	const ownEntries = `find . -mindepth 1 -maxdepth 1 ! -name '${TAR_STAGE_PREFIX}*' ! -name '${TAR_PREV_PREFIX}*'`;
	return [
		`cd -- ${target} || exit 1`,
		`if [ -e ${prev} ]; then echo "an earlier tar sync commit into this target was interrupted; the entries it replaced are kept in "${prev}". Restore or remove that directory, then retry." >&2; exit 1; fi`,
		`mkdir -- ${prev} || exit 1`,
		`vch_restore_prev() { find ${prev} -mindepth 1 -maxdepth 1 ${moveInto(".")} && rmdir -- ${prev}; }`,
		`if ! ${ownEntries} ${moveInto(prev)}; then vch_restore_prev; echo "tar sync commit failed while setting the current entries aside; target restored" >&2; exit 1; fi`,
		`if ! find ${stage} -mindepth 1 -maxdepth 1 ${moveInto(".")}; then ${ownEntries} -exec rm -rf -- {} +; vch_restore_prev; rm -rf -- ${stage}; echo "tar sync commit failed while moving the new entries in; target restored" >&2; exit 1; fi`,
		`rmdir -- ${stage} && rm -rf -- ${prev}`,
	].join("\n");
}

/**
 * The target half of the tar fallback, in three checked phases so a failure
 * can never be reported as success or leave the target half-replaced:
 *
 *   1. `receive`: extract the source's `tar cf` stream into a staging
 *      directory inside the target;
 *   2. `commit`, only when BOTH the source tar and the receiving tar exited 0:
 *      mirror mode replaces the target's entries, merge mode overlays them;
 *   3. `abort` otherwise: drop the stage, target untouched.
 *
 * The stage lives inside the target so the commit is a same-filesystem move.
 * It costs up to one extra copy of the data on the target until committed.
 * Merge mode overlays with `cp -a`; an interrupted overlay can leave the file
 * being copied incomplete (as the former direct extraction could), but never
 * removes anything. In one-time key mode these scripts are fixed by the hub
 * inside the gate and the source only names the phase; in credential mode the
 * source sends them as the remote command.
 */
function buildTarTargetScripts(input: { targetPath: string; deleteOrphans: boolean; jobId?: string }) {
	const target = shellQuote(input.targetPath);
	const stem = safeFileStem(input.jobId ?? "sync");
	const stageName = `${TAR_STAGE_PREFIX}${stem}`;
	const prevName = `${TAR_PREV_PREFIX}${stem}`;
	const stage = shellQuote(`${input.targetPath.replace(/\/+$/, "")}/${stageName}`);
	return {
		receive: `rm -rf -- ${stage} && mkdir -p -- ${stage} && tar xf - -C ${stage}`,
		commit: input.deleteOrphans
			? buildMirrorCommitScript(target, shellQuote(stageName), shellQuote(prevName))
			: `cp -a -- ${stage}/. ${target}/ && rm -rf -- ${stage}`,
		abort: `rm -rf -- ${stage}`,
	};
}

/** What the source sends; the gate maps each to a fixed script or check. */
export const SYNC_GATE_HELLO = "vch-sync hello";
const SYNC_GATE_TAR_RECEIVE = "vch-sync tar-receive";
const SYNC_GATE_TAR_COMMIT = "vch-sync tar-commit";
const SYNC_GATE_TAR_ABORT = "vch-sync tar-abort";

/**
 * tar fallback, source side. The source tar's status is carried out of the
 * pipeline through a temp file (a pipeline reports only its last command);
 * see {@link buildTarTargetScripts} for what each phase does on the target.
 */
export function buildTarSyncCommand(input: TarSyncCommandInput): string {
	const { transport, envSetup } = buildSshTransport(input, shellQuote);
	const address = shellQuote(buildSshTargetAddress(input.targetUser, input.targetHost));
	const scripts = input.auth === "credential"
		? buildTarTargetScripts({ targetPath: input.targetPath, deleteOrphans: input.deleteOrphans, jobId: input.jobId })
		: null;
	// One-time key: name the phase, the gate runs its own copy. Credential: send the script.
	const remote = (phase: string, script: string | undefined) => `${transport} ${address} ${shellQuote(script ?? phase)}`;
	const command = [
		// The password must reach every ssh below, so export it once instead of
		// prefixing one command.
		...(envSetup ? [envSetup] : []),
		`vch_tar_status=$(mktemp "\${TMPDIR:-/tmp}/vch-sync-tar.XXXXXX") || exit 1`,
		`{ tar cf - -C ${shellQuote(input.sourcePath)} .; echo "$?" > "$vch_tar_status"; } | ${remote(SYNC_GATE_TAR_RECEIVE, scripts?.receive)} 2>&1`,
		`vch_receive_status=$?`,
		`vch_source_status=$(cat "$vch_tar_status" 2>/dev/null); rm -f -- "$vch_tar_status"`,
		`if [ "$vch_source_status" != 0 ] || [ "$vch_receive_status" -ne 0 ]; then`,
		`  echo "tar sync aborted: source tar exit \${vch_source_status:-unknown}, target receive exit $vch_receive_status; target left unchanged" >&2`,
		`  ${remote(SYNC_GATE_TAR_ABORT, scripts?.abort)} >/dev/null 2>&1`,
		`  exit 1`,
		`fi`,
		`${remote(SYNC_GATE_TAR_COMMIT, scripts?.commit)} 2>&1`,
	].join("\n");
	return withCredentialCleanup(command, input);
}

/**
 * Run from the source with the one-time key before the transfer: proves the
 * target accepts the key and runs the gate, and reports the address the
 * target sees the source connect from (pinned with `from=` afterwards).
 */
export function buildSyncPeerProbeCommand(input: OneTimeKeyTransport): string {
	const { transport } = buildSshTransport(input, shellQuote);
	return `${transport} -o ConnectTimeout=20 ${shellQuote(buildSshTargetAddress(input.targetUser, input.targetHost))} ${shellQuote(SYNC_GATE_HELLO)} 2>&1`;
}

/**
 * `undefined`: the gate did not answer (the key was refused, or something
 * other than the gate ran). `null`: it answered without a usable address.
 */
export function parseSyncPeerProbe(output: string): string | null | undefined {
	const match = /^VCH_SYNC_PEER=(\S*)\s*$/m.exec(output);
	if (!match) return undefined;
	return isIP(match[1]!) ? match[1]! : null;
}

/* ── Gate on the target ───────────────────────────────────── */

export type SyncGateInput = {
	/** rsync receiver, or the tar fallback's receive/commit/abort phases. */
	mode: "rsync" | "tar";
	/** The only directory the key may write into. */
	targetPath: string;
	/** MIRROR / delete-orphans: whether rsync may be asked to delete on the target. */
	allowDelete: boolean;
	/** Names the tar fallback's stage/prev directories. */
	jobId?: string;
};

/**
 * The letters `rsync --server` may get in its short-option cluster: exactly
 * what rsyncFlagsForJob can produce (-a → rlptgoD, -v, -u for bidirectional,
 * -z for compression). Everything after an `e` in the cluster is rsync's
 * capability string, not options. Notably absent: `s` (protect-args, which
 * would bring further options through the data stream) and `K` (follow
 * symlinked directories on the receiver).
 */
const GATE_RSYNC_SHORT_FLAGS = "vrlptgoDuz";

/**
 * The forced command of a run's one-time key on the target (`./one-time-key`
 * embeds it in the authorized_keys line). It allows:
 *
 *   - `vch-sync hello`: prints the address the connection came from;
 *   - rsync mode: `rsync --server` as a receiver only (no `--sender`), with
 *     each option checked against the set the job's flags produce, `--delete*`
 *     only for a deleting job, and the destination replaced by the job's target
 *     directory whatever the source sent;
 *   - tar mode: the three fixed phases of {@link buildTarTargetScripts}.
 *
 * Anything else, an interactive login included, exits 126. The command line
 * the source sent is split into words but never evaluated.
 */
export function buildSyncGateScript(input: SyncGateInput): string {
	const lines = [
		"# VControlHub one-time sync key: the only commands this key may run here.",
		"set -f",
		`vch_refuse() { printf 'vch-sync gate: refused %s\\n' "$1" >&2; exit 126; }`,
	];
	const cases = [`  ${shellQuote(SYNC_GATE_HELLO)}) printf 'VCH_SYNC_PEER=%s\\n' "\${SSH_CLIENT%% *}"; exit 0 ;;`];
	if (input.mode === "tar") {
		const scripts = buildTarTargetScripts({ targetPath: input.targetPath, deleteOrphans: input.allowDelete, jobId: input.jobId });
		for (const [name, phase, body] of [
			["vch_tar_receive", SYNC_GATE_TAR_RECEIVE, scripts.receive],
			["vch_tar_commit", SYNC_GATE_TAR_COMMIT, scripts.commit],
			["vch_tar_abort", SYNC_GATE_TAR_ABORT, scripts.abort],
		] as const) {
			lines.push(`${name}() {`, body, "}");
			cases.push(`  ${shellQuote(phase)}) ${name}; exit ;;`);
		}
	} else {
		cases.push("  'rsync --server '*) ;;");
	}
	lines.push(
		"case ${SSH_ORIGINAL_COMMAND-} in",
		...cases,
		`  *) vch_refuse "\${SSH_ORIGINAL_COMMAND:-an interactive login}" ;;`,
		"esac",
	);
	if (input.mode === "rsync") lines.push(...buildRsyncReceiverGate(input));
	return `${lines.join("\n")}\n`;
}

function buildRsyncReceiverGate(input: SyncGateInput): string[] {
	const target = input.targetPath.replace(/\/+$/, "");
	return [
		"set -- $SSH_ORIGINAL_COMMAND",
		"shift 2",
		"vch_opts=",
		"vch_dot=",
		`for vch_arg in "$@"; do`,
		"  case $vch_arg in",
		"    .) vch_dot=1; break ;;",
		`    --timeout=*) case \${vch_arg#--timeout=} in ''|*[!0-9]*) vch_refuse "$vch_arg" ;; esac ;;`,
		"    --stats|--partial) ;;",
		`    --delete|--delete-before|--delete-during|--delete-delay|--delete-after) ${input.allowDelete ? ";;" : `vch_refuse "$vch_arg" ;;`}`,
		`    --*) vch_refuse "$vch_arg" ;;`,
		"    -*)",
		"      vch_flags=${vch_arg%%e*}",
		`      vch_caps=\${vch_arg#"$vch_flags"}`,
		`      case \${vch_flags#-} in ''|*[!${GATE_RSYNC_SHORT_FLAGS}]*) vch_refuse "$vch_arg" ;; esac`,
		`      case \${vch_caps#e} in *[!A-Za-z0-9.]*) vch_refuse "$vch_arg" ;; esac ;;`,
		`    *) vch_refuse "$vch_arg" ;;`,
		"  esac",
		`  vch_opts="$vch_opts $vch_arg"`,
		"done",
		`[ -n "$vch_dot" ] || vch_refuse 'an rsync command without its "." argument'`,
		`exec rsync --server $vch_opts . ${shellQuote(`${target}/`)}`,
	];
}

export type SyncSourceState = "ready" | "empty" | "missing" | "unreadable";

const SOURCE_PROBE_MARKER = "VCH_SYNC_SOURCE=";

/**
 * Inspect the source directory without creating it. A missing source must not
 * be "fixed" with mkdir -p: an empty source mirrored with orphan deletion
 * empties the target.
 */
export function buildSyncSourceProbeCommand(sourcePath: string): string {
	const source = shellQuote(sourcePath);
	return [
		`if [ ! -d ${source} ]; then echo '${SOURCE_PROBE_MARKER}missing'`,
		`elif [ ! -r ${source} ] || [ ! -x ${source} ]; then echo '${SOURCE_PROBE_MARKER}unreadable'`,
		`elif [ -z "$(ls -A ${source} 2>/dev/null | head -n 1)" ]; then echo '${SOURCE_PROBE_MARKER}empty'`,
		`else echo '${SOURCE_PROBE_MARKER}ready'; fi`,
	].join("; ");
}

export function parseSyncSourceProbe(output: string): SyncSourceState | null {
	const match = output.match(/VCH_SYNC_SOURCE=(ready|empty|missing|unreadable)/);
	return match ? (match[1] as SyncSourceState) : null;
}

/** Create the target and report whether it already holds entries. */
export function buildSyncTargetPrepareCommand(targetPath: string): string {
	const target = shellQuote(targetPath);
	return `mkdir -p -- ${target} && if [ -z "$(ls -A ${target} 2>/dev/null | head -n 1)" ]; then echo VCH_SYNC_TARGET=empty; else echo VCH_SYNC_TARGET=nonempty; fi`;
}
