import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { utils } from "ssh2";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  buildAuthorizedKeysGateOption,
  buildOneTimeKeyInstallCommand,
  buildOneTimeKeyRevokeCommand,
  generateOneTimeKeyPair,
  oneTimeKeyMarker,
} from "@/lib/sync/one-time-key";
import { buildSyncGateScript, parseSyncPeerProbe } from "@/lib/sync/service-commands";

/**
 * The pieces of a run's one-time target key, exercised for real: the key
 * format against ssh2 and OpenSSH's ssh-keygen, the gate script and the
 * authorized_keys install/revoke scripts under /bin/sh in a scratch HOME.
 */
const posix = process.platform !== "win32";
const hasSshKeygen = posix && spawnSync("sh", ["-c", "command -v ssh-keygen"]).status === 0;
const me = userInfo().username;

describe("generateOneTimeKeyPair", () => {
  it("produces OpenSSH keys whose halves match, every time", () => {
    // ssh2's generator drops a leading zero byte in about one key of 256.
    for (let i = 0; i < 300; i++) {
      const pair = generateOneTimeKeyPair("vch-sync-ephemeral:job:fwd-1:1");
      const parsedPrivate = utils.parseKey(pair.privateKey);
      const parsedPublic = utils.parseKey(pair.publicKey);
      if (parsedPrivate instanceof Error || parsedPublic instanceof Error) throw parsedPrivate instanceof Error ? parsedPrivate : parsedPublic;
      const privateKey = Array.isArray(parsedPrivate) ? parsedPrivate[0]! : parsedPrivate;
      const publicKey = Array.isArray(parsedPublic) ? parsedPublic[0]! : parsedPublic;
      expect(privateKey.getPublicSSH().equals(publicKey.getPublicSSH())).toBe(true);
      expect(pair.publicKey).toMatch(/^ssh-ed25519 [A-Za-z0-9+/]+=* vch-sync-ephemeral:job:fwd-1:1$/);
    }
  });

  it("gives a different key every call", () => {
    expect(generateOneTimeKeyPair("c").publicKey).not.toBe(generateOneTimeKeyPair("c").publicKey);
  });

  it.skipIf(!hasSshKeygen)("is read by OpenSSH itself", () => {
    const dir = mkdtempSync(join(tmpdir(), "vch-otk-"));
    try {
      const pair = generateOneTimeKeyPair("vch-sync-ephemeral:job:fwd-1:1");
      const file = join(dir, "key");
      writeFileSync(file, pair.privateKey, { mode: 0o600 });
      const derived = spawnSync("ssh-keygen", ["-y", "-f", file], { encoding: "utf8" });
      expect(derived.status, derived.stderr).toBe(0);
      expect(derived.stdout.trim().split(" ").slice(0, 2).join(" ")).toBe(pair.publicKey.split(" ").slice(0, 2).join(" "));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses a comment that would break the authorized_keys line", () => {
    expect(() => generateOneTimeKeyPair("two words")).toThrow();
    expect(() => generateOneTimeKeyPair("line\nbreak")).toThrow();
  });
});

describe("oneTimeKeyMarker", () => {
  it("carries job, run and expiry for the sweeps, with the job id reduced to a safe stem", () => {
    expect(oneTimeKeyMarker({ jobId: "cm1:x y", run: "fwd-abc", expiresAt: new Date(1_800_000_000_500) }))
      .toBe("vch-sync-ephemeral:cm1_x_y:fwd-abc:1800000000");
  });
});

describe("parseSyncPeerProbe", () => {
  it("reads the gate's answer and tells a refusal from an unusable address", () => {
    expect(parseSyncPeerProbe("banner\nVCH_SYNC_PEER=198.51.100.7\n")).toBe("198.51.100.7");
    expect(parseSyncPeerProbe("VCH_SYNC_PEER=2001:db8::7\n")).toBe("2001:db8::7");
    expect(parseSyncPeerProbe("VCH_SYNC_PEER=\n")).toBeNull();
    expect(parseSyncPeerProbe("VCH_SYNC_PEER=1.2.3.4\";id\n")).toBeNull();
    expect(parseSyncPeerProbe("Permission denied (publickey).\n")).toBeUndefined();
  });
});

describe.skipIf(!posix)("the gate (the one-time key's forced command)", () => {
  let dir: string;
  let bin: string;
  let rsyncLog: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "vch-gate-"));
    bin = join(dir, "bin");
    rsyncLog = join(dir, "rsync.log");
    mkdirSync(bin);
    // Stands in for rsync on the target: records the argv the gate execs.
    writeFileSync(join(bin, "rsync"), `#!/bin/sh\nprintf '%s\\n' "$@" > ${JSON.stringify(rsyncLog)}\n`);
    chmodSync(join(bin, "rsync"), 0o755);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** Run the gate the way sshd runs the authorized_keys line's command option. */
  function runGate(gate: string, original: string | undefined) {
    const option = buildAuthorizedKeysGateOption(gate);
    const forced = option.slice('command="'.length, -1).replace(/\\"/g, '"');
    const env: NodeJS.ProcessEnv = { ...process.env, PATH: `${bin}:${process.env.PATH}`, SSH_CLIENT: "203.0.113.9 50022 22" };
    if (original === undefined) delete env.SSH_ORIGINAL_COMMAND;
    else env.SSH_ORIGINAL_COMMAND = original;
    return spawnSync("/bin/sh", ["-c", forced], { encoding: "utf8", env, cwd: dir });
  }

  const rsyncGate = (allowDelete = false) => buildSyncGateScript({ mode: "rsync", targetPath: "/srv/backup target", allowDelete });

  it("answers hello with the address the connection came from", () => {
    const result = runGate(rsyncGate(), "vch-sync hello");
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe("VCH_SYNC_PEER=203.0.113.9\n");
  });

  it("runs rsync as a receiver into the job's directory, whatever destination the source names", () => {
    const result = runGate(rsyncGate(), "rsync --server -vlogDtpre.iLsfxCIvu --timeout=300 --stats --partial . /etc/");
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(rsyncLog, "utf8").trimEnd().split("\n")).toEqual([
      "--server", "-vlogDtpre.iLsfxCIvu", "--timeout=300", "--stats", "--partial", ".", "/srv/backup target/",
    ]);
  });

  it("accepts what every job flavour sends: compression, newer-wins, deletion for a deleting job", () => {
    expect(runGate(rsyncGate(), "rsync --server -vulogDtprze.iLsfxCIvu --timeout=300 --stats --partial . .").status).toBe(0);
    expect(runGate(rsyncGate(true), "rsync --server -vlogDtpre.iLsfxCIvu --timeout=300 --delete --stats --partial . .").status).toBe(0);
    expect(readFileSync(rsyncLog, "utf8")).toContain("--delete\n");
  });

  it("never evaluates the command line it was sent", () => {
    const pwned = join(dir, "pwned");
    const result = runGate(rsyncGate(), `rsync --server -vlogDtpr . /x;touch ${pwned};$(touch ${pwned})`);
    expect(result.status).toBe(0);
    expect(existsSync(pwned)).toBe(false);
    expect(readFileSync(rsyncLog, "utf8").trimEnd().split("\n").at(-1)).toBe("/srv/backup target/");
  });

  it.each([
    ["an interactive login", undefined],
    ["a shell command", "id"],
    ["a command dressed up as rsync", "rsync --server-x"],
    ["rsync sending files out of the target", "rsync --server --sender -vlogDtpre.iLsfxCIvu . /etc/"],
    ["protect-args, whose options would bypass the check", "rsync --server -svlogDtpre.iLsfxCIvu ."],
    ["following symlinked directories on the receiver", "rsync --server -vlogDtprKe.iLsfxCIvu . ."],
    ["deletion in a job that does not delete", "rsync --server -vlogDtpre.iLsfxCIvu --delete . ."],
    ["an option that writes a file elsewhere", "rsync --server -vlogDtpr --log-file=/tmp/x . ."],
    ["an option that reads a file elsewhere", "rsync --server -vlogDtpr --files-from=/etc/shadow . ."],
    ["a timeout that is not a number", "rsync --server -vlogDtpr --timeout=3;id . ."],
    ["rsync without its '.' argument", "rsync --server -vlogDtpr"],
    ["a tar phase on an rsync key", "vch-sync tar-receive"],
  ])("refuses %s", (_label, original) => {
    const result = runGate(rsyncGate(), original);
    expect(result.status).toBe(126);
    expect(result.stderr).toMatch(/vch-sync gate: refused/);
    expect(existsSync(rsyncLog)).toBe(false);
  });

  it("allows a tar key only its three phases", () => {
    const target = join(dir, "target");
    mkdirSync(target);
    const gate = buildSyncGateScript({ mode: "tar", targetPath: target, allowDelete: false, jobId: "job-1" });
    expect(runGate(gate, "rsync --server -vlogDtpr . .").status).toBe(126);
    expect(runGate(gate, "vch-sync tar-commit; id").status).toBe(126);
    const abort = runGate(gate, "vch-sync tar-abort");
    expect(abort.status, abort.stderr).toBe(0);
  });
});

