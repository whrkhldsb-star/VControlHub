import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { installFakeRestoreTools } from "../../../../scripts/__tests__/helpers/fake-restore-tools";

/**
 * Fault injection against scripts/restore.mjs with a real PostgreSQL: the dump
 * fails part-way through (after its DROP/CREATE/COPY statements already ran).
 * The restore must not leave a half-restored database behind, and a FULL
 * restore must not have replaced files when its database step fails.
 *
 * It also proves the offline guard: the import refuses while any other client
 * is connected, and a client that connects during the import only ever sees
 * the restored data. systemctl is faked (the host's own services are not the
 * subject here); psql and pg_dump are real.
 *
 * Runs only with RUN_DATABASE_INTEGRATION_TESTS=1 and a DATABASE_URL that may
 * CREATE DATABASE; it creates and drops its own scratch databases, so it never
 * restores over a database another suite is using.
 */
const hasDatabase = process.env.RUN_DATABASE_INTEGRATION_TESTS === "1" && Boolean(process.env.DATABASE_URL);
const has = (bin: string) => spawnSync("sh", ["-c", `command -v ${bin}`]).status === 0;
const enabled = hasDatabase && process.platform !== "win32" && has("psql") && has("pg_dump") && has("tar");

const RESTORE_SCRIPT = resolve(__dirname, "../../../../scripts/restore.mjs");

function adminUrl(database: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  url.search = "";
  return url.toString();
}

