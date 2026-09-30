// @vitest-environment node
import { execFile } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

  it("never publishes a dump whose process fails after writing stdout", async () => {
    await fakeDump("process.stdout.write('partial SQL'); setTimeout(() => process.exit(7), 30);");
    const output = path.join(backups, "failed.sql.gz");
    await expect(runFile(process.execPath, [runner, output], { env })).rejects.toMatchObject({ stderr: expect.stringContaining("pg_dump exited with code 7") });
    expect(await readdir(backups)).toEqual([]);
  });

  it("preserves an existing archive and removes temporary artifacts", async () => {
    const output = path.join(backups, "existing.tar.gz");
    await writeFile(output, "keep existing backup");
    await expect(runFile(process.execPath, [runner, "--full", output], { env })).rejects.toThrow();
    expect(await readFile(output, "utf8")).toBe("keep existing backup");
    expect(await readdir(backups)).toEqual(["existing.tar.gz"]);
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
