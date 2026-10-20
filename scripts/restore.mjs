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
 *      "vcontrolhub-next vcontrolhub-worker vcontrolhub-ssh-ws"; "none" when
 *      the platform is not run by systemd on this host — the operator then
 *      confirms that every instance is stopped).
 *
 * Restore is OFFLINE ONLY. Web requests, workers, agent callbacks, schedules
 * and terminal sessions all write to the database and the file tree; none of
 * them can be safely paused from inside the running platform. The operator
 * must stop every platform instance and keep it stopped until the restore has
 * finished. This runner checks that prerequisite; it cannot enforce it:
 *  - every listed systemd unit must be confirmed stopped (fails safe: a unit
 *    that is running, transitional, not found or whose state cannot be read,
 *    or a host without systemctl, refuses unless VCONTROLHUB_SERVICE_UNITS=none);
 *  - the database import begins, inside its single transaction, by refusing
 *    if any other client is connected to the target database, and the same
 *    check runs again before files are copied.
 * These are point-in-time checks. A client that connects after them (an
 * instance on another host, a custom unit name not listed, a manual start)
 * is not excluded; table locks taken by the import only cover the tables it
 * has already touched, and nothing fences the file phase.
 * Restore runbook: docs/audit-verification-2026-10-12.zh-CN.md (R04).
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

const DEPLOY_LOCK = process.env.DEPLOY_LOCK?.trim() || "/run/lock/vcontrolhub-deploy.lock";

/**
 * deploy.sh holds DEPLOY_LOCK for its whole run and keeps its PID in it (the
 * PID is cleared on release). Its artifact switch stops the services for a
 * moment, which would satisfy the service check below while a deployment is
 * half done; deploy.sh refuses to start over a restore lock in the same way.
 */
async function assertNoDeploymentRunning() {
  const content = await fs.readFile(DEPLOY_LOCK, "utf8").catch(() => "");
  const pid = Number.parseInt(content.trim(), 10);
  if (!Number.isInteger(pid) || pid <= 0) return;
  let alive = true;
  try {
    process.kill(pid, 0);
  } catch (error) {
    alive = error?.code === "EPERM";
  }
  if (alive) fail(`a deployment is running (deploy.sh pid ${pid} holds ${DEPLOY_LOCK}); wait for it to finish before restoring`);
}

const DEFAULT_SERVICE_UNITS = "vcontrolhub-next vcontrolhub-worker vcontrolhub-ssh-ws";
const NON_SYSTEMD_HINT = "If the platform does not run under systemd on this host, stop every instance yourself and re-run with VCONTROLHUB_SERVICE_UNITS=none.";
// Only these mean "not running". Running and transitional states, "unknown",
// errors and missing output all mean the stop cannot be confirmed.
const STOPPED_ACTIVE_STATES = new Set(["inactive", "failed"]);
const KNOWN_LOAD_STATES = new Set(["loaded", "masked"]);

/**
 * The platform's systemd units; none may be running during a restore. Fails
 * safe: anything but a unit positively reported as stopped refuses. A unit
 * systemd does not know ("not-found") refuses too — with other unit names the
 * default list would otherwise pass while the real units keep running.
 */
async function assertPlatformServicesStopped() {
  const configured = process.env.VCONTROLHUB_SERVICE_UNITS;
  if (configured?.trim().toLowerCase() === "none") {
    log("VCONTROLHUB_SERVICE_UNITS=none: no service-manager check; the operator confirmed every platform instance is stopped.");
    return;
  }
  const units = (configured ?? DEFAULT_SERVICE_UNITS).split(/[\s,]+/).filter(Boolean);
  if (units.length === 0) fail(`VCONTROLHUB_SERVICE_UNITS is empty. List the platform's systemd units. ${NON_SYSTEMD_HINT}`);
  const systemctl = process.platform === "win32" ? null : await findBinary("systemctl");
  if (!systemctl) fail(`OFFLINE RESTORE REQUIRED: cannot confirm that ${units.join(", ")} are stopped (systemctl not available). ${NON_SYSTEMD_HINT}`);
  const unconfirmed = [];
  for (const unit of units) {
    const result = spawnSync(systemctl, ["show", "-p", "LoadState", "-p", "ActiveState", "--", unit], { encoding: "utf8" });
    const properties = Object.fromEntries(
      (result.error || result.status !== 0 ? "" : result.stdout || "")
        .split(/\r?\n/)
        .map((line) => line.split("="))
        .filter((pair) => pair.length === 2),
    );
    const { LoadState: load, ActiveState: active } = properties;
    if (!KNOWN_LOAD_STATES.has(load)) unconfirmed.push(`${unit} (${load || "state unknown"})`);
    else if (!STOPPED_ACTIVE_STATES.has(active)) unconfirmed.push(`${unit} (${active || "state unknown"})`);
  }
  if (unconfirmed.length > 0) {
    fail(`OFFLINE RESTORE REQUIRED: ${unconfirmed.join(", ")} not confirmed stopped. ${OFFLINE_HINT} ${NON_SYSTEMD_HINT}`);
  }
}

const OTHER_CLIENTS_SQL =
  "SELECT count(*) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid() AND backend_type = 'client backend'";

