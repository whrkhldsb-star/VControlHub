import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { parseRsyncOutput } from "../service-runtime";
import { buildRsyncCommand, buildSyncGateScript, buildTarSyncCommand, createSyncReceiverLease, retireSyncReceiverLease } from "@/lib/sync/service-commands";

/**
 * Executes the real tar fallback command in a scratch directory, in both login
 * modes. A fake `ssh` runs what the source sends on the "target" locally: the
 * script itself in credential mode, the one-time key's gate (its forced
 * command) in one-time key mode. A fake `tar` can be told to fail on the
 * archiving side (after emitting a valid partial archive) or on the receiving
 * side (disk full). The assertions are about files on disk, not command text.
 */
const posix = process.platform !== "win32";
const realTar = spawnSync("sh", ["-c", "command -v tar"], { encoding: "utf8" }).stdout.trim();
const realMv = spawnSync("sh", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();

let auth: "credential" | "one-time-key";
let root: string;
let bin: string;
let source: string;
let target: string;

function writeExecutable(path: string, body: string) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function runTarSync(options: { deleteOrphans: boolean; confined?: boolean; failArchive?: boolean; failExtract?: boolean; failCommit?: boolean }) {
  const jobId = "fault-injection";
  const transport = { targetUser: "audit", targetHost: "fixture.invalid", targetPort: 22, jobId, confined: options.confined };
  let gate = "";
  let command: string;
  if (auth === "one-time-key") {
    gate = join(root, "gate.sh");
    writeFileSync(gate, buildSyncGateScript({ mode: "tar", confined: options.confined, targetPath: target, allowDelete: options.deleteOrphans, jobId }));
    command = buildTarSyncCommand({ ...transport, auth, sourcePath: source });
  } else {
    command = buildTarSyncCommand({ ...transport, auth, sourcePath: source, targetPath: target, deleteOrphans: options.deleteOrphans });
  }
  return spawnSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      VCH_TEST_GATE: gate,
      VCH_TEST_REAL_TAR: realTar,
      VCH_TEST_FAIL_ARCHIVE: options.failArchive ? "1" : "",
      VCH_TEST_FAIL_EXTRACT: options.failExtract ? "1" : "",
      VCH_TEST_FAIL_COMMIT: options.failCommit ? "1" : "",
      VCH_TEST_REAL_MV: realMv,
    },
  });
}

function listTree(dir: string): string[] {
  return readdirSync(dir, { recursive: true, encoding: "utf8" }).map((entry) => entry.replace(/\\/g, "/")).sort();
}

