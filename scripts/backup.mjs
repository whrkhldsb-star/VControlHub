#!/usr/bin/env node
/**
 * Cross-platform backup runner, also used by the Linux compatibility wrappers
 * deploy/backup.sh and scripts/backup-db.sh. All entrypoints share atomic
 * publication, retention and PostgreSQL credential handling.
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
import { createWriteStream, rmSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { createInterface } from "node:readline";

import {
  applicationSchema,
  pgDumpSchemaArgs,
  RESTORE_DATA_ROOTS,
  findBinary,
  findTar,
  makeLogger,
  pgConnection,
  readEnvFile,
  redactConnectionString,
  hasLiveRestoreLock,
  runBinary,
  timestamp,
  fileVersionDir,
  FILE_VERSIONS_MANIFEST,
  ENV_MEMBERS,
  INTEGRITY_MANIFEST,
} from "./lib/backup-common.mjs";

import { expectedArchiveFiles, verifyArchiveFiles } from "./lib/backup-file-integrity.mjs";

const { log, fail } = makeLogger("backup");
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const APP_DIR = process.env.APP_DIR?.trim() || path.resolve(SCRIPT_DIR, "..");
const ENV_FILE = process.env.ENV_FILE?.trim() || path.join(APP_DIR, ".env.local");
const APP_NAME = process.env.APP_NAME?.trim() || process.env.APP_SLUG?.trim() || "vcontrolhub";
const BACKUP_DIR = process.env.BACKUP_DIR?.trim() || path.join(APP_DIR, "backups");
const RETENTION_DAYS = Number(process.env.BACKUP_RETENTION_DAYS ?? 30);
const MAX_BYTES = Number(process.env.BACKUP_MAX_BYTES ?? 0);
process.umask(0o077);

const PARTIAL_SWEEP_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const activeChildren = new Set();
const activeTempPaths = new Set();

function trackChild(child) {
  activeChildren.add(child);
  const untrack = () => activeChildren.delete(child);
  child.once("exit", untrack);
  child.once("close", untrack);
  child.once("error", untrack);
  return child;
}

function cleanupOnSignal(signal) {
  for (const child of activeChildren) {
    try {
      child.kill("SIGTERM");
    } catch {
      // Best-effort child shutdown.
    }
  }
  for (const tempPath of activeTempPaths) {
    try {
      rmSync(tempPath, { recursive: true, force: true });
    } catch {
      // Best-effort temp cleanup.
    }
  }
  const code = signal === "SIGINT" ? 130 : signal === "SIGHUP" ? 129 : 143;
  process.exit(code);
}

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => cleanupOnSignal(signal));
}

async function publishBackup(outputPath, write) {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const temporary = `${outputPath}.partial-${randomUUID()}`;
  activeTempPaths.add(temporary);
  try {
    await write(temporary);
    await fs.chmod(temporary, 0o600);
    // Linking publishes a complete file atomically and refuses existing names.
    await fs.link(temporary, outputPath);
  } finally {
    activeTempPaths.delete(temporary);
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

async function dumpDatabase(outputPath, env, embedded = false) {
  const pgDump = await findBinary("pg_dump");
  if (!pgDump) fail("pg_dump not found. Install PostgreSQL client tools or set PG_INSTALL_DIR.");
  const { connArgs, childEnv } = pgConnection(env);

  log(`Starting database backup: ${outputPath}`);
  await publishBackup(outputPath, async (temporary) => {
    const schema = applicationSchema(env);
    const schemaArgs = pgDumpSchemaArgs(schema);
    const child = trackChild(spawn(pgDump, [...connArgs, ...schemaArgs, "--no-owner", "--no-privileges", "--clean", "--if-exists"], {
      stdio: ["ignore", "pipe", "pipe"],
      env: childEnv,
    }));
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
        pipeline(child.stdout, async function* (chunks) {
          if (!embedded) yield "-- VControlHub application schema " + Buffer.from(applicationSchema(env)).toString("hex") + "\n";
          yield* chunks;
        }, createGzip(), createWriteStream(temporary, { flags: "wx", mode: 0o600 })),
      ]);
    } catch (error) {
      child.kill();
      throw error;
    }
  });
  const size = (await fs.stat(outputPath)).size;
  log(`Backup completed: ${outputPath} (${size} bytes)`);
}

async function sweepStalePartials(dirs) {
  const staleCutoff = Date.now() - PARTIAL_SWEEP_MAX_AGE_MS;
  for (const dir of new Set(dirs.filter(Boolean))) {
    try {
      for (const entry of await fs.readdir(dir)) {
        if (!/\.partial-[0-9a-f-]{8,}$/i.test(entry)) continue;
        const full = path.join(dir, entry);
        if (activeTempPaths.has(full)) continue;
        const info = await fs.lstat(full).catch(() => null);
        if (info?.isFile() && info.mtimeMs < staleCutoff) {
          await fs.rm(full, { force: true });
          log(`Swept stale interrupted backup partial: ${full}`);
        }
      }
    } catch {
      // Best-effort sweep.
    }
  }
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
        await fs.rm(`${full}.offsite.json`, { force: true });
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
      await fs.rm(`${item.full}.offsite.json`, { force: true });
      total -= item.size;
      log(`Removed old managed backup to enforce BACKUP_MAX_BYTES: ${item.full}`);
    }
    if (total > MAX_BYTES) log("Latest backup exceeds BACKUP_MAX_BYTES; preserved it for recovery. Increase backup capacity.");
  }
  await sweepStalePartials([BACKUP_DIR, path.dirname(currentOutput)]);
}

const FILES_MODE_PATHS = RESTORE_DATA_ROOTS;
const FULL_MODE_PATHS = [...FILES_MODE_PATHS, "public", "prisma", "package.json", "package-lock.json"];

/**
 * restore.mjs takes back plain files and directories only. An archive with
 * anything else (a hard link GNU tar stored as a link, or a pipe or socket)
 * was published as a good backup that its own restore then refused.
 */
