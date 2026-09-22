#!/usr/bin/env node
/**
 * Cross-platform backup runner (Node implementation of deploy/backup.sh +
 * scripts/backup-db.sh) used on Windows hosts where bash/pg toolchain shell
 * wrappers are unavailable. POSIX deployments keep the original bash scripts.
 *
 * Modes:
 *   node scripts/backup.mjs [output.sql.gz]            — database backup
 *   node scripts/backup.mjs --files [output.tar.gz]    — data files backup
 *   node scripts/backup.mjs --full  [output.tar.gz]    — files + embedded db dump
 *
 * Env: APP_DIR, BACKUP_DIR, APP_NAME/APP_SLUG, BACKUP_RETENTION_DAYS,
 *      ENV_FILE, DATABASE_URL (or DATABASE_HOST/PORT/USER/PASSWORD/NAME),
 *      PG_INSTALL_DIR (extra pg_dump search root), TAR_BIN.
 * Exit codes mirror the bash scripts: 0 ok, 1 failure.
 */
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";

import {
  findBinary,
  findTar,
  makeLogger,
  pgConnection,
  readEnvFile,
  redactConnectionString,
  runBinary,
  timestamp,
} from "./lib/backup-common.mjs";

const { log, fail } = makeLogger("backup");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = process.env.APP_DIR?.trim() || path.resolve(SCRIPT_DIR, "..");
const ENV_FILE = process.env.ENV_FILE?.trim() || path.join(APP_DIR, ".env.local");
const APP_NAME = process.env.APP_NAME?.trim() || process.env.APP_SLUG?.trim() || "vcontrolhub";
const BACKUP_DIR = process.env.BACKUP_DIR?.trim() || path.join(APP_DIR, "backups");
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);

async function loadEnvFile() {
  // A missing env file is tolerated (defaults may come from the environment).
  return (await readEnvFile(ENV_FILE)) ?? {};
}

function resolveOutputPath(arg, mode) {
  if (!arg) {
    const suffix = mode === "database" ? ".sql.gz" : `_${mode}_${timestamp()}.tar.gz`;
    return mode === "database"
      ? path.join(BACKUP_DIR, `${APP_NAME}_${timestamp()}.sql.gz`)
      : path.join(BACKUP_DIR, `${APP_NAME}${suffix}`);
  }
  return path.isAbsolute(arg) ? arg : path.join(APP_DIR, arg);
}

async function dumpDatabase(outputPath, envFile) {
  const env = { ...process.env, ...envFile };
  const pgDump = await findBinary("pg_dump");
  if (!pgDump) fail("pg_dump not found. Install PostgreSQL client tools or set PG_INSTALL_DIR.");
  const { connArgs, childEnv } = pgConnection(env);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  log(`Starting database backup: ${outputPath}`);
  await new Promise((resolve, reject) => {
    const child = spawn(pgDump, [...connArgs, "--no-owner", "--no-privileges", "--clean", "--if-exists"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
    let stderr = "";
    const output = createWriteStream(outputPath, { mode: 0o600 });
    const gzip = createGzip();
    child.stdout.pipe(gzip).pipe(output);
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-16 * 1024);
    });
    child.on("error", reject);
    output.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) return;
      reject(new Error(`pg_dump exited with code ${code}: ${redactConnectionString(stderr).trim()}`));
    });
    output.on("finish", () => resolve());
  });
  const size = (await fs.stat(outputPath)).size;
  log(`Backup completed: ${outputPath} (${size} bytes)`);
}

async function pruneOldBackups(envFile) {
  const prefix = `${(process.env.APP_NAME || process.env.APP_SLUG || envFile.APP_SLUG || "vcontrolhub")}_`;
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  try {
    for (const entry of await fs.readdir(BACKUP_DIR)) {
      if (!entry.startsWith(prefix) || !entry.endsWith(".sql.gz")) continue;
      const full = path.join(BACKUP_DIR, entry);
      const info = await fs.stat(full).catch(() => null);
      if (info && info.mtimeMs < cutoff) {
        await fs.rm(full, { force: true });
        deleted += 1;
      }
    }
  } catch {
    // Pruning is best-effort, mirroring the bash script's tolerate-and-continue.
  }
  if (deleted > 0) log(`Cleaned up ${deleted} backup(s) older than ${RETENTION_DAYS} days`);
}

const FILES_MODE_PATHS = ["storage", "uploads", "downloads", "logs"];
const FULL_MODE_PATHS = [...FILES_MODE_PATHS, "public", "prisma", "package.json", "package-lock.json"];

async function archivePaths(outputPath, members, extraDir) {
  const tar = await findTar();
  const existing = [];
  for (const member of members) {
    await fs.access(path.join(APP_DIR, member)).then(() => existing.push(member)).catch(() => undefined);
  }
  if (existing.length === 0) fail(`No files found for backup under ${APP_DIR}`);
  const args = ["-czf", outputPath, "-C", APP_DIR, ...existing];
  if (extraDir) args.push("-C", extraDir, "database.sql.gz");
  await runBinary(tar, args);
  const size = (await fs.stat(outputPath)).size;
  log(`Completed backup: ${outputPath} (${size} bytes)`);
}

async function main() {
  const argv = process.argv.slice(2);
  let mode = "database";
  let positional = "";
  while (argv.length > 0) {
    const arg = argv.shift();
    if (arg === "--files") mode = "files";
    else if (arg === "--full") mode = "full";
    else if (arg === "--database") mode = "database";
    else if (arg) positional = arg;
  }

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  const envFile = await loadEnvFile();

  if (mode === "database") {
    const output = resolveOutputPath(positional, "sql.gz");
    await dumpDatabase(output, envFile);
    await pruneOldBackups(envFile);
    return;
  }

  const output = resolveOutputPath(positional, "tar.gz");
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (mode === "files") {
    log(`Starting files backup: ${output}`);
    await archivePaths(output, FILES_MODE_PATHS);
    return;
  }
  // full: stage the db dump beside the file set without archiving backups/ itself.
  log(`Starting full backup: ${output}`);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "vch-backup-full-"));
  try {
    await dumpDatabase(path.join(staging, "database.sql.gz"), envFile);
    await archivePaths(output, FULL_MODE_PATHS, staging);
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
