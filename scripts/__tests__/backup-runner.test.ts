// @vitest-environment node
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { installFakeRestoreTools } from "./helpers/fake-restore-tools";

const runFile = promisify(execFile);
const runner = path.resolve("scripts/backup.mjs");
const common = path.resolve("scripts/lib/backup-common.mjs");

describe.skipIf(process.platform === "win32")("backup runner recovery guarantees", () => {
  let tmp: string;
  let app: string;
  let backups: string;
  let bin: string;
  let env: NodeJS.ProcessEnv;

  beforeEach(async () => {
    tmp = await mkdtemp(path.join(os.tmpdir(), "vch-backup-runner-"));
    app = path.join(tmp, "app");
    backups = path.join(tmp, "backups");
    bin = path.join(tmp, "bin");
    await mkdir(path.join(app, "storage"), { recursive: true });
    await mkdir(backups);
    await mkdir(bin);
    await writeFile(path.join(app, "storage", "local.txt"), "local fixture");
    await writeFile(path.join(app, ".env.local"), "DATABASE_URL=postgresql://test:secret%21@127.0.0.1/fixture\n");
    env = { ...process.env, APP_DIR: app, ENV_FILE: path.join(app, ".env.local"), APP_NAME: "fixture", BACKUP_DIR: backups, BACKUP_RETENTION_DAYS: "30", PATH: `${bin}${path.delimiter}${process.env.PATH}` };
    delete env.BACKUP_EXTRA_PATHS_JSON;
    // Never this host's real history directory.
    env.FILE_VERSION_DIR = path.join(tmp, "no-file-versions");
    delete env.BACKUP_INCLUDE_ENV;
    delete env.BACKUP_MAX_BYTES;
    await fakeDump("process.stdout.write('SELECT 1;\\n');");
  });

  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  async function fakeDump(code: string) {
    const file = path.join(bin, "pg_dump");
    await writeFile(file, `#!${process.execPath}\n${code}\n`);
    await chmod(file, 0o755);
  }

  it("keeps a file backup when tar only warns that a file changed while it was read, and fails on a real error", async () => {
    // Anything written under storage/, downloads/ or logs/ during the minutes a backup takes (a download, an upload,
    // a VPS backup) made GNU tar exit 1, and the whole backup failed with no archive published.
    async function fakeTar(createExit: number) {
      const file = path.join(bin, "tar");
      await writeFile(file, `#!${process.execPath}
const { spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
const real = ["/usr/bin/tar", "/bin/tar"].find((candidate) => require("node:fs").existsSync(candidate));
const result = spawnSync(real, args, { stdio: ["ignore", "inherit", "inherit"] });
if (args.includes("-czf") && result.status === 0) { process.stderr.write("tar: storage/big.bin: file changed as we read it\\n"); process.exit(${createExit}); }
process.exit(result.status ?? 2);
`);
      await chmod(file, 0o755);
    }
    const output = path.join(backups, "files.tar.gz");
    await fakeTar(1);
    const withFakeTar = { ...env, TAR_BIN: path.join(bin, "tar") };
    await runFile(process.execPath, [runner, "--files", output], { env: withFakeTar });
    expect((await runFile("tar", ["-tzf", output])).stdout).toContain("storage/local.txt");

    await rm(output, { force: true });
    await fakeTar(2);
    await expect(runFile(process.execPath, [runner, "--files", output], { env: withFakeTar })).rejects.toMatchObject({ stderr: expect.stringContaining("exited with code 2") });
    await expect(stat(output)).rejects.toThrow();
  });

  it("archives configured external data and recovery keys with a restrictive mode", async () => {
    const external = path.join(tmp, "external");
    await mkdir(external);
    await writeFile(path.join(external, "real.txt"), "external fixture");
    const output = path.join(backups, "full.tar.gz");
    await runFile(process.execPath, [runner, "--full", output], { env: { ...env, BACKUP_EXTRA_PATHS_JSON: JSON.stringify([external]), BACKUP_INCLUDE_ENV: "true" } });
    const members = (await runFile("tar", ["-tzf", output])).stdout;
    expect(members).toContain("storage/local.txt");
    expect(members).toContain(".env.local");
    const manifest = JSON.parse((await runFile("tar", ["-xOzf", output, "external-data.json"])).stdout);
    expect((await runFile("tar", ["-xOzf", output, `${manifest.paths[0].member}/real.txt`])).stdout).toBe("external fixture");
    const { stdout: sql } = await runFile("tar", ["-xOzf", output, "database.sql.gz"], { encoding: "buffer" });
    expect(gunzipSync(sql).toString()).toBe("SELECT 1;\n");
    expect((await stat(output)).mode & 0o777).toBe(0o600);
  });

  it.each(["node", "database wrapper", "full wrapper"])("%s never publishes a dump whose process fails after writing stdout", async (entrypoint) => {
    await fakeDump("process.stdout.write('partial SQL'); setTimeout(() => process.exit(7), 30);");
    const output = path.join(backups, "failed.sql.gz");
    const file = entrypoint === "node" ? process.execPath : "bash";
    const args = entrypoint === "node" ? [runner, output] : entrypoint === "database wrapper"
      ? [path.resolve("scripts/backup-db.sh"), output] : [path.resolve("deploy/backup.sh"), "--full", output];
    await expect(runFile(file, args, { env })).rejects.toThrow();
    expect(await readdir(backups)).toEqual([]);
  });

  it.each(["node", "full wrapper"])("%s preserves an existing archive and removes temporary artifacts", async (entrypoint) => {
    const output = path.join(backups, "existing.tar.gz");
    await writeFile(output, "keep existing backup");
    await expect(runFile(entrypoint === "node" ? process.execPath : "bash", [entrypoint === "node" ? runner : path.resolve("deploy/backup.sh"), "--full", output], { env })).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("keep existing backup");
    expect(await readdir(backups)).toEqual(["existing.tar.gz"]);
  });

  it("keeps the file history bodies the database dump refers to", async () => {
    // The dump held the FileVersion rows; the bodies, outside the app
    // directory, were left out of the archive.
    const versions = path.join(tmp, "history");
    await mkdir(path.join(versions, "node_1"), { recursive: true });
    await writeFile(path.join(versions, "node_1", "v1.blob"), "old body");
    const output = path.join(backups, "full-history.tar.gz");
    await runFile(process.execPath, [runner, "--full", output], { env: { ...env, FILE_VERSION_DIR: versions } });
    const manifest = JSON.parse((await runFile("tar", ["-xOzf", output, "file-versions.json"])).stdout);
    expect((await runFile("tar", ["-xOzf", output, `${manifest.member}/node_1/v1.blob`])).stdout).toBe("old body");

    // Inside the app directory (the Docker layout) it is an ordinary member.
    const inside = path.join(app, "file-versions");
    await mkdir(inside);
    await writeFile(path.join(inside, "v2.blob"), "kept");
    const second = path.join(backups, "full-inside.tar.gz");
    await runFile(process.execPath, [runner, "--full", second], { env: { ...env, FILE_VERSION_DIR: inside } });
    expect((await runFile("tar", ["-xOzf", second, "file-versions/v2.blob"])).stdout).toBe("kept");
  });

  it("stores hard-linked files as files, so the backup restores", async () => {
    // Two names for one file in storage: GNU tar stored the second as a hard
    // link, and the backup's own restore refused the archive.
    const { link } = await import("node:fs/promises");
    await writeFile(path.join(app, "storage", "report.txt"), "same body");
    await link(path.join(app, "storage", "report.txt"), path.join(app, "storage", "report-copy.txt"));
    const archive = path.join(backups, "files-links.tar.gz");
    await runFile(process.execPath, [runner, "--files", archive], { env });

    const target = path.join(tmp, "target");
    await mkdir(target);
    await writeFile(path.join(target, ".env.local"), "DATABASE_URL=postgresql://tester@127.0.0.1/audit_target\n");
    const restoreBin = await installFakeRestoreTools(tmp);
    await runFile("bash", ["scripts/restore-files.sh", archive, target], {
      cwd: process.cwd(),
      env: { ...env, PATH: `${restoreBin}${path.delimiter}${env.PATH}`, APP_DIR: target, ENV_FILE: path.join(target, ".env.local"), CONFIRM_RESTORE: "1", DEPLOY_LOCK: path.join(tmp, "no-deploy.lock") },
    });
    await expect(readFile(path.join(target, "storage", "report.txt"), "utf8")).resolves.toBe("same body");
    await expect(readFile(path.join(target, "storage", "report-copy.txt"), "utf8")).resolves.toBe("same body");
  });

  it("fails, rather than publishing an archive the restore would refuse, on a special file", async () => {
    await runFile("mkfifo", [path.join(app, "storage", "pipe")]);
    const archive = path.join(backups, "files-fifo.tar.gz");
    await expect(runFile(process.execPath, [runner, "--files", archive], { env })).rejects.toMatchObject({ stderr: expect.stringContaining("cannot take back") });
    expect((await readdir(backups)).filter((name) => name.startsWith("files-fifo"))).toEqual([]);
  });

  it("restores history kept inside the app directory into the target's own history directory", async () => {
    // Backed up from <app>/file-versions (the Docker layout), restored to an
    // instance whose FILE_VERSION_DIR is elsewhere: the bodies used to land
    // in <target>/file-versions, and the configured directory stayed empty.
    const inside = path.join(app, "file-versions");
    await mkdir(path.join(inside, "node_1"), { recursive: true });
    await writeFile(path.join(inside, "node_1", "v1.blob"), "body");
    const archive = path.join(backups, "full-inside.tar.gz");
    await runFile(process.execPath, [runner, "--full", archive], { env: { ...env, FILE_VERSION_DIR: inside } });

    const target = path.join(tmp, "target");
    const history = path.join(tmp, "target-history");
    await mkdir(target);
    await writeFile(path.join(target, ".env.local"), "DATABASE_URL=postgresql://tester@127.0.0.1/audit_target\n");
    const restoreBin = await installFakeRestoreTools(tmp);
    await runFile("bash", ["scripts/restore-files.sh", archive, target], {
      cwd: process.cwd(),
      env: { ...env, PATH: `${restoreBin}${path.delimiter}${env.PATH}`, APP_DIR: target, ENV_FILE: path.join(target, ".env.local"), FILE_VERSION_DIR: history, CONFIRM_RESTORE: "1", DEPLOY_LOCK: path.join(tmp, "no-deploy.lock") },
    });

    await expect(readFile(path.join(history, "node_1", "v1.blob"), "utf8")).resolves.toBe("body");
    await expect(readFile(path.join(target, "file-versions", "node_1", "v1.blob"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(target, "storage", "local.txt"), "utf8")).resolves.toBe("local fixture");
  });

  it("prunes expired managed full/files/db backups while preserving unrelated files and symlinks", async () => {
    const expired = ["fixture_full_20000101_000000.tar.gz", "fixture_files_20000101_000000.tar.gz", "fixture_20000101_000000.sql.gz"];
    const old = new Date("2000-01-01");
    for (const name of [...expired, "pre-upgrade.sql.gz", "another_full_20000101_000000.tar.gz"]) {
      const file = path.join(backups, name);
      await writeFile(file, "old"); await utimes(file, old, old);
    }
    await symlink(path.join(backups, "pre-upgrade.sql.gz"), path.join(backups, "fixture_full_20000102_000000.tar.gz"));
    await runFile(process.execPath, [runner, "--full"], { env });
    const remaining = await readdir(backups);
    for (const name of expired) expect(remaining).not.toContain(name);
    expect(remaining).toContain("pre-upgrade.sql.gz");
    expect(remaining).toContain("another_full_20000101_000000.tar.gz");
    expect(remaining).toContain("fixture_full_20000102_000000.tar.gz");
  });

  it("rejects an external directory containing the backup output", async () => {
    await expect(runFile(process.execPath, [runner, "--full"], { env: { ...env, BACKUP_EXTRA_PATHS_JSON: JSON.stringify([tmp]) } })).rejects.toMatchObject({ stderr: expect.stringContaining("External backup path overlaps") });
    expect(await readdir(backups)).toEqual([]);
  });

  it("caps managed archive size while keeping the fresh backup and pre-upgrade snapshots", async () => {
    for (const name of ["fixture_full_20260901_000000.tar.gz", "fixture_full_20260902_000000.tar.gz", "pre-upgrade.tar.gz"]) {
      await writeFile(path.join(backups, name), Buffer.alloc(4096));
    }
    await runFile(process.execPath, [runner, "--full"], { env: { ...env, BACKUP_MAX_BYTES: "1024" } });
    const remaining = await readdir(backups);
    expect(remaining).toContain("pre-upgrade.tar.gz");
    expect(remaining.filter((name) => /^fixture_full_\d{8}_\d{6}\.tar\.gz$/.test(name))).toHaveLength(1);
    expect(remaining).not.toContain("fixture_full_20260901_000000.tar.gz");
    expect(remaining).not.toContain("fixture_full_20260902_000000.tar.gz");
  });

});

it("passes PostgreSQL credentials through the environment instead of argv on every platform", async () => {
  const program = `import {pgConnection} from ${JSON.stringify(pathToFileURL(common).href)}; const c=pgConnection({DATABASE_URL:'postgresql://test:secret%21@localhost/db'}); console.log(JSON.stringify(c));`;
  const result = JSON.parse((await runFile(process.execPath, ["--input-type=module", "-e", program])).stdout);
  expect(result.connArgs.join(" ")).not.toContain("secret");
  expect(result.childEnv.PGPASSWORD).toBe("secret!");
});
