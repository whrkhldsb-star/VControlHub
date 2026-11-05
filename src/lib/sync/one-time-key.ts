/**
 * One-time SSH access from a sync run's source host to its target host.
 *
 * The source host runs the ssh client that carries the transfer, so it needs
 * a credential for the target. It used to be handed the target's own private
 * key or password, written to its /tmp for the whole run (up to 12 h), where
 * root on the source could copy it and log in to the target later.
 *
 * Each run (each leg of a bidirectional job) now gets a fresh ed25519 pair
 * generated on the hub. The hub, over its own SSH connection, appends the
 * public half to the target user's authorized_keys, pinned to the gate script
 * (`buildSyncGateScript`: only `rsync --server` into the job's directory, or
 * the tar fallback's fixed phases) with `restrict`, an expiry time and, once
 * the source has connected once, `from=` the address it connects from. Only
 * the private half goes to the source, and the line is removed when the run
 * ends whatever the outcome. A line left by a run that died is removed by the
 * stale-RUNNING reclaim and by the next install on that host, and stops
 * working at its expiry time in any case.
 *
 * Pure: key generation and shell builders, no I/O.
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { isIP } from "node:net";

import { safeFileStem, shellQuote } from "./service-commands";

/** Comment of every one-time key line: `vch-sync-ephemeral:<job>:<run>:<expires epoch s>`. */
export const ONE_TIME_KEY_MARKER = "vch-sync-ephemeral";

export function oneTimeKeyMarker(input: { jobId: string; run: string; expiresAt: Date }): string {
	return `${ONE_TIME_KEY_MARKER}:${safeFileStem(input.jobId)}:${safeFileStem(input.run)}:${Math.floor(input.expiresAt.getTime() / 1000)}`;
}

/* ── Key pair ─────────────────────────────────────────────── */

function sshUint32(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32BE(value >>> 0);
	return buffer;
}

function sshString(value: Buffer | string): Buffer {
	const bytes = typeof value === "string" ? Buffer.from(value, "utf8") : value;
	return Buffer.concat([sshUint32(bytes.length), bytes]);
}

/**
 * A fresh ed25519 pair: the private half in OpenSSH's own unencrypted format
 * (what `ssh -i` on the source reads), the public half as an authorized_keys
 * key (`ssh-ed25519 <base64> <comment>`). Built from node:crypto rather than
 * ssh2's generator, which drops a leading zero byte of about one key in 256.
 */
export function generateOneTimeKeyPair(comment: string): { privateKey: string; publicKey: string } {
	if (!/^[\x21-\x7e]+$/.test(comment)) throw new Error("one-time key comment must be printable without spaces");
	const pair = generateKeyPairSync("ed25519");
	const publicRaw = Buffer.from(pair.publicKey.export({ format: "jwk" }).x!, "base64url");
	const seed = Buffer.from(pair.privateKey.export({ format: "jwk" }).d!, "base64url");
	if (publicRaw.length !== 32 || seed.length !== 32) throw new Error("unexpected ed25519 key size");
	const keyType = "ssh-ed25519";
	const publicBlob = Buffer.concat([sshString(keyType), sshString(publicRaw)]);
	const check = randomBytes(4).readUInt32BE(0);
	const privateSection = Buffer.concat([
		sshUint32(check),
		sshUint32(check),
		sshString(keyType),
		sshString(publicRaw),
		sshString(Buffer.concat([seed, publicRaw])),
		sshString(comment),
	]);
	// Padded with 1, 2, 3, … to the cipher block size (8 for "none").
	const padding = Buffer.from(Array.from({ length: (8 - (privateSection.length % 8)) % 8 }, (_, index) => index + 1));
	const body = Buffer.concat([
		Buffer.from("openssh-key-v1\0", "latin1"),
		sshString("none"),
		sshString("none"),
		sshString(Buffer.alloc(0)),
		sshUint32(1),
		sshString(publicBlob),
		sshString(Buffer.concat([privateSection, padding])),
	]);
	const wrapped = body.toString("base64").match(/.{1,70}/g)!.join("\n");
	return {
		privateKey: `-----BEGIN OPENSSH PRIVATE KEY-----\n${wrapped}\n-----END OPENSSH PRIVATE KEY-----\n`,
		publicKey: `${keyType} ${publicBlob.toString("base64")} ${comment}`,
	};
}

/* ── authorized_keys line ─────────────────────────────────── */

/**
 * `command="…"` for the gate. authorized_keys holds one line per key and
 * escapes nothing but `\"`, so the gate travels base64-encoded and is decoded
 * by the login shell: `exec /bin/sh -c "<gate>" vch-sync-gate`.
 */
export function buildAuthorizedKeysGateOption(gateScript: string): string {
	const encoded = Buffer.from(gateScript, "utf8").toString("base64");
	return `command="exec /bin/sh -c \\"$(printf %s ${encoded} | base64 -d)\\" vch-sync-gate"`;
}

/**
 * Shared by install and revoke, on the target as the sync user. The file is
 * rewritten through a temp file and a rename, so a full disk can never leave a
 * truncated authorized_keys (and lock out the hub's own key); a symlinked
 * authorized_keys is followed. `flock`, when present, keeps two runs on the
 * same host from losing each other's line.
 *
 * vch_filter JOB RUN drops one-time key lines that have expired, and those of
 * job JOB (of run RUN only, when given). Nothing else is touched.
 */
