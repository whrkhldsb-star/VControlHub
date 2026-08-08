import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const runFile = promisify(execFile);

describe("restore-files archive safety", () => {
  let tmp: string;
  let source: string;
  let target: string;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "vch-restore-files-"));
    source = path.join(tmp, "source");
    target = path.join(tmp, "target");
    await mkdir(source);
    await mkdir(target);
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("restores regular files", async () => {
    await writeFile(path.join(source, "hello.txt"), "hello");
    const archive = path.join(tmp, "regular.tar.gz");
    await runFile("tar", ["-czf", archive, "-C", source, "."]);

    await runFile("bash", ["scripts/restore-files.sh", archive, target], { cwd: process.cwd() });
    await expect(readFile(path.join(target, "hello.txt"), "utf8")).resolves.toBe("hello");
  });

  it("rejects symbolic-link members before extraction", async () => {
    await symlink("/etc/passwd", path.join(source, "outside-link"));
    const archive = path.join(tmp, "symlink.tar.gz");
    await runFile("tar", ["-czf", archive, "-C", source, "."]);

    await expect(runFile("bash", ["scripts/restore-files.sh", archive, target], { cwd: process.cwd() }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("archive links and special files are not supported") });
  });
});