describe.skipIf(!posix)("installing and removing the key line", () => {
  let home: string;
  let bin: string;
  let authorizedKeys: string;
  const expiresAt = new Date(Date.now() + 13 * 60 * 60 * 1000);
  const pair = generateOneTimeKeyPair(oneTimeKeyMarker({ jobId: "job-1", run: "fwd-aa", expiresAt }));
  const commandOption = buildAuthorizedKeysGateOption(buildSyncGateScript({ mode: "rsync", targetPath: "/srv/t", allowDelete: false }));
  const existing = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExistingAdminKeyExistingAdminKeyExistingAd admin@laptop";

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), "vch-ak-"));
    bin = join(home, "bin");
    authorizedKeys = join(home, ".ssh", "authorized_keys");
    mkdirSync(bin);
    useSshVersion("OpenSSH_9.6p1");
  });

  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  function useSshVersion(version: string | null) {
    writeFileSync(join(bin, "ssh"), version ? `#!/bin/sh\necho '${version} fake' >&2\n` : "#!/bin/sh\nexit 127\n");
    chmodSync(join(bin, "ssh"), 0o755);
  }

  function run(command: string) {
    return spawnSync("/bin/sh", ["-c", command], { encoding: "utf8", env: { ...process.env, HOME: home, PATH: `${bin}:${process.env.PATH}` } });
  }

  const install = (overrides: Partial<Parameters<typeof buildOneTimeKeyInstallCommand>[0]> = {}) =>
    run(buildOneTimeKeyInstallCommand({ user: me, publicKey: pair.publicKey, commandOption, jobId: "job-1", expiresAt, ...overrides }));

  function keyLines(): string[] {
    return readFileSync(authorizedKeys, "utf8").split("\n").filter(Boolean);
  }

  it("creates ~/.ssh and authorized_keys privately when they are missing", () => {
    const result = install();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain("VCH_SYNC_KEY_INSTALLED");
    expect(statSync(join(home, ".ssh")).mode & 0o777).toBe(0o700);
    expect(statSync(authorizedKeys).mode & 0o077).toBe(0);
  });

  it("pins the key to the gate with restrict, an expiry time and, once known, the source address", () => {
    expect(install({ from: "198.51.100.7" }).status).toBe(0);
    const [line] = keyLines();
    expect(line).toMatch(/^restrict,expiry-time="\d{12}",from="198\.51\.100\.7",command="exec \/bin\/sh -c \\"\$\(printf %s [A-Za-z0-9+/=]+ \| base64 -d\)\\" vch-sync-gate" ssh-ed25519 /);
    expect(line!.endsWith(pair.publicKey)).toBe(true);
    const expected = spawnSync("/bin/sh", ["-c", `unset TZ; date -d @${Math.floor(expiresAt.getTime() / 1000)} +%Y%m%d%H%M`], { encoding: "utf8" }).stdout.trim();
    if (expected) expect(line).toContain(`expiry-time="${expected}"`);
  });

  it.each([
    ["OpenSSH_7.4p1", /^restrict,command="/],
    ["OpenSSH_7.1p2", /^no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,command="/],
    [null, /^no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty,command="/],
  ])("uses only options an older sshd (%s) understands", (version, expected) => {
    useSshVersion(version);
    expect(install().status).toBe(0);
    expect(keyLines()[0]).toMatch(expected);
  });

  it("keeps the line before it intact when that line has no final newline", () => {
    mkdirSync(join(home, ".ssh"), { mode: 0o700 });
    writeFileSync(authorizedKeys, existing, { mode: 0o600 });
    expect(install().status).toBe(0);
    expect(keyLines()[0]).toBe(existing);
    expect(run(buildOneTimeKeyRevokeCommand({ jobId: "job-1", run: "fwd-aa" })).status).toBe(0);
    expect(readFileSync(authorizedKeys, "utf8")).toBe(`${existing}\n`);
  });

  it("re-adding the line (to pin from=) replaces it instead of adding a second one", () => {
    expect(install().status).toBe(0);
    expect(install({ from: "198.51.100.7" }).status).toBe(0);
    expect(keyLines()).toHaveLength(1);
    expect(keyLines()[0]).toContain('from="198.51.100.7"');
  });

  it("removes only the run's line, and leaves the file alone when there is nothing to remove", () => {
    const otherJob = `restrict,command="true" ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOther ${oneTimeKeyMarker({ jobId: "job-2", run: "fwd-bb", expiresAt })}`;
    mkdirSync(join(home, ".ssh"), { mode: 0o700 });
    writeFileSync(authorizedKeys, `${existing}\n${otherJob}\n`, { mode: 0o600 });
    expect(install().status).toBe(0);
    const revoked = run(buildOneTimeKeyRevokeCommand({ jobId: "job-1", run: "fwd-aa" }));
    expect(revoked.status, revoked.stderr).toBe(0);
    expect(revoked.stdout).toContain("VCH_SYNC_KEY_REVOKED");
    expect(keyLines()).toEqual([existing, otherJob]);
    const before = statSync(authorizedKeys).mtimeMs;
    expect(run(buildOneTimeKeyRevokeCommand({ jobId: "job-1", run: "fwd-aa" })).status).toBe(0);
    expect(statSync(authorizedKeys).mtimeMs).toBe(before);
  });

  it("sweeps expired lines of any job and leftover lines of the same job when it installs", () => {
    const expired = `restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIExpired vch-sync-ephemeral:job-9:fwd-old:1000`;
    const crashedSameJob = `restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICrashed ${oneTimeKeyMarker({ jobId: "job-1", run: "rev-old", expiresAt })}`;
    const liveOtherJob = `restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILive ${oneTimeKeyMarker({ jobId: "job-2", run: "fwd-cc", expiresAt })}`;
    mkdirSync(join(home, ".ssh"), { mode: 0o700 });
    writeFileSync(authorizedKeys, [existing, expired, crashedSameJob, liveOtherJob, ""].join("\n"), { mode: 0o600 });
    expect(install().status).toBe(0);
    const lines = keyLines();
    expect(lines.slice(0, 2)).toEqual([existing, liveOtherJob]);
    expect(lines).toHaveLength(3);
    expect(lines[2]!.endsWith(pair.publicKey)).toBe(true);
  });

  it("removes every line of a job for the stale-run sweep", () => {
    const crashed = `restrict ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAICrashed ${oneTimeKeyMarker({ jobId: "job-1", run: "rev-old", expiresAt })}`;
    mkdirSync(join(home, ".ssh"), { mode: 0o700 });
    writeFileSync(authorizedKeys, `${existing}\n${crashed}\n`, { mode: 0o600 });
    expect(run(buildOneTimeKeyRevokeCommand({ jobId: "job-1" })).status).toBe(0);
    expect(keyLines()).toEqual([existing]);
  });

  it("edits the file a symlinked authorized_keys points to", () => {
    const real = join(home, "keys-elsewhere");
    writeFileSync(real, `${existing}\n`, { mode: 0o600 });
    mkdirSync(join(home, ".ssh"), { mode: 0o700 });
    symlinkSync(real, authorizedKeys);
    expect(install().status).toBe(0);
    expect(run(buildOneTimeKeyRevokeCommand({ jobId: "job-1", run: "fwd-aa" })).status).toBe(0);
    expect(lstatSync(authorizedKeys).isSymbolicLink()).toBe(true);
    expect(readFileSync(real, "utf8")).toBe(`${existing}\n`);
  });

  it("does nothing when the hub's session is not the user the source logs in as", () => {
    const result = install({ user: `${me}x` });
    expect(result.status).toBe(3);
    expect(result.stderr).toMatch(/the sync logs in as/);
    expect(existsSync(authorizedKeys)).toBe(false);
  });

  it("refuses to build a line from anything but a one-time public key and an IP address", () => {
    expect(() => buildOneTimeKeyInstallCommand({ user: me, publicKey: "ssh-ed25519 AAAA x\nssh-rsa B y", commandOption, jobId: "job-1", expiresAt })).toThrow();
    expect(() => buildOneTimeKeyInstallCommand({ user: me, publicKey: pair.publicKey, commandOption, jobId: "job-1", expiresAt, from: "1.2.3.4\",command=\"id" })).toThrow();
  });
});
