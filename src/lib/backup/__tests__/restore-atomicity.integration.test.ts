import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chownSync, statSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { gzipSync } from "node:zlib";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

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

const REPO_ROOT = resolve(__dirname, "../../../..");
const RESTORE_SCRIPT = resolve(REPO_ROOT, "scripts/restore.mjs");

function adminUrl(database: string) {
  const url = new URL(process.env.DATABASE_URL!);
  url.pathname = `/${database}`;
  url.search = "";
  return url.toString();
}

function seedRestoreIdentity(url: string) {
  psql(url, `CREATE TABLE "User" (id int); INSERT INTO "User" VALUES (1);
    CREATE TABLE "Role" (id int); INSERT INTO "Role" VALUES (1);
    CREATE TABLE "StorageNode" (id int); CREATE TABLE servers (id int)`);
}

// CI migrates an empty database. Give its backup the minimum data of an
// installed instance without modifying the database shared by other suites.
const installedRows = `
  INSERT INTO public."User" (id, username, "passwordHash", "updatedAt")
    SELECT 'restore-fixture', 'restore-fixture', 'disabled', now() WHERE NOT EXISTS (SELECT FROM public."User");
  INSERT INTO public."Role" (id, key, name, "updatedAt")
    SELECT 'restore-fixture', 'restore-fixture', 'Fixture', now() WHERE NOT EXISTS (SELECT FROM public."Role");
`;

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
    seedRestoreIdentity(url);
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
    mkdirSync(join(appDir, "storage"), { recursive: true });
    writeFileSync(join(appDir, "storage", "state.txt"), "live");
    const staged = join(work, "full-src");
    mkdirSync(join(staged, "storage"), { recursive: true });
    writeFileSync(join(staged, "storage", "state.txt"), "from-backup");
    writeFileSync(join(staged, "database.sql.gz"), readFileSync(failingDump));
    const archive = join(work, "full.tar.gz");
    const tar = spawnSync("tar", ["-czf", archive, "-C", staged, "storage", "database.sql.gz"]);
    expect(tar.status).toBe(0);

    const result = runRestore(["full", archive, "all", appDir], appDir);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("division by zero");
    expect(readFileSync(join(appDir, "storage", "state.txt"), "utf8")).toBe("live");
    expect(psql(url, "SELECT v FROM probe WHERE id = 1")).toBe("live-data");
  });

  it.each(["files", "full"])("restores nested database filenames and preserves the target key during %s file recovery", (kind) => {
    const source = join(work, "source-" + kind);
    const target = join(work, "target-" + kind);
    const archive = join(work, kind + "-members.tar.gz");
    mkdirSync(join(source, "storage", "customer"), { recursive: true });
    mkdirSync(target);
    writeFileSync(join(target, "target-restore.env"), "DATABASE_URL=" + url + "\n");
    writeFileSync(join(source, "storage", "customer", "database.sql.gz"), "customer data");
    writeFileSync(join(source, ".env.local"), "ENCRYPTION_KEY=archive-key\n");
    writeFileSync(join(target, ".env.local"), "ENCRYPTION_KEY=live-key\n");
    const members = ["storage", ".env.local"];
    if (kind === "full") {
      writeFileSync(join(source, "database.sql.gz"), readFileSync(failingDump));
      members.push("database.sql.gz");
    }
    expect(spawnSync("tar", ["-czf", archive, "-C", source, ...members]).status).toBe(0);
    const args = [kind, archive, ...(kind === "full" ? ["files"] : []), target];
    const restore = (fingerprint?: string) => spawnSync(process.execPath, [RESTORE_SCRIPT, ...args], {
      encoding: "utf8", env: { ...restoreEnv(work, "target-restore.env"), RESTORE_DATABASE_KEY_SHA256: fingerprint },
    });
    const result = restore();
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(target, "storage", "customer", "database.sql.gz"), "utf8")).toBe("customer data");
    expect(readFileSync(join(target, ".env.local"), "utf8")).toContain("live-key");
    expect(restore("0".repeat(64)).status).not.toBe(0);
    expect(readFileSync(join(target, ".env.local"), "utf8")).toContain("live-key");
    expect(restore(createHash("sha256").update("archive-key").digest("hex")).status).toBe(0);
    expect(readFileSync(join(target, ".env.local"), "utf8")).toContain("archive-key");
  });

  it.skipIf(process.getuid?.() !== 0)("changes ownership only for restored paths", () => {
    const source = join(work, "owner-source");
    const target = join(work, "owner-target");
    const archive = join(work, "owner-files.tar.gz");
    for (const dir of [source, target]) mkdirSync(join(dir, "uploads"), { recursive: true });
    writeFileSync(join(target, "uploads", "existing"), "preserve");
    writeFileSync(join(source, "uploads", "restored"), "restore");
    chownSync(target, 65534, 65534);
    expect(spawnSync("tar", ["-czf", archive, "-C", source, "uploads"]).status).toBe(0);
    const result = runRestore(["files", archive, target], work);
    expect(result.status, result.stderr).toBe(0);
    expect(statSync(join(target, "uploads", "restored")).uid).toBe(65534);
    expect(statSync(join(target, "uploads", "existing")).uid).toBe(0);
  });

  it("locks the explicit destination even when invoked from a different installation", () => {
    const target = join(work, "locked-target");
    mkdirSync(join(target, ".restore.lock"), { recursive: true });
    writeFileSync(join(target, ".restore.lock", "owner"), "pid=" + process.pid + "\nhost=" + hostname() + "\n");
    expect(runRestore(["files", failingDump, target], work).stderr).toMatch(/lock/i);
    expect(readFileSync(join(target, ".restore.lock", "owner"), "utf8")).toContain("pid=" + process.pid);
  });

  it("restores history from a whole data root to the target installation's configured history directory", () => {
    const source = join(work, "version-source");
    const target = join(work, "version-target");
    const archive = join(work, "versions.tar.gz");
    mkdirSync(join(source, "uploads"), { recursive: true });
    mkdirSync(target);
    writeFileSync(join(source, "uploads", "body"), "historical content");
    writeFileSync(join(source, "file-versions.json"), JSON.stringify({ version: 1, member: "uploads", source: join(source, "uploads") }));
    writeFileSync(join(target, "history.env"), "DATABASE_URL=" + url + "\nFILE_VERSION_DIR=local-history\n");
    expect(spawnSync("tar", ["-czf", archive, "-C", source, "uploads", "file-versions.json"]).status).toBe(0);
    const result = spawnSync(process.execPath, [RESTORE_SCRIPT, "files", archive, target], { encoding: "utf8", env: restoreEnv(work, "history.env") });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(join(target, "local-history", "body"), "utf8")).toBe("historical content");
  });

  it("backs up and restores a quoted non-public application schema without resetting public", () => {
    const scratch = database + "_custom";
    psql(adminUrl("postgres"), "CREATE DATABASE " + scratch);
    try {
      const conn = adminUrl(scratch);
      const install = join(work, "custom-install");
      mkdirSync(install);
      const schema = "Application Data";
      const withSchema = new URL(conn);
      withSchema.searchParams.set("schema", schema);
      const envFile = join(install, ".env.local");
      writeFileSync(envFile, "DATABASE_URL=" + withSchema.toString() + "\n");
      const env = { ...restoreEnv(install, envFile), DATABASE_URL: withSchema.toString() };
      psql(conn, 'CREATE SCHEMA "Application Data"; SET search_path = "Application Data"; CREATE TABLE "User"(id int); INSERT INTO "User" VALUES (1); CREATE TABLE "Role"(id int); INSERT INTO "Role" VALUES (1); CREATE TABLE "StorageNode"(id int); CREATE TABLE servers(id int); CREATE TABLE public.outside_app(id int)');
      const archive = join(work, "custom.sql.gz");
      const backup = spawnSync(process.execPath, [join(REPO_ROOT, "scripts/backup.mjs"), archive], { encoding: "utf8", env });
      expect(backup.status, backup.stderr).toBe(0);
      psql(conn, 'DELETE FROM "Application Data"."User"; CREATE TABLE "Application Data".extra(id int); INSERT INTO public.outside_app VALUES (7)');
      const restored = spawnSync(process.execPath, [RESTORE_SCRIPT, "database", archive], { encoding: "utf8", env });
      expect(restored.status, restored.stderr).toBe(0);
      expect(psql(conn, 'SELECT id FROM "Application Data"."User"')).toBe("1");
      expect(psql(conn, "SELECT id FROM public.outside_app")).toBe("7");
      expect(psql(conn, "SELECT count(*) FROM pg_tables WHERE schemaname = 'Application Data' AND tablename = 'extra'")).toBe("0");
    } finally {
      psql(adminUrl("postgres"), "DROP DATABASE " + scratch + " WITH (FORCE)");
    }
  });

  it("restores the application's real migrated schema inside one transaction", () => {
    // The dump flags match scripts/backup.mjs; DATABASE_URL is the migrated test database.
    const source = spawnSync("pg_dump", [process.env.DATABASE_URL!, "--no-owner", "--no-privileges", "--clean", "--if-exists"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    expect(source.status, source.stderr).toBe(0);
    const dumpFile = join(work, "app-schema.sql.gz");
    writeFileSync(dumpFile, gzipSync(source.stdout + installedRows));
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

  it("brings a backup from an older version up to this installation's schema", (ctx) => {
    // Needs a migrated source database: one made with `db push` has no history.
    if (psql(process.env.DATABASE_URL!, "SELECT to_regclass('public._prisma_migrations') IS NOT NULL") !== "t") ctx.skip();
    // A backup taken before the newest migration: its schema lacks that
    // migration's column and its history lacks the row. Restored as it was,
    // the platform started on it and failed on the missing column.
    const older = `${database}_older`;
    const target = `${database}_upgrade`;
    psql(adminUrl("postgres"), `CREATE DATABASE ${older}`);
    psql(adminUrl("postgres"), `CREATE DATABASE ${target}`);
    try {
      const dumpOf = (source: string) => {
        const dump = spawnSync("pg_dump", [source, "--no-owner", "--no-privileges", "--clean", "--if-exists"], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
        expect(dump.status, dump.stderr).toBe(0);
        return dump.stdout;
      };
      const load = spawnSync("psql", ["-X", "-q", "-v", "ON_ERROR_STOP=1", adminUrl(older)], { input: dumpOf(process.env.DATABASE_URL!), encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
      expect(load.status, load.stderr).toBe(0);
      psql(adminUrl(older), installedRows);
      psql(adminUrl(older), `ALTER TABLE "settings" DROP COLUMN "updatedBy"; DELETE FROM "_prisma_migrations" WHERE migration_name = '20261020090000_setting_updated_by'`);
      const dumpFile = join(work, "older.sql.gz");
      writeFileSync(dumpFile, gzipSync(dumpOf(adminUrl(older))));
      // An installation: this checkout's migrations and Prisma CLI.
      const appDir = join(work, "app-upgrade");
      mkdirSync(appDir);
      for (const entry of ["prisma", "node_modules", "prisma.config.ts", "package.json"]) symlinkSync(resolve(REPO_ROOT, entry), join(appDir, entry));
      writeFileSync(join(work, ".env.upgrade"), `DATABASE_URL=${adminUrl(target)}\n`);

      const result = spawnSync(process.execPath, [RESTORE_SCRIPT, "database", dumpFile], { encoding: "utf8", env: restoreEnv(appDir, join(work, ".env.upgrade")) });

      expect(result.status, result.stderr).toBe(0);
      expect(psql(adminUrl(target), `SELECT count(*) FROM information_schema.columns WHERE table_name = 'settings' AND column_name = 'updatedBy'`)).toBe("1");
      expect(psql(adminUrl(target), `SELECT count(*) FROM "_prisma_migrations" WHERE migration_name = '20261020090000_setting_updated_by' AND finished_at IS NOT NULL`)).toBe("1");
    } finally {
      psql(adminUrl("postgres"), `DROP DATABASE IF EXISTS ${older} WITH (FORCE)`);
      psql(adminUrl("postgres"), `DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);
    }
  }, 120_000);

  it("restores an older backup over tables and types created after it", () => {
    // A --clean dump drops only what it contains. A newer table referencing
    // an older one made the whole restore fail ("other objects depend on
    // it"); newer tables and types without one stayed with today's rows and
    // then refused the upgrade's own CREATE.
    const scratch = `${database}_newer`;
    psql(adminUrl("postgres"), `CREATE DATABASE ${scratch}`);
    const scratchUrl = adminUrl(scratch);
    try {
      seedRestoreIdentity(scratchUrl);
      psql(scratchUrl, "CREATE TABLE parent (id int PRIMARY KEY, v text); INSERT INTO parent VALUES (1, 'from-backup')");
      const dump = spawnSync("pg_dump", [scratchUrl, "--no-owner", "--no-privileges", "--clean", "--if-exists"], { encoding: "utf8" });
      expect(dump.status, dump.stderr).toBe(0);
      const olderDump = join(work, "older-than-tables.sql.gz");
      writeFileSync(olderDump, gzipSync(dump.stdout));
      psql(scratchUrl, "UPDATE parent SET v = 'live-data'; CREATE TABLE child (id int PRIMARY KEY, parent_id int REFERENCES parent(id)); INSERT INTO child VALUES (1, 1); CREATE TABLE loose (id int); CREATE TYPE mood AS ENUM ('ok')");
      writeFileSync(join(work, ".env.newer"), `DATABASE_URL=${scratchUrl}\n`);
      const appDir = join(work, "app-newer");
      mkdirSync(appDir);

      const result = spawnSync(process.execPath, [RESTORE_SCRIPT, "database", olderDump], { encoding: "utf8", env: restoreEnv(appDir, join(work, ".env.newer")) });

      expect(result.status, result.stderr).toBe(0);
      expect(psql(scratchUrl, "SELECT v FROM parent WHERE id = 1")).toBe("from-backup");
      expect(psql(scratchUrl, "SELECT to_regclass('public.child') IS NULL AND to_regclass('public.loose') IS NULL AND to_regtype('public.mood') IS NULL")).toBe("t");
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
      seedRestoreIdentity(scratchUrl);
      psql(scratchUrl, "CREATE TABLE probe (id int PRIMARY KEY, v text); INSERT INTO probe VALUES (1, 'from-backup')");
      const dump = spawnSync("pg_dump", [scratchUrl, "--no-owner", "--no-privileges", "--clean", "--if-exists"], { encoding: "utf8" });
      psql(scratchUrl, "UPDATE probe SET v = 'live-data'");
      const slowDump = join(work, "slow.sql.gz");
      // Hold the import transaction open after its DROP/CREATE/COPY ran.
      writeFileSync(slowDump, gzipSync(`${dump.stdout}
SELECT pg_sleep(3);
`));
      writeFileSync(join(work, ".env.race"), `DATABASE_URL=${scratchUrl}
`);
      const appDir = join(work, "app-race");
      mkdirSync(appDir);
      const restore = spawn(process.execPath, [RESTORE_SCRIPT, "database", slowDump], { env: restoreEnv(appDir, join(work, ".env.race")) });
      const restored = new Promise<number | null>((resolveExit) => restore.on("close", resolveExit));
      // Startup time varies with system load. Observe the import holding the
      // target locks from another database so our probe passes the offline guard.
      const observer = new Client({ connectionString: adminUrl("postgres") });
      await observer.connect();
      try {
        await vi.waitFor(async () => {
          const { rows } = await observer.query(
            "SELECT 1 FROM pg_stat_activity WHERE datname = $1 AND wait_event = 'PgSleep'", [scratch],
          );
          expect(rows).toHaveLength(1);
        }, { timeout: 30_000, interval: 30 });
      } finally {
        await observer.end();
      }
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
