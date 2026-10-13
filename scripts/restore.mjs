#!/usr/bin/env node
/**
 * Cross-platform restore runner (Node implementation of scripts/restore-db.sh,
 * restore-files.sh, restore-full.sh) used on Windows hosts.
 *
 * Usage:
 *   node scripts/restore.mjs database <backup.sql.gz>
 *   node scripts/restore.mjs files <files.tar.gz> <appDir>
 *   node scripts/restore.mjs full <full.tar.gz> <all|database|files> <appDir>
 *
 * Env: APP_DIR, ENV_FILE (default APP_DIR/.env.local), CONFIRM_RESTORE=1 (every
 *      component is destructive), PG_INSTALL_DIR, TAR_BIN,
 *      VCONTROLHUB_SERVICE_UNITS (systemd units that must be stopped; default
 *      "vcontrolhub-next vcontrolhub-worker vcontrolhub-ssh-ws").
 *
 * Restore is OFFLINE ONLY. Web requests, workers, agent callbacks, schedules
 * and terminal sessions all write to the database and the file tree; none of
 * them can be safely paused from inside the running platform. This runner
 * therefore refuses to start while the platform's systemd services are active,
 * and the database import itself begins (inside its single transaction) by
 * refusing if any other client is connected to the target database, so the
 * check cannot be raced. Files are copied only after the same checks pass
 * again. Restore runbook: docs/audit-verification-2026-10-12.zh-CN.md (R04).
 */
import { spawn, spawnSync } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";

import {
  acquireRestoreLock,
  findBinary,
  findTar,
  makeLogger,
  pgConnection,
  readEnvFile,
  redactConnectionString,
  runBinary,
} from "./lib/backup-common.mjs";

const { log } = makeLogger("restore");
function fail(message) { throw new Error(message); }
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = process.env.APP_DIR?.trim() || path.resolve(SCRIPT_DIR, "..");

/** Unlike backup, a missing env file is fatal: restore needs the DB target. */
async function loadEnvFile(appDir) {
  const file = process.env.ENV_FILE?.trim() || path.join(appDir, ".env.local");
  const envFile = await readEnvFile(file);
  if (!envFile) fail(`Missing env file: ${file}`);
  return envFile;
}

function assertRestoreConfirmed() {
  if (process.env.CONFIRM_RESTORE !== "1") {
    fail("Restore is destructive. Re-run with CONFIRM_RESTORE=1 after taking a fresh backup.");
  }
}

const OFFLINE_HINT = "Stop every VControlHub service (web, worker, SSH proxy) and any other database client, then retry; start the services again after the restore.";

/** systemd units of the platform; none may be running during a restore. */
async function assertPlatformServicesStopped() {
  const systemctl = process.platform === "win32" ? null : await findBinary("systemctl");
  if (!systemctl) return; // no systemd: the database client check below still applies
  const units = (process.env.VCONTROLHUB_SERVICE_UNITS ?? "vcontrolhub-next vcontrolhub-worker vcontrolhub-ssh-ws")
    .split(/[\s,]+/)
    .filter(Boolean);
  const running = [];
  for (const unit of units) {
    const state = (spawnSync(systemctl, ["is-active", unit], { encoding: "utf8" }).stdout || "").trim();
    if (["active", "activating", "reloading", "deactivating", "refreshing"].includes(state)) running.push(`${unit} (${state})`);
  }
  if (running.length > 0) fail(`OFFLINE RESTORE REQUIRED: ${running.join(", ")} still running. ${OFFLINE_HINT}`);
}

const OTHER_CLIENTS_SQL =
  "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'";

/**
 * First statement of the import transaction. A web/worker process (or another
 * restore) that is connected fails the whole transaction before anything is
 * dropped; one that connects later blocks on the dump's table locks until the
 * import committed, i.e. it only ever sees the restored data.
 */
const OFFLINE_GUARD_SQL = `DO $vch_offline$ DECLARE other integer; BEGIN
  ${OTHER_CLIENTS_SQL} INTO other;
  IF other > 0 THEN RAISE EXCEPTION 'OFFLINE RESTORE REQUIRED: % other client connection(s) to this database. ${OFFLINE_HINT}', other; END IF;
END $vch_offline$;
`;

/** Same check as a standalone query, for the file phase. */
async function assertNoOtherDatabaseClients({ psql, connArgs, childEnv }) {
  const { stdout } = await runBinary(psql, ["-X", "-q", "-t", "-A", "-c", OTHER_CLIENTS_SQL, ...connArgs], { env: childEnv });
  const other = Number.parseInt(stdout.trim(), 10);
  if (!Number.isInteger(other)) fail(`could not verify that the platform is offline (unexpected psql output: ${stdout.trim().slice(0, 200)})`);
  if (other > 0) fail(`OFFLINE RESTORE REQUIRED: ${other} other client connection(s) to the database. ${OFFLINE_HINT}`);
}