for (const mode of ["credential", "one-time-key"] as const) describe.skipIf(!posix || !realTar)(`tar fallback sync (${mode}) — fault injection on real files`, () => {
  beforeEach(() => {
    auth = mode;
    root = mkdtempSync(join(tmpdir(), "vch-tar-sync-"));
    bin = join(root, "bin");
    source = join(root, "source");
    target = join(root, "target");
    mkdirSync(bin);
    mkdirSync(source);
    mkdirSync(target);
    // `ssh [opts] addr 'script'` → run the script locally; with a gate (one-time
    // key) → the gate, as sshd runs a forced command.
    writeExecutable(join(bin, "ssh"), '#!/bin/sh\nfor last; do :; done\nif [ -n "$VCH_TEST_GATE" ]; then export SSH_ORIGINAL_COMMAND="$last"; exec /bin/sh "$VCH_TEST_GATE"; fi\nexec /bin/sh -c "$last"\n');
    writeExecutable(
      join(bin, "tar"),
      [
        "#!/bin/sh",
        'if [ "$1" = "cf" ] && [ -n "$VCH_TEST_FAIL_ARCHIVE" ]; then "$VCH_TEST_REAL_TAR" "$@"; exit 2; fi',
        'if [ "$1" = "xf" ] && [ -n "$VCH_TEST_FAIL_EXTRACT" ]; then cat >/dev/null; echo "tar: write error: No space left on device" >&2; exit 2; fi',
        'exec "$VCH_TEST_REAL_TAR" "$@"',
        "",
      ].join("\n"),
    );
    // Moving staged entries into place fails after the first one (e.g. the
    // filesystem errors mid-commit).
    writeExecutable(
      join(bin, "mv"),
      [
        "#!/bin/sh",
        'if [ -n "$VCH_TEST_FAIL_COMMIT" ]; then',
        '  case "$*" in *.vch-sync-stage-*) shift; [ "$1" = "--" ] && shift; "$VCH_TEST_REAL_MV" -f -- "$1" .; exit 1 ;; esac',
        "fi",
        'exec "$VCH_TEST_REAL_MV" "$@"',
        "",
      ].join("\n"),
    );
    writeFileSync(join(target, "valuable.txt"), "existing data");
    mkdirSync(join(target, "keep-dir"));
    writeFileSync(join(target, "keep-dir", "nested.txt"), "nested");
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("mirrors a healthy source exactly and leaves no staging directory behind", () => {
    writeFileSync(join(source, "fresh.txt"), "new data");
    const result = runTarSync({ deleteOrphans: true });
    expect(result.status, result.stderr).toBe(0);
    expect(parseRsyncOutput(result.stdout)).toMatchObject({ transferredFiles: 1, totalSize: 8 });
    expect(listTree(target)).toEqual(["fresh.txt"]);
    expect(readFileSync(join(target, "fresh.txt"), "utf8")).toBe("new data");
  });

  it("publishes a confined tree from a fresh stage into the checked directory", () => {
    writeFileSync(join(source, "new.txt"), "copied");
    const result = runTarSync({ deleteOrphans: false, confined: true });
    expect(result.status, result.stderr || result.stdout).toBe(0);
    expect(readFileSync(join(target, "new.txt"), "utf8")).toBe("copied");
  });

  it("refuses a confined merge when a destination directory is a link", () => {
    const sibling = join(root, "sibling");
    mkdirSync(sibling);
    mkdirSync(join(source, "docs"));
    symlinkSync(sibling, join(target, "docs"));
    writeFileSync(join(source, "docs", "fresh.txt"), "new data");
    const result = runTarSync({ deleteOrphans: false, confined: true });
    expect(result.status).not.toBe(0);
    expect(listTree(sibling)).toEqual([]);
  });

  it("merges without deleting when orphan deletion is off", () => {
    writeFileSync(join(source, "fresh.txt"), "new data");
    writeFileSync(join(source, "valuable.txt"), "updated");
    const result = runTarSync({ deleteOrphans: false });
    expect(result.status, result.stderr).toBe(0);
    expect(listTree(target)).toEqual(["fresh.txt", "keep-dir", "keep-dir/nested.txt", "valuable.txt"]);
    expect(readFileSync(join(target, "valuable.txt"), "utf8")).toBe("updated");
  });

  it("stops before publication when staging file sizes cannot be measured", () => {
    writeFileSync(join(source, "fresh.txt"), "new data");
    writeExecutable(join(bin, "stat"), "#!/bin/sh\nexit 1\n");
    const result = runTarSync({ deleteOrphans: false });
    expect(result.status).not.toBe(0);
    expect(existsSync(join(target, "fresh.txt"))).toBe(false);
    expect(listTree(target)).toEqual(["keep-dir", "keep-dir/nested.txt", "valuable.txt"]);
    expect(result.stdout).not.toContain("Number of regular files transferred: 0");
  });

  it.each([true, false])("fails and leaves the target untouched when the source tar exits non-zero (deleteOrphans=%s)", (deleteOrphans) => {
    writeFileSync(join(source, "partial.txt"), "partial source");
    const before = listTree(target);
    const result = runTarSync({ deleteOrphans, failArchive: true });
    expect(result.status).not.toBe(0);
    expect(listTree(target)).toEqual(before);
    expect(readFileSync(join(target, "valuable.txt"), "utf8")).toBe("existing data");
  });

  it.each([true, false])("fails and leaves the target untouched when the receiving side cannot extract (deleteOrphans=%s)", (deleteOrphans) => {
    writeFileSync(join(source, "fresh.txt"), "new data");
    const before = listTree(target);
    const result = runTarSync({ deleteOrphans, failExtract: true });
    expect(result.status).not.toBe(0);
    expect(listTree(target)).toEqual(before);
  });

  it("puts the previous entries back when the mirror commit fails part-way", () => {
    writeFileSync(join(source, "a.txt"), "new a");
    writeFileSync(join(source, "b.txt"), "new b");
    writeFileSync(join(source, "c.txt"), "new c");
    const before = listTree(target);
    const result = runTarSync({ deleteOrphans: true, failCommit: true });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/target restored/);
    expect(listTree(target)).toEqual(before);
    expect(readFileSync(join(target, "valuable.txt"), "utf8")).toBe("existing data");
  });

  it("refuses to commit over the preserved entries of an interrupted earlier commit", () => {
    writeFileSync(join(source, "fresh.txt"), "new data");
    // What a killed commit leaves behind: the old entries moved aside.
    const prev = join(target, ".vch-sync-prev-fault-injection");
    mkdirSync(prev);
    writeFileSync(join(prev, "older.txt"), "only copy of the old data");
    const result = runTarSync({ deleteOrphans: true });
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toMatch(/interrupted/);
    expect(readFileSync(join(prev, "older.txt"), "utf8")).toBe("only copy of the old data");
    expect(readFileSync(join(target, "valuable.txt"), "utf8")).toBe("existing data");
  });

  it("leaves another job's staging directory in the target alone", () => {
    writeFileSync(join(source, "fresh.txt"), "new data");
    mkdirSync(join(target, ".vch-sync-stage-other-job"));
    writeFileSync(join(target, ".vch-sync-stage-other-job", "inflight.txt"), "other");
    const result = runTarSync({ deleteOrphans: true });
    expect(result.status, result.stderr).toBe(0);
    expect(listTree(target)).toEqual([".vch-sync-stage-other-job", ".vch-sync-stage-other-job/inflight.txt", "fresh.txt"]);
  });
});


// SSH can close a channel without terminating a quiet remote child. A successor must see the
// receiver as busy until its real process exits, even after the previous run's permit is removed.
it.skipIf(process.platform !== "linux")("fences a quiet tar receiver after channel loss and denies its later commit", async () => {
  const dir = mkdtempSync(join(tmpdir(), "vch-sync-fence-"));
  const lease = join(dir, "lease");
  const shell = (command: string) => spawnSync("/bin/sh", ["-c", command]);
  const gate = buildSyncGateScript({ mode: "tar", targetPath: dir, allowDelete: false, jobId: "fixture", receiverLease: lease });
  writeExecutable(join(dir, "tar"), '#!/bin/sh\ntouch "$TEST_ROOT/started" || exit 1\nwhile [ ! -e "$TEST_ROOT/release" ]; do sleep 0.05; done\n');
  const env = { ...process.env, PATH: dir + ":" + process.env.PATH, TEST_ROOT: dir };
  const missingTool = spawnSync("/bin/sh", ["-c", createSyncReceiverLease(lease)], { env: { NODE_ENV: "test", PATH: dir } });
  expect(missingTool.status).not.toBe(0);
  expect(existsSync(lease)).toBe(false);
  expect(shell(createSyncReceiverLease(lease)).status).toBe(0);
  const child = spawn("/bin/sh", ["-c", gate], { env: { ...env, SSH_ORIGINAL_COMMAND: "vch-sync tar-receive" } });
  const exit = new Promise<number | null>(resolve => child.once("close", resolve));
  try {
    await vi.waitFor(() => expect(existsSync(join(dir, "started"))).toBe(true));
    child.stdout.destroy();
    child.stderr.destroy();
    child.stdin.end();
    expect(shell(retireSyncReceiverLease(lease)).status).not.toBe(0);
    expect(existsSync(join(lease, "active"))).toBe(false);
    expect(spawnSync("/bin/sh", ["-c", gate], { env: { ...env, SSH_ORIGINAL_COMMAND: "vch-sync tar-commit" } }).status).not.toBe(0);
    writeFileSync(join(dir, "release"), "");
    expect(await exit).toBe(0);
    expect(shell(retireSyncReceiverLease(lease)).status).toBe(0);
    expect(existsSync(lease)).toBe(false);
  } finally {
    writeFileSync(join(dir, "release"), "");
    await exit;
    rmSync(dir, { recursive: true, force: true });
  }
});

it.skipIf(process.platform !== "linux" || spawnSync("rsync", ["--version"]).status !== 0)("confined credential rsync replaces a linked target child and rejects a revoked receiver", () => {
  const dir = mkdtempSync(join(tmpdir(), "vch-sync-rsync-"));
  const lease = join(dir, "lease");
  const src = join(dir, "source");
  const dst = join(dir, "target");
  const sibling = join(dir, "sibling");
  const env = { ...process.env, PATH: dir + ":" + process.env.PATH };
  const shell = (command: string) => spawnSync("/bin/sh", ["-c", command], { env, encoding: "utf8" });
  try {
    mkdirSync(join(src, "docs"), { recursive: true });
    mkdirSync(dst);
    mkdirSync(sibling);
    symlinkSync(sibling, join(dst, "docs"));
    writeFileSync(join(src, "docs", "file"), "copied");
    writeExecutable(join(dir, "ssh"), '#!/bin/sh\nwhile [ "$#" -gt 0 ] && [ "$1" != "fixture.invalid" ]; do shift; done\nshift || exit 1\nexec sh -c "$*"\n');
    const command = buildRsyncCommand({ auth: "credential", targetUser: "fixture", targetHost: "fixture.invalid", targetPort: 22,
      sourcePath: src, targetPath: dst, flags: ["-a"], confined: true, receiverLease: lease });
    expect(shell(createSyncReceiverLease(lease)).status).toBe(0);
    const first = shell(command);
    expect(first.status, first.stdout + first.stderr).toBe(0);
    expect(readFileSync(join(dst, "docs", "file"), "utf8")).toBe("copied");
    expect(listTree(sibling)).toEqual([]);
    expect(shell(retireSyncReceiverLease(lease)).status).toBe(0);
    writeFileSync(join(src, "new-file"), "");
    expect(shell(command).status).not.toBe(0);
    expect(existsSync(join(dst, "new-file"))).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