/**
 * First statement of the import transaction. A web/worker process (or another
 * restore) that is connected fails the whole transaction before anything is
 * dropped. This is a point-in-time check, not a fence: a client that connects
 * afterwards is not refused (it only waits on tables the import has already
 * locked). Keeping every instance stopped remains the operator's job.
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
 * A FULL archive also carries the code of the version that made it, as a
 * record of that version. Laid over this installation it mixed an older
 * service worker, schema and package manifest into newer code, and left the
 * git checkout modified so the next deploy's fast-forward refused to run.
 */
const CODE_MEMBERS = ["public", "prisma", "package.json", "package-lock.json"];

async function removeStagedMember(staging, member) {
  const target = path.resolve(staging, member);
  if (!target.startsWith(`${staging}${path.sep}`)) return;
  await fs.rm(target, { recursive: true, force: true });
  // Drop the parents the member leaves empty (an external path's root dirs).
  for (let dir = path.dirname(target); dir.startsWith(`${staging}${path.sep}`); dir = path.dirname(dir)) {
    try { await fs.rmdir(dir); } catch { break; }
  }
}

/**
 * Keep only data in the staging directory. The installation's own code stays,
 * and data from outside the application directory (BACKUP_EXTRA_PATHS_JSON,
 * listed in external-data.json) is not copied in under the application
 * directory: as documented, the administrator restores it to a location they
 * choose. It used to land at <appDir>/<path without its root>, where nothing
 * reads it and where it can fill the application's disk.
 */
async function dropNonDataMembers(staging) {
  const manifestFile = path.join(staging, "external-data.json");
  if (await pathExists(manifestFile)) {
    let manifest;
    try { manifest = JSON.parse(await fs.readFile(manifestFile, "utf8")); } catch { fail("external-data.json in the archive is not valid JSON"); }
    for (const entry of Array.isArray(manifest?.paths) ? manifest.paths : []) {
      if (typeof entry?.member !== "string" || !entry.member) continue;
      await removeStagedMember(staging, entry.member);
      log(`Not restored here: ${entry.source ?? "external data"} (archive member ${entry.member}); extract it from the archive to the location you choose`);
    }
    await fs.rm(manifestFile, { force: true });
  }
  const kept = [];
  for (const name of CODE_MEMBERS) {
    if (!(await pathExists(path.join(staging, name)))) continue;
    await fs.rm(path.join(staging, name), { recursive: true, force: true });
    kept.push(name);
  }
  if (kept.length > 0) log(`Kept this installation's own ${kept.join(", ")}; the archive's copies are the code of the version that made it`);
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
    await dropNonDataMembers(staging);
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

async function pathExists(target) {
  try { await fs.access(target); return true; } catch { return false; }
}

/**
 * A backup made by an older version restores that version's schema and
 * migration history with it. The code about to start expects every migration
 * this installation ships, and the roles and permissions deploy.sh syncs right
 * after migrating: started on the old schema, the platform failed on each
 * missing column. Run the same two steps here, against the database just
 * restored. A directory without migrations is not an installation (a restore
 * into a scratch directory): say what to run instead.
 */
async function upgradeRestoredDatabase({ childEnv }) {
  const prismaCli = path.join(APP_DIR, "node_modules", "prisma", "build", "index.js");
  const migrations = path.join(APP_DIR, "prisma", "migrations");
  const manual = `run "npx prisma migrate deploy" and "node dist/seed.js" in the installation directory before starting the platform`;
  if (!(await pathExists(prismaCli)) || !(await pathExists(migrations)) || !childEnv.DATABASE_URL) {
    log(`No Prisma migrations or DATABASE_URL for ${APP_DIR}; the schema was not upgraded: ${manual}.`);
    return;
  }
  try {
    log("Applying this installation's database migrations to the restored database");
    await runBinary(process.execPath, [prismaCli, "migrate", "deploy"], { cwd: APP_DIR, env: childEnv });
    const seed = path.join(APP_DIR, "dist", "seed.js");
    if (await pathExists(seed)) {
      log("Syncing roles and permissions");
      // The environment deploy.sh seeds with (.env.runtime when present), on
      // the database just restored.
      const runtimeEnv = (await readEnvFile(path.join(APP_DIR, ".env.runtime"))) ?? {};
      await runBinary(process.execPath, [seed], { cwd: APP_DIR, env: { ...childEnv, ...runtimeEnv, DATABASE_URL: childEnv.DATABASE_URL } });
    } else {
      log(`No ${seed}: run the role and permission sync before starting the platform.`);
    }
  } catch (error) {
    fail(`DATABASE RESTORED, NOT UPGRADED: ${error instanceof Error ? error.message : String(error)}. The restored schema may be older than this installation: ${manual}.`);
  }
}

async function main() {
  const [component, archive, componentArg, appDirArg] = process.argv.slice(2);
  if (!["database", "files", "full"].includes(component ?? "")) {
    fail("Usage: node scripts/restore.mjs <database|files|full> <archive> [component] [appDir]");
  }

  assertRestoreConfirmed();
  // Take the restore lock before looking for a deployment: deploy.sh takes
  // its lock first and then checks for ours, so with the same order on both
  // sides one of the two always sees the other.
  const releaseLock = await acquireRestoreLock(APP_DIR);
  try {
    await assertNoDeploymentRunning();
    await assertPlatformServicesStopped();
  } catch (error) {
    await releaseLock();
    throw error;
  }
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
    const databaseTarget = await prepareDatabaseRestore(APP_DIR);
    await restoreDatabase(archive, databaseTarget);
    await upgradeRestoredDatabase(databaseTarget);
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
      await upgradeRestoredDatabase(databaseTarget);
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
