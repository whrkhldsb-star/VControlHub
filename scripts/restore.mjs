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
 * Env: APP_DIR, ENV_FILE (default APP_DIR/.env.local), CONFIRM_RESTORE=1 for
 *      the destructive database step, PG_INSTALL_DIR, TAR_BIN.
 */
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { pipeline } from "node:stream/promises";

import {
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

async function prepareDatabaseRestore(appDir) {
  if (process.env.CONFIRM_RESTORE !== "1") {
    fail("Restore is destructive. Re-run with CONFIRM_RESTORE=1 after taking a fresh backup.");
  }
  const envFile = await loadEnvFile(appDir);
  const env = { ...process.env, ...envFile };
  const psql = await findBinary("psql");
  if (!psql) fail("psql not found. Install PostgreSQL client tools or set PG_INSTALL_DIR.");
  const { connArgs, childEnv } = pgConnection(env);
  return { psql, connArgs, childEnv };
}

async function restoreDatabase(backupFile, { psql, connArgs, childEnv }) {
  log(`Restoring ${backupFile} into configured database`);
  const child = spawn(psql, ["-v", "ON_ERROR_STOP=1", ...connArgs], { stdio: ["pipe", "ignore", "pipe"], env: childEnv });
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

async function restoreFiles(archive, appDir, inspected = false) {
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
    await fs.cp(path.join(staging, "."), appDir, { recursive: true, force: true });
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
  log(`Files restored to ${appDir}`);
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

  if (component === "database") {
    if (!archive) fail("backup file path is required");
    try { await fs.access(archive); } catch { fail(`Backup file not found: ${archive}`); }
    await restoreDatabase(archive, await prepareDatabaseRestore(APP_DIR));
    return;
  }

  if (component === "files") {
    await restoreFiles(archive, componentArg || APP_DIR);
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
  const databaseTarget = which === "files" ? null : await prepareDatabaseRestore(targetDir);
  if (which === "database" || which === "all") {
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "vch-restore-full-"));
    try {
      const databaseDump = await extractDatabaseMember(archive, staging, databaseMember);
      if (which === "all") await restoreFiles(archive, targetDir, true);
      await restoreDatabase(databaseDump, databaseTarget);
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  } else {
    await restoreFiles(archive, targetDir, true);
  }
}

main().catch((error) => {
  console.error(`[restore] ${redactConnectionString(error instanceof Error ? error.message : String(error))}`);
  process.exitCode = 1;
});
