import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installFakeRestoreTools } from "./helpers/fake-restore-tools";

const runFile = promisify(execFile);

// scripts/restore-files.sh is a Linux restore entrypoint (bash + POSIX tar
// semantics + symlink privilege handling); it is not runnable on Windows.
describe.skipIf(process.platform === "win32")("restore-files archive safety", () => {
  let tmp: string;
  let source: string;
  let target: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "vch-restore-files-"));
    source = path.join(tmp, "source");
    target = path.join(tmp, "target");
    await mkdir(source);
    await mkdir(target);
    const bin = await installFakeRestoreTools(tmp);
    await writeFile(path.join(tmp, "restore.env"), "DATABASE_URL=postgresql://tester@127.0.0.1/audit_target\n");
    env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, APP_DIR: tmp, CONFIRM_RESTORE: "1", ENV_FILE: path.join(tmp, "restore.env"), DEPLOY_LOCK: path.join(tmp, "no-deploy.lock") };
  });

  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
  });

  it("restores regular files", async () => {
    await writeFile(path.join(source, "hello.txt"), "hello");
    const archive = path.join(tmp, "regular.tar.gz");
    await runFile("tar", ["-czf", archive, "-C", source, "."]);

    await runFile("bash", ["scripts/restore-files.sh", archive, target], { cwd: process.cwd(), env });
    await expect(readFile(path.join(target, "hello.txt"), "utf8")).resolves.toBe("hello");
  });

  it("restores data and keeps the installation's own code from a FULL archive", async () => {
    // A FULL archive records the code of the version that made it; laid over
    // this installation it mixed old code into new and dirtied the checkout.
    await mkdir(path.join(source, "storage"), { recursive: true });
    await mkdir(path.join(source, "public"), { recursive: true });
    await writeFile(path.join(source, "storage", "a.txt"), "from-backup");
    await writeFile(path.join(source, "public", "sw.js"), "old worker");
    await writeFile(path.join(source, "package.json"), "{\"version\":\"old\"}");
    await mkdir(path.join(target, "public"), { recursive: true });
    await writeFile(path.join(target, "public", "sw.js"), "new worker");
    await writeFile(path.join(target, "package.json"), "{\"version\":\"new\"}");
    const archive = path.join(tmp, "full-like.tar.gz");
    await runFile("tar", ["-czf", archive, "-C", source, "storage", "public", "package.json"]);

    await runFile("bash", ["scripts/restore-files.sh", archive, target], { cwd: process.cwd(), env });

    await expect(readFile(path.join(target, "storage", "a.txt"), "utf8")).resolves.toBe("from-backup");
    await expect(readFile(path.join(target, "public", "sw.js"), "utf8")).resolves.toBe("new worker");
    await expect(readFile(path.join(target, "package.json"), "utf8")).resolves.toBe("{\"version\":\"new\"}");
  });

  it("leaves data from outside the application directory in the archive", async () => {
    // BACKUP_EXTRA_PATHS_JSON data is restored by the administrator to a
    // place they choose; it used to land under the application directory.
    await mkdir(path.join(source, "srv", "media"), { recursive: true });
    await writeFile(path.join(source, "srv", "media", "big.bin"), "external");
    await writeFile(path.join(source, "external-data.json"), JSON.stringify({ version: 1, paths: [{ source: "/srv/media", member: "srv/media" }] }));
    await mkdir(path.join(source, "uploads"), { recursive: true });
    await writeFile(path.join(source, "uploads", "u.txt"), "upload");
    const archive = path.join(tmp, "external.tar.gz");
    await runFile("tar", ["-czf", archive, "-C", source, "uploads", "srv", "external-data.json"]);

    const { stdout, stderr } = await runFile("bash", ["scripts/restore-files.sh", archive, target], { cwd: process.cwd(), env });

    await expect(readFile(path.join(target, "uploads", "u.txt"), "utf8")).resolves.toBe("upload");
    await expect(readFile(path.join(target, "srv", "media", "big.bin"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(target, "external-data.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(`${stdout}${stderr}`).toContain("srv/media");
  });

  it("puts file history bodies back into the history directory", async () => {
    const history = path.join(tmp, "history");
    await mkdir(path.join(source, "var", "lib", "vch", "file-versions", "node_1"), { recursive: true });
    await writeFile(path.join(source, "var", "lib", "vch", "file-versions", "node_1", "v1.blob"), "old body");
    await writeFile(path.join(source, "file-versions.json"), JSON.stringify({ version: 1, source: "/var/lib/vch/file-versions", member: "var/lib/vch/file-versions" }));
    await mkdir(path.join(source, "uploads"), { recursive: true });
    await writeFile(path.join(source, "uploads", "u.txt"), "upload");
    const archive = path.join(tmp, "history.tar.gz");
    await runFile("tar", ["-czf", archive, "-C", source, "uploads", "var", "file-versions.json"]);

    await runFile("bash", ["scripts/restore-files.sh", archive, target], { cwd: process.cwd(), env: { ...env, FILE_VERSION_DIR: history } });

    await expect(readFile(path.join(history, "node_1", "v1.blob"), "utf8")).resolves.toBe("old body");
    await expect(readFile(path.join(target, "var", "lib", "vch", "file-versions", "node_1", "v1.blob"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(target, "file-versions.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects symbolic-link members before extraction", async () => {
    await symlink("/etc/passwd", path.join(source, "outside-link"));
    const archive = path.join(tmp, "symlink.tar.gz");
    await runFile("tar", ["-czf", archive, "-C", source, "."]);

    await expect(runFile("bash", ["scripts/restore-files.sh", archive, target], { cwd: process.cwd(), env }))
      .rejects.toMatchObject({ stderr: expect.stringContaining("archive links and special files are not supported") });
  });
});
