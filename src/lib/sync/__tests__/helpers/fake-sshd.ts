import { chmodSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Writes an `ssh` into `bin` that stands in for both ends of a sync
 * connection, the way OpenSSH treats the run's one-time key:
 *
 *   - the client side reads `-i <key>` (OpenSSH format) and joins everything
 *     after the destination into the remote command, as ssh does;
 *   - the server side looks that key up in `$HOME/.ssh/authorized_keys`,
 *     refuses it when absent, when `from=` does not match the client address
 *     (VCH_TEST_CLIENT_IP, default 198.51.100.7) or after `expiry-time`, and
 *     otherwise runs the line's forced command through /bin/sh with
 *     SSH_ORIGINAL_COMMAND and SSH_CLIENT set, stdin/stdout passed through.
 *
 * `ssh -V` reports VCH_TEST_SSH_VERSION (default OpenSSH_9.6p1).
 * VCH_TEST_SSHD_REFUSE_KEYS=1 makes the server refuse every key (a target that
 * does not allow public-key login). Each connection is appended as JSON to
 * VCH_TEST_SSH_LOG when set: { command, options } or { command, denied }.
 */
export function installFakeSsh(bin: string): void {
	const path = join(bin, "ssh");
	writeFileSync(path, `#!${process.execPath}\n${FAKE_SSH_SOURCE}`);
	chmodSync(path, 0o755);
}

const FAKE_SSH_SOURCE = String.raw`"use strict";
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const args = process.argv.slice(2);
if (args.includes("-V")) {
	process.stderr.write((process.env.VCH_TEST_SSH_VERSION ?? "OpenSSH_9.6p1") + " fake\n");
	process.exit(0);
}
const withValue = new Set(["-o", "-p", "-i", "-l", "-F", "-E", "-b", "-c", "-D", "-e", "-I", "-J", "-L", "-m", "-O", "-Q", "-R", "-S", "-W", "-w", "-B"]);
let identity = null;
const rest = [];
for (let i = 0; i < args.length; i++) {
	const arg = args[i];
	if (rest.length === 0 && arg.startsWith("-")) {
		if (withValue.has(arg)) {
			const value = args[++i];
			if (arg === "-i") identity = value;
		}
		continue;
	}
	rest.push(arg);
}
const command = rest.slice(1).join(" ");
const log = (entry) => {
	if (process.env.VCH_TEST_SSH_LOG) fs.appendFileSync(process.env.VCH_TEST_SSH_LOG, JSON.stringify(entry) + "\n");
};
const deny = (reason) => {
	log({ command, denied: reason });
	process.stderr.write("Permission denied (publickey).\n");
	process.exit(255);
};
if (process.env.VCH_TEST_SSHD_REFUSE_KEYS) deny("public-key login disabled");
if (!identity) deny("no identity");

let blob;
try {
	const body = Buffer.from(fs.readFileSync(identity, "utf8").replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""), "base64");
	let offset = "openssh-key-v1\0".length;
	const next = () => {
		const length = body.readUInt32BE(offset);
		const value = body.subarray(offset + 4, offset + 4 + length);
		offset += 4 + length;
		return value;
	};
	next(); next(); next(); offset += 4; // cipher, kdf, kdf options, key count
	blob = next().toString("base64");
} catch (error) {
	deny("unreadable identity: " + error.message);
}

const authorizedKeys = path.join(process.env.HOME, ".ssh", "authorized_keys");
const lines = fs.existsSync(authorizedKeys) ? fs.readFileSync(authorizedKeys, "utf8").split("\n") : [];
const keyText = "ssh-ed25519 " + blob + " ";
const line = lines.find((candidate) => candidate.startsWith(keyText) || candidate.includes(" " + keyText));
if (!line) deny("key not in authorized_keys");

const optionText = line.startsWith(keyText) ? "" : line.slice(0, line.indexOf(" " + keyText));
const options = {};
const addOption = (text) => {
	if (!text) return;
	const eq = text.indexOf("=");
	if (eq < 0) options[text] = true;
	else options[text.slice(0, eq)] = text.slice(eq + 1).replace(/^"|"$/g, "").replace(/\\"/g, '"');
};
let current = "";
let quoted = false;
for (let i = 0; i < optionText.length; i++) {
	const char = optionText[i];
	if (char === "\\" && optionText[i + 1] === '"') { current += '\\"'; i++; continue; }
	if (char === '"') quoted = !quoted;
	if (char === "," && !quoted) { addOption(current); current = ""; continue; }
	current += char;
}
addOption(current);

const clientIp = process.env.VCH_TEST_CLIENT_IP || "198.51.100.7";
if (options.from !== undefined && options.from !== clientIp) deny("from=" + options.from + " does not match " + clientIp);
if (options["expiry-time"] !== undefined) {
	const t = String(options["expiry-time"]);
	const expires = new Date(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10) || 0, +t.slice(10, 12) || 0, +t.slice(12, 14) || 0);
	if (Date.now() > expires.getTime()) deny("expired at " + t);
}
log({ command, options });
const env = { ...process.env, SSH_CLIENT: clientIp + " 50022 22" };
if (options.command !== undefined) env.SSH_ORIGINAL_COMMAND = command;
const result = spawnSync("/bin/sh", ["-c", options.command !== undefined ? String(options.command) : command], { stdio: "inherit", env });
process.exit(result.status === null ? 255 : result.status);
`;