async function prepareDatabaseRestore(appDir) {
  assertRestoreConfirmed();
  const envFile = await loadEnvFile(appDir);
  const env = { ...process.env, ...envFile };
  const psql = await findBinary("psql");
  if (!psql) fail("psql not found. Install PostgreSQL client tools or set PG_INSTALL_DIR.");
  const { connArgs, childEnv } = pgConnection(env);
  return { psql, connArgs, childEnv };
}

async function restoreDatabase(backupFile, { psql, connArgs, childEnv }) {
  log(`Restoring ${backupFile} into configured database`);
  // --single-transaction (with `-f -`, which psql requires for it to apply to
  // stdin) makes the dump all-or-nothing. ON_ERROR_STOP alone stops at the
  // first error but leaves every DROP/CREATE/COPY before it committed, i.e. a
  // half-restored database.
  const child = spawn(psql, ["-X", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-", ...connArgs], { stdio: ["pipe", "ignore", "pipe"], env: childEnv });
  child.stdin.write(OFFLINE_GUARD_SQL);
  const source = createReadStream(backupFile);
  const gunzip = backupFile.endsWith(".gz") ? createGunzip() : null;
  const completed = new Promise((resolve, reject) => {
    // ON_ERROR_STOP: without it psql continues past SQL errors and exits 0, so
    // a truncated/corrupt dump would "restore" as a half-dropped half-restored
    // database while this tool reports success — the worst failure mode during
    // incident recovery.
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-16 * 1024);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited with code ${code}: ${redactConnectionString(stderr).trim()}`));
    });
  });
  try {
    await Promise.all([
      completed,
      gunzip ? pipeline(source, gunzip, child.stdin) : pipeline(source, child.stdin),
    ]);
  } finally {
    source.destroy();
    gunzip?.destroy();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await completed.catch(() => undefined);
  }
  log("Restore completed");
}

/** Scan the entire index; bounded diagnostic output must not truncate validation. */
async function scanArchiveLines(archive, flag, onLine) {
  const tar = await findTar();
  const child = spawn(tar, [flag, archive], { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr = (stderr + String(chunk)).slice(-16 * 1024); });
  const completed = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`tar exited with code ${code}: ${stderr.trim()}`)));
  });
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  try {
    await Promise.all([completed, (async () => {
      for await (const line of lines) if (line.trim()) onLine(line.trim());
    })()]);
  } finally {
    lines.close();
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await completed.catch(() => undefined);
  }
}

/** Verify every member is a plain file or directory (no links/specials). */
async function assertArchiveMemberTypes(archive) {
  await scanArchiveLines(archive, "-tvzf", (line) => {
    // GNU and bsdtar listing lines both begin with the entry type character.
    const typeChar = line[0];
    if (typeChar !== "-" && typeChar !== "d") {
      fail("archive links and special files are not supported");
    }
  });
}

async function inspectArchive(archive) {
  let databaseMember = null;
  await scanArchiveLines(archive, "-tzf", (member) => {
    assertSafeMemberNames([member]);
    if (member === "database.sql.gz" || member === "./database.sql.gz") databaseMember = member;
  });
  await assertArchiveMemberTypes(archive);
  return { databaseMember };
}

function assertSafeMemberNames(members) {
  for (const member of members) {
    const normalized = member.replace(/\\/g, "/");
    if (
      normalized.startsWith("/") ||
      normalized.startsWith("..") ||
      normalized.includes("/../") ||
      normalized.endsWith("/..") ||
      /^[A-Za-z]:/.test(normalized)
    ) {
      fail(`unsafe archive member: ${member}`);
    }
  }
}

async function containsNoSymlinks(root) {
  async function walk(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) fail(`archive contains a symbolic link: ${full}`);
      if (entry.isDirectory()) await walk(full);
    }
  }
  await walk(root);
}

/**
 * Extract and vet the archive's files in a private staging directory. Nothing
 * in appDir changes until {@link applyStagedFiles}.
 */
async function stageFiles(archive, appDir, inspected = false) {
  if (!archive) fail("archive path is required");
  try { await fs.access(archive); } catch { fail(`archive not found: ${archive}`); }
  if (!appDir) fail("application directory is required");
  try {
    const info = await fs.stat(appDir);
    if (!info.isDirectory()) fail(`application directory not found: ${appDir}`);
  } catch {
    fail(`application directory not found: ${appDir}`);
  }

  if (!inspected) await inspectArchive(archive);

  const tar = await findTar();
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "vch-restore-files-"));
  try {
    await runBinary(tar, ["-xzf", archive, "-C", staging, "--no-same-owner", "--exclude=database.sql.gz"]);
    await containsNoSymlinks(staging);
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  return staging;
}

/**
 * Overlay the staged files onto appDir. This merges: files created after the
 * backup are kept, files in the backup overwrite their current versions.
 */
async function applyStagedFiles(staging, appDir) {
  try {
    await fs.cp(path.join(staging, "."), appDir, { recursive: true, force: true });
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
  log(`Files restored to ${appDir}`);
}

async function restoreFiles(archive, appDir, databaseTarget, inspected = false) {
  const staged = await stageFiles(archive, appDir, inspected);
  try {
    await assertPlatformServicesStopped();
    await assertNoOtherDatabaseClients(databaseTarget);
  } catch (error) {
    await fs.rm(staged, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
  await applyStagedFiles(staged, appDir);
}

async function extractDatabaseMember(archive, targetDir, databaseMember) {
  const tar = await findTar();
  const target = path.join(targetDir, "database.sql.gz");
  await runBinary(tar, ["-xzf", archive, "-C", targetDir, "--no-same-owner", databaseMember]);
  try {
    await fs.access(target);
  } catch {
    fail("archive does not contain database.sql.gz");
  }
  return target;
}

async function main() {
  const [component, archive, componentArg, appDirArg] = process.argv.slice(2);
  if (!["database", "files", "full"].includes(component ?? "")) {
    fail("Usage: node scripts/restore.mjs <database|files|full> <archive> [component] [appDir]");
  }

  assertRestoreConfirmed();
  await assertPlatformServicesStopped();
  const releaseLock = await acquireRestoreLock(APP_DIR);
  const startedAt = new Date().toISOString();
  try {
    await runRestore(component, archive, componentArg, appDirArg);
    await appendRestoreHistory(archive, { component, which: componentArg ?? null, status: "COMPLETED", startedAt });
  } catch (error) {
    await appendRestoreHistory(archive, { component, which: componentArg ?? null, status: "FAILED", startedAt, error: redactConnectionString(error instanceof Error ? error.message : String(error)).slice(0, 2000) });
    throw error;
  } finally {
    await releaseLock();
  }
}

/** Outcome log next to the backup artifacts (outside the database being replaced). */
async function appendRestoreHistory(archive, entry) {
  if (!archive) return;
  const line = JSON.stringify({ ...entry, archive: path.basename(archive), finishedAt: new Date().toISOString() });
  await fs.appendFile(path.join(path.dirname(path.resolve(archive)), "restore-history.jsonl"), `${line}\n`).catch(() => undefined);
}

async function runRestore(component, archive, componentArg, appDirArg) {
  if (component === "database") {
    if (!archive) fail("backup file path is required");
    try { await fs.access(archive); } catch { fail(`Backup file not found: ${archive}`); }
    await restoreDatabase(archive, await prepareDatabaseRestore(APP_DIR));
    return;
  }

  if (component === "files") {
    const targetDir = componentArg || APP_DIR;
    await restoreFiles(archive, targetDir, await prepareDatabaseRestore(targetDir));
    return;
  }

  // full
  const which = componentArg || "all";
  if (!["all", "database", "files"].includes(which)) fail(`invalid component: ${which}`);
  if (!archive) fail("archive path is required");
  try { await fs.access(archive); } catch { fail(`archive not found: ${archive}`); }

  const { databaseMember } = await inspectArchive(archive);
  if (which !== "files" && !databaseMember) {
    fail("legacy FULL archive does not contain database.sql.gz; choose files-only restore");
  }

  const targetDir = appDirArg || APP_DIR;
  // Capture the destination configuration before restored .env files replace it.
  const databaseTarget = await prepareDatabaseRestore(targetDir);
  if (which === "database" || which === "all") {
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "vch-restore-full-"));
    let stagedFiles = null;
    try {
      const databaseDump = await extractDatabaseMember(archive, staging, databaseMember);
      // Everything that can fail without touching the live system runs first:
      // extract + vet the files, then the all-or-nothing database transaction.
      // Only after the database committed are the staged files copied in, so a
      // failing dump leaves both database and files exactly as they were.
      if (which === "all") stagedFiles = await stageFiles(archive, targetDir, true);
      await restoreDatabase(databaseDump, databaseTarget);
      if (stagedFiles) {
        const files = stagedFiles;
        stagedFiles = null;
        try {
          // The database transaction proved nothing else was connected when it
          // started; prove it again before the file phase, which no table lock
          // protects.
          await assertPlatformServicesStopped();
          await assertNoOtherDatabaseClients(databaseTarget);
          await applyStagedFiles(files, targetDir);
        } catch (error) {
          await fs.rm(files, { recursive: true, force: true }).catch(() => undefined);
          fail(`PARTIAL RESTORE: the database was restored but copying files into ${targetDir} failed (${error instanceof Error ? error.message : String(error)}). Restore the pre-restore safety snapshot or re-run a files-only restore.`);
        }
      }
    } finally {
      if (stagedFiles) await fs.rm(stagedFiles, { recursive: true, force: true }).catch(() => undefined);
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  } else {
    await restoreFiles(archive, targetDir, databaseTarget, true);
  }
}

main().catch((error) => {
  console.error(`[restore] ${redactConnectionString(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