async function assertRestorableMembers(tar, archive) {
  const child = spawn(tar, ["-tvzf", archive], { stdio: ["ignore", "pipe", "ignore"] });
  const closed = new Promise((resolve) => child.on("close", resolve));
  let offending = null;
  for await (const line of createInterface({ input: child.stdout })) {
    // GNU tar and bsdtar listing lines both begin with the entry type.
    if (!offending && line[0] !== "-" && line[0] !== "d") offending = line;
  }
  if ((await closed) !== 0) throw new Error("Could not list the new archive to check it");
  if (offending) throw new Error(`The backup holds an entry the restore cannot take back (a link or special file): ${offending.slice(0, 300)}`);
}

function expandLocalRoot(value, env) {
  const slug = env.APP_SLUG || "vcontrolhub";
  return path.resolve(APP_DIR, value.replace(/\$\{APP_SLUG(?::-[^}]+)?\}|\$APP_SLUG\b/g, () => slug));
}

function covers(root, target) {
  const relative = path.relative(root, target);
  return !path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`);
}

// The nightly systemd timer also runs when there is no application worker.
async function assertScheduledCoverage(env, roots) {
  const psql = await findBinary("psql");
  if (!psql) throw new Error("Cannot verify local storage coverage without psql");
  const { connArgs, childEnv } = pgConnection(env);
  const schema = applicationSchema(env);
  const table = '"' + schema.replaceAll('"', '""') + '"."StorageNode"';
  const query = `SELECT COALESCE(json_agg(DISTINCT "basePath"), '[]') FROM ${table} WHERE driver = 'LOCAL'`;
  const { stdout } = await runBinary(psql, [...connArgs, "-XAt", "-v", "ON_ERROR_STOP=1", "-c", query], { env: childEnv });
  for (const basePath of JSON.parse(stdout)) {
    const directory = await fs.realpath(expandLocalRoot(basePath, env));
    if (!roots.some((root) => covers(root, directory))) throw new Error(`Incomplete backup coverage: ${directory}`);
  }
}

async function archivePaths(outputPath, members, extraDir, env, { full = false, restoreSnapshot = false } = {}) {
  const tar = await findTar();
  // GNU tar stores a second name of a hard-linked file as a link; store its
  // content instead, as for any other file.
  const gnuTar = /GNU tar/.test((await runBinary(tar, ["--version"]).catch(() => ({ stdout: "" }))).stdout);
  const existing = [];
  for (const member of members) {
    try { await fs.access(path.join(APP_DIR, member)); existing.push(member); }
    catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  if (!extraDir && existing.length === 0) throw new Error(`No files found for backup under ${APP_DIR}`);
  const args = [...(gnuTar ? ["--hard-dereference"] : []), "-czf", outputPath, "-C", APP_DIR, ...existing];
  const roots = existing.map((member) => ({ member, directory: path.resolve(APP_DIR, member) }));
  if (extraDir) {
    if (full) args.push("-C", extraDir, "database.sql.gz");
    const extraPaths = full ? JSON.parse(env.BACKUP_EXTRA_PATHS_JSON || "[]") : [];
    if (!Array.isArray(extraPaths) || extraPaths.some((entry) => typeof entry !== "string" || !path.isAbsolute(entry))) {
      throw new Error("BACKUP_EXTRA_PATHS_JSON must be an array of absolute paths");
    }
    const archived = await Promise.all(existing.map((name) => fs.realpath(path.join(APP_DIR, name))));
    const storage = full && env.STORAGE_ROOT?.trim() && await fs.realpath(expandLocalRoot(env.STORAGE_ROOT.trim(), env));
    if (storage && !archived.some((root) => covers(root, storage))) extraPaths.push(storage);
    const versions = await fs.realpath(fileVersionDir(env)).catch((error) => {
      if (error.code === "ENOENT" && !(env.BACKUP_REQUIRE_COVERAGE === "1" && env.FILE_VERSION_DIR)) return null;
      throw error;
    });
    const manifest = [];
    const external = [...new Set(await Promise.all(extraPaths.map((entry) => fs.realpath(entry))))];
    if (full && env.BACKUP_REQUIRE_COVERAGE === "1") await assertScheduledCoverage(env, [...archived, ...external]);
    for (const real of external) {
      if (external.some((other) => other !== real && covers(other, real))) continue;
      // FILE_VERSION_DIR is archived separately, under its own manifest.
      const root = path.parse(real).root;
      const member = path.relative(root, real).split(path.sep).join("/");
      if (!member || members.some((name) => member === name || member.startsWith(`${name}/`)) || path.resolve(outputPath).startsWith(`${real}${path.sep}`)) {
        throw new Error("External backup path overlaps archive members or backup output");
      }
      // The history manifest routes this directory to the destination's configured history store.
      if (real === versions) continue;
      args.push("-C", root, member);
      manifest.push({ source: real, member });
      roots.push({ directory: real, member });
    }
    if (manifest.length) {
      await fs.writeFile(path.join(extraDir, "external-data.json"), JSON.stringify({ version: 1, paths: manifest }, null, 2), { mode: 0o600 });
      args.push("-C", extraDir, "external-data.json");
    }
    // File history: the database dump holds its rows, the bodies live on
    // disk (by default outside the app directory). A full backup without
    // them restored a history that could not be opened.
    if (versions) {
      const insideApp = path.relative(await fs.realpath(APP_DIR), versions);
      if (insideApp && !insideApp.startsWith("..") && !path.isAbsolute(insideApp)) {
        const member = insideApp.split(path.sep).join("/");
        if (!existing.some((name) => member === name || member.startsWith(`${name}/`))) args.push("-C", APP_DIR, member);
        roots.push({ directory: versions, member });
        // Named as file history here too: a restore puts it into the target's
        // own FILE_VERSION_DIR. Without the note it was copied to the same
        // place under the target's app directory, where a differently
        // configured instance never looks.
        await fs.writeFile(path.join(extraDir, FILE_VERSIONS_MANIFEST), JSON.stringify({ version: 1, source: versions, member }, null, 2), { mode: 0o600 });
        args.push("-C", extraDir, FILE_VERSIONS_MANIFEST);
      } else {
        const root = path.parse(versions).root;
        const member = path.relative(root, versions).split(path.sep).join("/");
        if (members.some((name) => member === name || member.startsWith(`${name}/`))) {
          throw new Error("FILE_VERSION_DIR overlaps archive members");
        }
        roots.push({ directory: versions, member });
        await fs.writeFile(path.join(extraDir, FILE_VERSIONS_MANIFEST), JSON.stringify({ version: 1, source: versions, member }, null, 2), { mode: 0o600 });
        args.push("-C", root, member, "-C", extraDir, FILE_VERSIONS_MANIFEST);
      }
    }
    if (restoreSnapshot || env.BACKUP_INCLUDE_ENV === "true") {
      for (const name of ENV_MEMBERS) {
        const info = await fs.lstat(path.join(APP_DIR, name)).catch((error) => {
          if (error.code === "ENOENT") return null;
          throw error;
        });
        if (!info) continue;
        if (!info.isFile()) throw new Error(`Cannot snapshot non-regular environment file: ${name}`);
        args.push("-C", APP_DIR, name);
      }
    }
    if (full) {
      // Publication is conditional on the post-pack verification below.
      await fs.writeFile(path.join(extraDir, INTEGRITY_MANIFEST), JSON.stringify({
        version: 1, databaseSchema: applicationSchema(env), databaseFileReferences: "verified", tarWarningsAllowed: false,
      }));
      args.push("-C", extraDir, INTEGRITY_MANIFEST);
    }
  }
  // A normal files archive can tolerate hot log writes. A full backup and
  // a pre-restore snapshot must be complete before being published.
  const strict = full || restoreSnapshot || process.platform === "win32";
  const created = await runBinary(tar, args, { okExitCodes: strict ? [] : [1], onSpawn: trackChild });
  // Some tar implementations warn about a disappearing member but still exit
  // zero. The file need not have a database row (for example an env file).
  if ((full || restoreSnapshot) && created.stderr.trim()) {
    throw new Error(`Incomplete backup: tar reported a packing warning: ${created.stderr.trim().slice(0, 500)}`);
  }
  if (created.code === 1) log(`tar reported files changing while they were archived (exit 1): ${created.stderr.trim().slice(0, 500)}`);
  if (full) {
    const references = await expectedArchiveFiles(path.join(extraDir, "database.sql.gz"), env, APP_DIR, roots, fileVersionDir(env), expandLocalRoot);
    const count = await verifyArchiveFiles(outputPath, references, INTEGRITY_MANIFEST);
    log(`Verified archive integrity against ${count} database file reference(s)`);
  } else await assertRestorableMembers(tar, outputPath);
  const size = (await fs.stat(outputPath)).size;
  log(`Completed backup: ${outputPath} (${size} bytes)`);
}

async function main() {
  if (!Number.isSafeInteger(RETENTION_DAYS) || RETENTION_DAYS < 1 || RETENTION_DAYS > 3650) throw new Error("BACKUP_RETENTION_DAYS must be an integer from 1 to 3650");
  if (!Number.isSafeInteger(MAX_BYTES) || MAX_BYTES < 0) throw new Error("BACKUP_MAX_BYTES must be a nonnegative integer");
  const argv = process.argv.slice(2);
  let mode = "database";
  let positional = "";
  let restoreSnapshot = false;
  while (argv.length > 0) {
    const arg = argv.shift();
    if (arg === "--files") mode = "files";
    else if (arg === "--full") mode = "full";
    else if (arg === "--restore-snapshot") restoreSnapshot = true;
    else if (arg === "--database") mode = "database";
    else if (arg) positional = arg;
  }

  // Do not race a live offline restore (e.g. nightly timer firing mid-restore),
  // while ignoring a stale lock left behind by a dead local PID.
  if (!restoreSnapshot && await hasLiveRestoreLock(APP_DIR)) {
    fail("An installation restore is in progress (.restore.lock exists); refusing to run backup");
  }

  await fs.mkdir(BACKUP_DIR, { recursive: true });
  // Reclaim stale interrupted *.partial-* files up front so a previous outage
  // cannot keep the backup volume full before a new archive even starts.
  await sweepStalePartials([BACKUP_DIR]);
  const envFile = await loadEnvFile();
  // ENV_FILE historically selects the database. Runtime overrides still
  // select archive directories and the recovery/scheduled-backup options.
  const env = { ...envFile, ...process.env };
  for (const [key, value] of Object.entries(envFile)) {
    if (key.startsWith("DATABASE_") || key.startsWith("PG")) env[key] = value;
  }

  if (mode === "database") {
    // Mode, not extension: resolveOutputPath branches on "database" to emit
    // <app>_<ts>.sql.gz (a raw gzipped SQL dump). Passing "sql.gz" fell into
    // the archive branch and produced a misnamed .tar.gz that the retention
    // pruner never matches — so default DB backups accumulated forever.
    const output = resolveOutputPath(positional, "database");
    await dumpDatabase(output, env);
    await pruneOldBackups(output);
    return;
  }

  const output = resolveOutputPath(positional, mode === "full" ? "full" : "files");
  await fs.mkdir(path.dirname(output), { recursive: true });
  if (mode === "files" && !restoreSnapshot) {
    log(`Starting files backup: ${output}`);
    await publishBackup(output, (temporary) => archivePaths(temporary, FILES_MODE_PATHS, null, env));
    await pruneOldBackups(output);
    return;
  }
  // full: stage the db dump beside the file set without archiving backups/ itself.
  log(`Starting ${mode} backup: ${output}`);
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "vch-backup-full-"));
  activeTempPaths.add(staging);
  try {
    const full = mode === "full";
    if (full) await dumpDatabase(path.join(staging, "database.sql.gz"), env, true);
    await publishBackup(output, (temporary) => archivePaths(temporary,
      full ? FULL_MODE_PATHS : FILES_MODE_PATHS, staging, env, { full, restoreSnapshot }));
    await pruneOldBackups(output);
  } finally {
    activeTempPaths.delete(staging);
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
  }
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
