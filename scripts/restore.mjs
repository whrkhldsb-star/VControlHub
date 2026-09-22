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

import {
  findBinary,
  findTar,
  makeLogger,
  pgConnection,
  readEnvFile,
  redactConnectionString,
  runBinary,
} from "./lib/backup-common.mjs";

const { log, fail } = makeLogger("restore");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = process.env.APP_DIR?.trim() || path.resolve(SCRIPT_DIR, "..");
const ENV_FILE = process.env.ENV_FILE?.trim() || path.join(APP_DIR, ".env.local");

/** Unlike backup, a missing env file is fatal: restore needs the DB target. */
async function loadEnvFile() {
  const envFile = await readEnvFile(ENV_FILE);
  if (!envFile) fail(`Missing env file: ${ENV_FILE}`);
  return envFile;
}

async function restoreDatabase(backupFile, envFile) {
  if (process.env.CONFIRM_RESTORE !== "1") {
    fail("Restore is destructive. Re-run with CONFIRM_RESTORE=1 after taking a fresh backup.");
  }
  const env = { ...process.env, ...envFile };
  const psql = await findBinary("psql");
  if (!psql) fail("psql not found. Install PostgreSQL client tools or set PG_INSTALL_DIR.");
  const { connArgs, childEnv } = pgConnection(env);

  log(`Restoring ${backupFile} into configured database`);
  await new Promise((resolve, reject) => {
    const child = spawn(psql, connArgs, { stdio: ["pipe", "ignore", "pipe"], env: childEnv });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-16 * 1024);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql exited with code ${code}: ${redactConnectionString(stderr).trim()}`));
    });
    const source = createReadStream(backupFile);
    if (backupFile.endsWith(".gz")) {
      const gunzip = createGunzip();
      source.on("error", reject);
      gunzip.on("error", reject);
      source.pipe(gunzip).pipe(child.stdin);
    } else {
      source.on("error", reject);
      source.pipe(child.stdin);
    }
    child.stdin.on("error", reject);
  });
  log("Restore completed");
}

/** List member names via `tar -tzf`. */
async function listArchiveMembers(archive) {
  const tar = await findTar();
  const { stdout } = await runBinary(tar, ["-tzf", archive]);
  return stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

/** Verify every member is a plain file or directory (no links/specials). */
async function assertArchiveMemberTypes(archive) {
  const tar = await findTar();
  const { stdout } = await runBinary(tar, ["-tvzf", archive]);
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // GNU and bsdtar listing lines both begin with the entry type character.
    const typeChar = trimmed[0];
    if (typeChar !== "-" && typeChar !== "d") {
      fail("archive links and special files are not supported");
    }
  }
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

async function restoreFiles(archive, appDir) {
  if (!archive) fail("archive path is required");
  try { await fs.access(archive); } catch { fail(`archive not found: ${archive}`); }
  if (!appDir) fail("application directory is required");
  try {
    const info = await fs.stat(appDir);
    if (!info.isDirectory()) fail(`application directory not found: ${appDir}`);
  } catch {
    fail(`application directory not found: ${appDir}`);
  }

  const members = await listArchiveMembers(archive);
  assertSafeMemberNames(members);
  await assertArchiveMemberTypes(archive);

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

async function extractDatabaseMember(archive, targetDir) {
  const tar = await findTar();
  const target = path.join(targetDir, "database.sql.gz");
  await runBinary(tar, ["-xzf", archive, "-C", targetDir, "--no-same-owner", "database.sql.gz"]);
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
    const envFile = await loadEnvFile();
    await restoreDatabase(archive, envFile);
    return;
  }

  if (component === "files") {
    await restoreFiles(archive, appDirArg || APP_DIR);
    return;
  }

  // full
  const which = componentArg || "all";
  if (!["all", "database", "files"].includes(which)) fail(`invalid component: ${which}`);
  if (!archive) fail("archive path is required");
  try { await fs.access(archive); } catch { fail(`archive not found: ${archive}`); }

  const members = await listArchiveMembers(archive);
  const hasDatabase = members.some((member) => member === "database.sql.gz" || member === "./database.sql.gz");
  if (which !== "files" && !hasDatabase) {
    fail("legacy FULL archive does not contain database.sql.gz; choose files-only restore");
  }

  if (which === "files" || which === "all") {
    await restoreFiles(archive, appDirArg || APP_DIR);
  }
  if (which === "database" || which === "all") {
    const staging = await fs.mkdtemp(path.join(os.tmpdir(), "vch-restore-full-"));
    try {
      const databaseDump = await extractDatabaseMember(archive, staging);
      const envFile = await loadEnvFile();
      await restoreDatabase(databaseDump, envFile);
    } finally {
      await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