function psql(url: string, sql: string) {
  const result = spawnSync("psql", ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1", url, "-c", sql], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

describe.skipIf(!enabled)("restore.mjs atomicity against PostgreSQL", () => {
  const database = `vch_restore_probe_${process.pid}_${Date.now()}`;
  let url: string;
  let work: string;
  let failingDump: string;
  let fakeBin: string;

  beforeAll(async () => {
    psql(adminUrl("postgres"), `CREATE DATABASE ${database}`);
    url = adminUrl(database);
    psql(url, "CREATE TABLE probe (id int PRIMARY KEY, v text); INSERT INTO probe VALUES (1, 'from-backup')");
    const dump = spawnSync("pg_dump", [url, "--no-owner", "--no-privileges", "--clean", "--if-exists"], { encoding: "utf8" });
    expect(dump.status, dump.stderr).toBe(0);
    psql(url, "UPDATE probe SET v = 'live-data'; CREATE TABLE created_after_backup (id int)");
    work = mkdtempSync(join(tmpdir(), "vch-restore-atomicity-"));
    fakeBin = await installFakeRestoreTools(work, { psql: false });
    writeFileSync(join(work, ".env.restore"), `DATABASE_URL=${url}\n`);
    // A dump that dies after its schema and data statements have executed.
    failingDump = join(work, "database.sql.gz");
    writeFileSync(failingDump, gzipSync(`${dump.stdout}\nSELECT 1/0;\n`));
  });

  afterAll(() => {
    if (work) rmSync(work, { recursive: true, force: true });
    try { psql(adminUrl("postgres"), `DROP DATABASE IF EXISTS ${database} WITH (FORCE)`); } catch { /* best effort */ }
  });

  function runRestore(args: string[], appDir: string) {
    return spawnSync(process.execPath, [RESTORE_SCRIPT, ...args], {
      encoding: "utf8",
      env: restoreEnv(appDir, join(work, ".env.restore")),
    });
  }

  function restoreEnv(appDir: string, envFile: string) {
    return { ...process.env, PATH: `${fakeBin}:${process.env.PATH}`, CONFIRM_RESTORE: "1", APP_DIR: appDir, ENV_FILE: envFile };
  }

  it("rolls the whole database restore back when the dump fails part-way", () => {
    const appDir = join(work, "app-db");
    mkdirSync(appDir);
    const result = runRestore(["database", failingDump], appDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toMatch(/division by zero/);
    expect(psql(url, "SELECT v FROM probe WHERE id = 1")).toBe("live-data");
    expect(psql(url, "SELECT to_regclass('public.created_after_backup') IS NOT NULL")).toBe("t");
  });

  it("does not replace application files when a FULL restore's database step fails", () => {
    const appDir = join(work, "app-full");
    mkdirSync(join(appDir, "data"), { recursive: true });
    writeFileSync(join(appDir, "data", "state.txt"), "live");
    const staged = join(work, "full-src");
    mkdirSync(join(staged, "data"), { recursive: true });
    writeFileSync(join(staged, "data", "state.txt"), "from-backup");
    writeFileSync(join(staged, "database.sql.gz"), readFileSync(failingDump));
    const archive = join(work, "full.tar.gz");
    const tar = spawnSync("tar", ["-czf", archive, "-C", staged, "data", "database.sql.gz"]);
    expect(tar.status).toBe(0);

    const result = runRestore(["full", archive, "all", appDir], appDir);
    expect(result.status).not.toBe(0);
    expect(readFileSync(join(appDir, "data", "state.txt"), "utf8")).toBe("live");
    expect(psql(url, "SELECT v FROM probe WHERE id = 1")).toBe("live-data");
  });

  it("restores the application's real migrated schema inside one transaction", () => {
    // The dump flags match scripts/backup.mjs; DATABASE_URL is the migrated test database.
    const source = spawnSync("pg_dump", [process.env.DATABASE_URL!, "--no-owner", "--no-privileges", "--clean", "--if-exists"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    expect(source.status, source.stderr).toBe(0);
    const dumpFile = join(work, "app-schema.sql.gz");
    writeFileSync(dumpFile, gzipSync(source.stdout));
    const scratch = `${database}_schema`;
    psql(adminUrl("postgres"), `CREATE DATABASE ${scratch}`);
    try {
      const scratchUrl = adminUrl(scratch);
      const appDir = join(work, "app-schema");
      mkdirSync(appDir);
      writeFileSync(join(work, ".env.schema"), `DATABASE_URL=${scratchUrl}\n`);
      const result = spawnSync(process.execPath, [RESTORE_SCRIPT, "database", dumpFile], {
        encoding: "utf8",
        env: restoreEnv(appDir, join(work, ".env.schema")),
      });
      expect(result.status, result.stderr).toBe(0);
      const countTables = (target: string) => psql(target, "SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public'");
      expect(Number(countTables(scratchUrl))).toBeGreaterThan(50);
      expect(countTables(scratchUrl)).toBe(countTables(process.env.DATABASE_URL!));
    } finally {
      psql(adminUrl("postgres"), `DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    }
  });

  it("refuses to import while another client is connected and changes nothing", async () => {
    const appDir = join(work, "app-online");
    mkdirSync(appDir);
    const goodDump = join(work, "good.sql.gz");
    const dump = spawnSync("pg_dump", [url, "--no-owner", "--no-privileges", "--clean", "--if-exists"], { encoding: "utf8" });
    writeFileSync(goodDump, gzipSync(dump.stdout.replace("live-data", "from-good-dump")));
    // A running web/worker process holds a pooled connection like this one.
    const app = new Client({ connectionString: url });
    await app.connect();
    try {
      const result = runRestore(["database", goodDump], appDir);
      expect(result.status).not.toBe(0);
      expect(result.stderr).toMatch(/OFFLINE RESTORE REQUIRED: 1 other client connection/);
      expect(psql(url, "SELECT v FROM probe WHERE id = 1")).toBe("live-data");
    } finally {
      await app.end();
    }
    // Once nothing else is connected the same restore goes through.
    const result = runRestore(["database", goodDump], appDir);
    expect(result.status, result.stderr).toBe(0);
    expect(psql(url, "SELECT v FROM probe WHERE id = 1")).toBe("from-good-dump");
  });

  it("makes a client that connects during the import wait and see only restored data", async () => {
    const scratch = `${database}_race`;
    psql(adminUrl("postgres"), `CREATE DATABASE ${scratch}`);
    const scratchUrl = adminUrl(scratch);
    try {
      psql(scratchUrl, "CREATE TABLE probe (id int PRIMARY KEY, v text); INSERT INTO probe VALUES (1, 'from-backup')");
      const dump = spawnSync("pg_dump", [scratchUrl, "--no-owner", "--no-privileges", "--clean", "--if-exists"], { encoding: "utf8" });
      psql(scratchUrl, "UPDATE probe SET v = 'live-data'");
      const slowDump = join(work, "slow.sql.gz");
      // Hold the import transaction open after its DROP/CREATE/COPY ran.
      writeFileSync(slowDump, gzipSync(`${dump.stdout}
SELECT pg_sleep(2);
`));
      writeFileSync(join(work, ".env.race"), `DATABASE_URL=${scratchUrl}
`);
      const appDir = join(work, "app-race");
      mkdirSync(appDir);
      const restore = spawn(process.execPath, [RESTORE_SCRIPT, "database", slowDump], { env: restoreEnv(appDir, join(work, ".env.race")) });
      const restored = new Promise<number | null>((resolveExit) => restore.on("close", resolveExit));
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 800));
      // A service started mid-restore: its first query blocks on the import's
      // locks and returns only after the commit — never the pre-restore row.
      const late = new Client({ connectionString: scratchUrl });
      await late.connect();
      const started = Date.now();
      const { rows } = await late.query("SELECT v FROM probe WHERE id = 1");
      const waitedMs = Date.now() - started;
      await late.end();
      expect(await restored).toBe(0);
      expect(rows[0]?.v).toBe("from-backup");
      expect(waitedMs).toBeGreaterThan(500);
    } finally {
      psql(adminUrl("postgres"), `DROP DATABASE IF EXISTS ${scratch} WITH (FORCE)`);
    }
  });
});
