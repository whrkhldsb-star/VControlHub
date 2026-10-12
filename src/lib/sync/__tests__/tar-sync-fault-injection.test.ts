import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildTarSyncCommand } from "@/lib/sync/service-commands";

/**
 * Executes the real tar fallback command in a scratch directory. A fake `ssh`
 * runs the remote script locally, and a fake `tar` can be told to fail on the
 * archiving side (after emitting a valid partial archive) or on the receiving
 * side (disk full). The assertions are about files on disk, not command text.
 */
const posix = process.platform !== "win32";
const realTar = spawnSync("sh", ["-c", "command -v tar"], { encoding: "utf8" }).stdout.trim();
const realMv = spawnSync("sh", ["-c", "command -v mv"], { encoding: "utf8" }).stdout.trim();

let root: string;
let bin: string;
let source: string;
let target: string;

function writeExecutable(path: string, body: string) {
  writeFileSync(path, body);
  chmodSync(path, 0o755);
}

function runTarSync(options: { deleteOrphans: boolean; failArchive?: boolean; failExtract?: boolean; failCommit?: boolean }) {
  const command = buildTarSyncCommand({
    sourcePath: source,
    targetPath: target,
    targetUser: "audit",
    targetHost: "fixture.invalid",
    targetPort: 22,
    deleteOrphans: options.deleteOrphans,
    jobId: "fault-injection",
  });
  return spawnSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
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

describe.skipIf(!posix || !realTar)("tar fallback sync — fault injection on real files", () => {
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "vch-tar-sync-"));
    bin = join(root, "bin");
    source = join(root, "source");
    target = join(root, "target");
    mkdirSync(bin);
    mkdirSync(source);
    mkdirSync(target);
    // `ssh [opts] addr 'script'` → run the script locally.
    writeExecutable(join(bin, "ssh"), '#!/bin/sh\nfor last; do :; done\nexec /bin/sh -c "$last"\n');
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
    expect(listTree(target)).toEqual(["fresh.txt"]);
    expect(readFileSync(join(target, "fresh.txt"), "utf8")).toBe("new data");
  });

  it("merges without deleting when orphan deletion is off", () => {
    writeFileSync(join(source, "fresh.txt"), "new data");
    writeFileSync(join(source, "valuable.txt"), "updated");
    const result = runTarSync({ deleteOrphans: false });
    expect(result.status, result.stderr).toBe(0);
    expect(listTree(target)).toEqual(["fresh.txt", "keep-dir", "keep-dir/nested.txt", "valuable.txt"]);
    expect(readFileSync(join(target, "valuable.txt"), "utf8")).toBe("updated");
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