function authorizedKeysPrelude(create: boolean): string[] {
	return [
		`vch_dir="$HOME/.ssh"`,
		`vch_ak="$vch_dir/authorized_keys"`,
		create ? `[ -d "$vch_dir" ] || mkdir -m 700 -- "$vch_dir"` : `[ -d "$vch_dir" ] || { echo VCH_SYNC_KEY_REVOKED; exit 0; }`,
		`if [ -L "$vch_ak" ]; then vch_ak=$(readlink -f -- "$vch_ak"); fi`,
		`if command -v flock >/dev/null 2>&1; then exec 9>>"$vch_dir/.vch-sync.lock"; flock -w 30 9; fi`,
		"vch_filter() {",
		`  [ -f "$vch_ak" ] || return 0`,
		`  vch_tmp=$(mktemp "$vch_ak.vch-XXXXXX")`,
		`  if ! awk -v now="$(date +%s)" -v job="$1" -v run="$2" '`,
		`    { n = split($NF, p, ":") }`,
		`    n == 4 && p[1] == "${ONE_TIME_KEY_MARKER}" && (p[4] + 0 < now + 0 || (p[2] == job && (run == "" || p[3] == run))) { next }`,
		`    { print }' "$vch_ak" > "$vch_tmp"; then rm -f -- "$vch_tmp"; return 1; fi`,
		`  if cmp -s -- "$vch_ak" "$vch_tmp"; then rm -f -- "$vch_tmp"; return 0; fi`,
		`  chmod 600 -- "$vch_tmp" && mv -f -- "$vch_tmp" "$vch_ak"`,
		"}",
	];
}

export type OneTimeKeyInstallInput = {
	/** The user the source logs in as; the hub's own session must be that user. */
	user: string;
	publicKey: string;
	commandOption: string;
	jobId: string;
	expiresAt: Date;
	/** Pin the source's address once it is known (after the first connection). */
	from?: string | null;
};

/**
 * Adds the key line, replacing any earlier line of the same job (a job runs
 * once at a time, so such a line is either a crashed run's or the unpinned
 * line this run is re-adding with `from=`). Options by the sshd version that
 * `ssh -V` reports: `restrict` from 7.2, `expiry-time` from 7.7 (in the
 * server's own time zone, hence computed there); otherwise the older `no-*`
 * list, which every version understands. An option an sshd does not know
 * makes it ignore the line, which the source's first connection then reports.
 */
export function buildOneTimeKeyInstallCommand(input: OneTimeKeyInstallInput): string {
	if (!/^ssh-ed25519 [A-Za-z0-9+/=]+ \S+$/.test(input.publicKey)) throw new Error("not a one-time public key line");
	if (input.from && !isIP(input.from)) throw new Error(`not an IP address: ${input.from}`);
	const epoch = Math.floor(input.expiresAt.getTime() / 1000);
	const user = shellQuote(input.user);
	return [
		"set -eu",
		"umask 077",
		`if [ "$(id -un)" != ${user} ]; then echo "the hub runs commands on this server as $(id -un), but the sync logs in as "${user} >&2; exit 3; fi`,
		...authorizedKeysPrelude(true),
		`vch_filter ${shellQuote(safeFileStem(input.jobId))} ''`,
		`vch_ver=$(ssh -V 2>&1 | sed -n 's/^OpenSSH_\\([0-9][0-9]*\\)\\.\\([0-9][0-9]*\\).*/\\1 \\2/p' | head -n 1)`,
		`vch_opts='no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty'`,
		`if [ -n "$vch_ver" ]; then`,
		`  vch_major=\${vch_ver% *}; vch_minor=\${vch_ver#* }`,
		`  if [ "$vch_major" -gt 7 ] || { [ "$vch_major" -eq 7 ] && [ "$vch_minor" -ge 2 ]; }; then vch_opts=restrict; fi`,
		`  if [ "$vch_major" -gt 7 ] || { [ "$vch_major" -eq 7 ] && [ "$vch_minor" -ge 7 ]; }; then`,
		`    vch_exp=$( (unset TZ; date -d @${epoch} +%Y%m%d%H%M) 2>/dev/null || (unset TZ; date -r ${epoch} +%Y%m%d%H%M) 2>/dev/null || true)`,
		`    if [ -n "$vch_exp" ]; then vch_opts="$vch_opts,expiry-time=\\"$vch_exp\\""; fi`,
		"  fi",
		"fi",
		...(input.from ? [`vch_opts="$vch_opts,from=\\"${input.from}\\""`] : []),
		`vch_opts="$vch_opts,"${shellQuote(input.commandOption)}`,
		// A last line without its newline would swallow ours, and removing ours would then take it along.
		`if [ -s "$vch_ak" ] && [ -n "$(tail -c 1 -- "$vch_ak")" ]; then printf '\\n' >> "$vch_ak"; fi`,
		`printf '%s %s\\n' "$vch_opts" ${shellQuote(input.publicKey)} >> "$vch_ak"`,
		"echo VCH_SYNC_KEY_INSTALLED",
	].join("\n");
}

/**
 * Removes one-time key lines: those of `run` of `jobId`, all of `jobId`'s when
 * no run is given, and expired ones of any job in every case.
 */
export function buildOneTimeKeyRevokeCommand(input: { jobId: string; run?: string }): string {
	return [
		"set -eu",
		"umask 077",
		...authorizedKeysPrelude(false),
		`vch_filter ${shellQuote(safeFileStem(input.jobId))} ${shellQuote(input.run ? safeFileStem(input.run) : "")}`,
		"echo VCH_SYNC_KEY_REVOKED",
	].join("\n");
}
