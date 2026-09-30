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
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";

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
const MAX_BYTES = Number(process.env.BACKUP_MAX_BYTES ?? 0);
process.umask(0o077);

async function publishBackup(outputPath, write) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.partial-${randomUUID()}`;
  try {
    await write(temporary);
    await fs.chmod(temporary, 0o600);
    // Linking publishes a complete file atomically and refuses existing names.
    await fs.link(temporary, outputPath);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

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

  log(`Starting database backup: ${outputPath}`);
  await publishBackup(outputPath, async (temporary) => {
    const child = spawn(pgDump, [...connArgs, "--no-owner", "--no-privileges", "--clean", "--if-exists"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-16 * 1024);
    });
    const exited = new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => code === 0 ? resolve() : reject(new Error(`pg_dump exited with code ${code}: ${redactConnectionString(stderr).trim()}`)));
    });
    try {
      await Promise.all([
        exited,
        pipeline(child.stdout, createGzip(), createWriteStream(temporary, { flags: "wx", mode: 0o600 })),
      ]);
    } catch (error) {
      child.kill();
      throw error;
    }
  });
  const size = (await fs.stat(outputPath)).size;
  log(`Backup completed: ${outputPath} (${size} bytes)`);
}

async function pruneOldBackups(currentOutput) {
  const prefix = `${APP_NAME}_`;
  const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const managed = new RegExp(`^${escaped}(?:\\d{8}_\\d{6}\\.sql\\.gz|(?:files|full)_\\d{8}_\\d{6}\\.tar\\.gz)$`);
  const cutoff = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  let deleted = 0;
  const retained = [];
  try {
    for (const entry of await fs.readdir(BACKUP_DIR)) {
      if (!managed.test(entry)) continue;
      const full = path.join(BACKUP_DIR, entry);
      const info = await fs.lstat(full).catch(() => null);
      if (info?.isFile() && info.mtimeMs < cutoff) {
        await fs.rm(full, { force: true });
        deleted += 1;
      } else if (info?.isFile()) {
        retained.push({ full, size: info.size, mtimeMs: info.mtimeMs });
      }
    }
  } catch {
    // Pruning is best-effort, mirroring the bash script's tolerate-and-continue.
  }
  if (deleted > 0) log(`Cleaned up ${deleted} backup(s) older than ${RETENTION_DAYS} days`);
  if (MAX_BYTES > 0) {
    let total = retained.reduce((sum, item) => sum + item.size, 0);
    for (const item of retained.sort((a, b) => a.mtimeMs - b.mtimeMs)) {
      if (total <= MAX_BYTES) break;
      if (path.resolve(item.full) === path.resolve(currentOutput)) continue;
      await fs.rm(item.full);
      total -= item.size;
      log(`Removed old managed backup to enforce BACKUP_MAX_BYTES: ${item.full}`);
    }
    if (total > MAX_BYTES) log("Latest backup exceeds BACKUP_MAX_BYTES; preserved it for recovery. Increase backup capacity.");
  }
}

const FILES_MODE_PATHS = ["storage", "uploads", "downloads", "logs"];
const FULL_MODE_PATHS = [...FILES_MODE_PATHS, "public", "prisma", "package.json", "package-lock.json"];

async function archivePaths(outputPath, members, extraDir, envFile) {
  const tar = await findTar();
  const existing = [];
  for (const member of members) {
    await fs.access(path.join(APP_DIR, member)).then(() => existing.push(member)).catch(() => undefined);
  }
  if (existing.length === 0) fail(`No files found for backup under ${APP_DIR}`);
  const args = ["-czf", outputPath, "-C", APP_DIR, ...existing];
  if (extraDir) {
    args.push("-C", extraDir, "database.sql.gz");
    const extraPaths = JSON.parse(process.env.BACKUP_EXTRA_PATHS_JSON || envFile.BACKUP_EXTRA_PATHS_JSON || "[]");
    if (!Array.isArray(extraPaths) || extraPaths.some((entry) => typeof entry !== "string" || !path.isAbsolute(entry))) {
      throw new Error("BACKUP_EXTRA_PATHS_JSON must be an array of absolute paths");
    }
    const manifest = [];
    for (const entry of [...new Set(extraPaths)]) {
      const real = await fs.realpath(entry);
      const root = path.parse(real).root;
      const member = path.relative(root, real).split(path.sep).join("/");
      if (!member || members.some((name) => member === name || member.startsWith(`${name}/`)) || path.resolve(outputPath).startsWith(`${real}${path.sep}`)) {
        throw new Error("External backup path overlaps archive members or backup output");
      }
      args.push("-C", root, member);
      manifest.push({ source: real, member });
    }
    if (manifest.length) {
      await fs.writeFile(path.join(extraDir, "external-data.json"), JSON.stringify({ version: 1, paths: manifest }, null, 2), { mode: 0o600 });
      args.push("-C", extraDir, "external-data.json");
    }
    if ((process.env.BACKUP_INCLUDE_ENV || envFile.BACKUP_INCLUDE_ENV) === "true") {
      for (const name of [".env", ".env.local", ".env.runtime", ".env.production"]) {
        if (await fs.stat(path.join(APP_DIR, name)).then((info) => info.isFile()).catch(() => false)) args.push("-C", APP_DIR, name);
      }
    }
  }
  await runBinary(tar, args);
  const size = (await fs.stat(outputPath)).size;
  log(`Completed backup: ${outputPath} (${size} bytes)`);
}

async function main() {
  if (!Number.isSafeInteger(RETENTION_DAYS) || RETENTION_DAYS < 1 || RETENTION_DAYS > 3650) throw new Error("BACKUP_RETENTION_DAYS must be an integer from 1 to 3650");
  if (!Number.isSafeInteger(MAX_BYTES) || MAX_BYTES < 0) throw new Error("BACKUP_MAX_BYTES must be a nonnegative integer");
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
    // Mode, not extension: resolveOutputPath branches on "database" to emit
    // <app>_<ts>.sql.gz (a raw gzipped SQL dump). Passing "sql.gz" fell into
    // the archive branch and produced a misnamed .tar.gz that the retention
    // pruner never matches — so default DB backups accumulated forever.
    const output = resolveOutputPath(positional, "database");
    await dumpDatabase(output, envFile);
    await pruneOldBackups(output);
    return;
  }

  const output = resolveOutputPath(positional, mode === "full" ? "full" : "files");
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (mode === "files") {
    log(`Starting files backup: ${output}`);
    await publishBackup(output, (temporary) => archivePaths(temporary, FILES_MODE_PATHS));
    await pruneOldBackups(output);
    return;
  }
  // full: stage the db dump beside the file set without archiving backups/ itself.
  log(`Starting full backup: ${output}`);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "vch-backup-full-"));
  try {
    await dumpDatabase(path.join(staging, "database.sql.gz"), envFile);
    await publishBackup(output, (temporary) => archivePaths(temporary, FULL_MODE_PATHS, staging, envFile));
    await pruneOldBackups(output);
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
