/**
 * Shared runtime for the Node backup/restore runners (scripts/backup.mjs,
 * scripts/restore.mjs).
 *
 * Both runners need the same primitives on Windows hosts where bash and the
 * GNU toolchain are not guaranteed: .env parsing, PATH+install-root binary
 * discovery, bounded child-process execution, and connection-string
 * redaction. Keep them here so the two entrypoints cannot drift.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import tarStream from "tar-stream";
import { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";

export const IS_WINDOWS = process.platform === "win32";

/** Prefix logger factory: `makeLogger("restore")` → `[restore] ...`. */
export function makeLogger(label) {
  return {
    log: (message) => console.log(`[${label}] ${message}`),
    fail: (message) => {
      console.error(`[${label}] ${message}`);
      process.exit(1);
    },
  };
}

/** dotenv-style parser: KEY=VALUE lines, comments and blank lines ignored. */
export function parseEnvFile(content) {
  const result = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    result[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
  return result;
}

/**
 * Read the runner env file into a plain object. A missing file yields `{}` —
 * callers that treat it as fatal check afterwards, so both the tolerate and
 * fail-hard policies stay one-liners.
 */
export async function readEnvFile(envFile) {
  try {
    return parseEnvFile(await fs.readFile(envFile, "utf8"));
  } catch {
    return null;
  }
}

/**
 * Find an executable: PATH search first, then platform install roots
 * (PG_INSTALL_DIR env extra). Windows probes `.exe`/`.com`/`.bat`/`.cmd`
 * variants and the Program Files PostgreSQL major-version layout; POSIX
 * probes the distro postgresql packaging roots.
 */
export async function findBinary(name) {
  const dirs = [
    ...(process.env.PATH ?? "").split(path.delimiter).filter(Boolean),
    ...(process.env.PG_INSTALL_DIR ? [process.env.PG_INSTALL_DIR] : []),
  ];
  if (IS_WINDOWS) {
    const programFiles = process.env.ProgramFiles || "C:\\Program Files";
    for (let major = 18; major >= 12; major -= 1) {
      dirs.push(path.join(programFiles, "PostgreSQL", String(major), "bin"));
    }
  } else {
    dirs.push("/usr/lib/postgresql/16/bin", "/usr/lib/postgresql/15/bin", "/usr/lib/postgresql/14/bin", "/usr/local/bin", "/usr/bin");
  }
  const candidates = IS_WINDOWS ? [name, `${name}.exe`, `${name}.com`, `${name}.bat`, `${name}.cmd`] : [name];
  for (const dir of dirs) {
    for (const candidate of candidates) {
      const full = path.join(dir, candidate);
      try {
        await fs.access(full);
        return full;
      } catch {
        // keep searching
      }
    }
  }
  return null;
}

let cachedTar;
/** Resolve the tar binary once per process (TAR_BIN override wins). */
export async function findTar() {
  if (process.env.TAR_BIN) return process.env.TAR_BIN;
  if (!cachedTar) cachedTar = (await findBinary("tar")) || "tar";
  return cachedTar;
}

/**
 * Where file history bodies are kept: FILE_VERSION_DIR, else the data root's
 * "file-versions" (as src/lib/storage/file-versions.ts resolves it).
 */
export function fileVersionDir(env) {
  const configured = (env.FILE_VERSION_DIR ?? "").trim();
  if (configured) return path.resolve(env.APP_DIR || process.cwd(), configured);
  return process.platform === "win32"
    ? path.join(env.PROGRAMDATA ?? path.join(os.homedir(), "AppData", "Local"), "VControlHub", "file-versions")
    : "/var/lib/vcontrolhub/file-versions";
}

/** Manifest naming the archive member that holds file history bodies kept outside the app directory. */
export const FILE_VERSIONS_MANIFEST = "file-versions.json";
export const ENV_MEMBERS = [".env", ".env.production", ".env.local", ".env.runtime"];
export const INTEGRITY_MANIFEST = "backup-integrity.json";

const LIBPQ_SECRETS = ["password", "sslpassword"];
// libpq conninfo values may quote whitespace and escape quotes or spaces.
const conninfoValue = /'(?:\\.|[^'\\])*'?|"(?:\\.|[^"\\])*"?|(?:\\.|[^\s\\])*/.source;
const secretAssignment = new RegExp("(\\b(?:" + LIBPQ_SECRETS.join("|") + ")\\s*=\\s*)(?:" + conninfoValue + ")", "gi");

export function redactConnectionString(text) {
  // An @ in a query value is data, so removing everything before the last
  // apparent userinfo delimiter can leave part of the passphrase visible.
  return text.replace(/\b(postgres(?:ql)?:\/\/)[^\s]+/gi, "$1[REDACTED]")
    .replace(secretAssignment, "$1[REDACTED]");
}

/**
 * Run a child process to completion with bounded stdout/stderr capture and
 * connection-string redaction. Rejects on nonzero exit or spawn error with a
 * `<basename> exited with code N: <stderr>` message.
 *
 * `okExitCodes`: nonzero exit codes that still count as success (resolved with
 * the `code`), for tools whose exit status distinguishes a warning from a failure.
 */
export function runBinary(binary, args, options = {}) {
  const { okExitCodes = [], onSpawn, ...spawnOptions } = options;
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], ...spawnOptions });
    onSpawn?.(child);
    let stdout = "";
    let stderr = "";
    child.stdout?.on?.("data", (chunk) => {
      stdout = (stdout + String(chunk)).slice(-1024 * 1024);
    });
    child.stderr?.on?.("data", (chunk) => {
      stderr = (stderr + String(chunk)).slice(-16 * 1024);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0 || okExitCodes.includes(code)) resolve({ stdout, stderr: redactConnectionString(stderr), code });
      else reject(new Error(`${path.basename(binary)} exited with code ${code}: ${redactConnectionString(stderr).trim()}`));
    });
  });
}

/** Current timestamp `YYYYMMDD_HHMMSS` in local time (matches bash runners). */
export function timestamp() {
  const now = new Date();
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
}

/**
 * Connection parameters libpq accepts in a URI. libpq refuses any other key outright ("invalid URI query
 * parameter"), including the ones the application itself reads from DATABASE_URL (pool_max, connection_limit,
 * pool_idle_timeout; Prisma's schema, pgbouncer ...), which made pg_dump and psql, so every backup and restore,
 * fail for such a URL.
 */
const LIBPQ_URI_PARAMETERS = new Set([
  "host", "hostaddr", "port", "dbname", "user", "password", "passfile", "channel_binding", "connect_timeout",
  "client_encoding", "options", "application_name", "fallback_application_name", "keepalives", "keepalives_idle",
  "keepalives_interval", "keepalives_count", "tcp_user_timeout", "replication", "gssencmode", "sslmode",
  "requiressl", "sslcompression", "sslcert", "sslkey", "sslpassword", "sslcertmode", "sslrootcert", "sslcrl",
  "sslcrldir", "sslsni", "requirepeer", "ssl_min_protocol_version", "ssl_max_protocol_version", "krbsrvname",
  "gsslib", "gssdelegation", "service", "target_session_attrs", "load_balance_hosts", "sslnegotiation",
  "min_protocol_version", "max_protocol_version", "require_auth",
]);

/**
 * Resolve PostgreSQL connection argv from the merged environment:
 * DATABASE_URL wins; otherwise discrete host/port/user/name (+PGPASSWORD).
 */
export function pgConnection(env) {
  if (env.DATABASE_URL) {
    const childEnv = { ...env };
    let url;
    try {
      url = new URL(env.DATABASE_URL);
      if (!["postgres:", "postgresql:"].includes(url.protocol)) throw new Error();
      if (url.password) childEnv.PGPASSWORD = decodeURIComponent(url.password);
      if (url.searchParams.has("password")) {
        childEnv.PGPASSWORD = url.searchParams.get("password");
        url.searchParams.delete("password");
      }
      url.password = "";
      for (const key of [...url.searchParams.keys()]) {
        if (!LIBPQ_URI_PARAMETERS.has(key)) url.searchParams.delete(key);
      }
    } catch {
      throw new Error("Invalid PostgreSQL connection URL");
    }
    if (url.searchParams.has("sslpassword")) {
      throw new Error("Use a private libpq service file for sslpassword instead of DATABASE_URL");
    }
    // Credentials stay in the child environment, out of process argv and logs.
    return { connArgs: [url.toString()], childEnv };
  }
  const childEnv = { ...env };
  if (env.DATABASE_PASSWORD) childEnv.PGPASSWORD = env.DATABASE_PASSWORD;
  return {
    connArgs: [
      "-h", env.DATABASE_HOST || "127.0.0.1",
      "-p", env.DATABASE_PORT || "5432",
      "-U", env.DATABASE_USER || "postgres",
      "-d", env.DATABASE_NAME || env.APP_SLUG || "vcontrolhub",
    ],
    childEnv,
  };
}

/**
 * Host-level restore lock shared by every restore entrypoint (the app's
 * restore job, `npm run restore`, the restore-*.sh wrappers). Two restores of
 * different backups would otherwise overwrite the same database and file tree
 * concurrently. The in-app path additionally holds a PostgreSQL advisory lock
 * so app instances on other hosts are excluded too.
 *
 * The lock lives in the target installation's real directory and is removed
 * on exit. mkdir is atomic on every platform. The owner file lets a
 * lock left behind by a killed process on this host be reclaimed; a live owner
 * is never displaced. scripts/restore-files.sh implements the same protocol.
 */
export function restoreLockPath(appDir) {
  return path.join(appDir, ".restore.lock");
}

/**
 * Return true if an active (non-stale) offline restore lock exists for `appDir`.
 * A lock left behind by a crashed local PID does not block backups permanently.
 */
export async function hasLiveRestoreLock(appDir) {
  const lockDir = restoreLockPath(appDir);
  const stat = await fs.lstat(lockDir).catch(() => null);
  if (!stat) return false;
  const owner = await lockOwner(lockDir);
  if (staleOwner(owner)) return false;
  return true;
}

function readLockOwner(content) {
  const owner = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^(pid|host|startedAt|token)=(.*)$/);
    if (match) owner[match[1]] = match[2];
  }
  return owner;
}

function processIsAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function staleOwner(owner) {
  const pid = Number(owner.pid);
  return owner.host === os.hostname() && Number.isInteger(pid) && pid > 0 && !processIsAlive(pid);
}

async function lockOwner(lockDir) {
  return readLockOwner(await fs.readFile(path.join(lockDir, "owner"), "utf8").catch((error) => {
    if (error.code === "ENOENT") return "";
    throw error;
  }));
}

async function retireLock(lockDir) {
  // Once renamed, a new owner can acquire lockDir without our cleanup ever
  // touching its directory.
  const retired = `${lockDir}.retired-${randomUUID()}`;
  await fs.rename(lockDir, retired);
  await fs.rm(retired, { recursive: true });
}

async function reclaimStaleLock(lockDir) {
  const claim = `${lockDir}.reclaim`;
  try {
    await fs.mkdir(claim, { mode: 0o700 });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Restore lock recovery is already in progress (${claim}). Retry after the other restore runner exits. If it was killed during recovery, confirm all restore runners have stopped before removing the abandoned ${claim} directory.`);
    }
    throw error;
  }
  try {
    // Recheck under the exclusion shared by all reclaimers, including when
    // reading a legacy owner file with no token.
    if (!staleOwner(await lockOwner(lockDir))) return false;
    await retireLock(lockDir);
    return true;
  } finally {
    await fs.rmdir(claim);
  }
}

export async function acquireRestoreLock(appDir) {
  const lockDir = restoreLockPath(appDir);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.mkdir(lockDir, { mode: 0o700 });
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = await lockOwner(lockDir);
      if (attempt === 0 && staleOwner(owner) && await reclaimStaleLock(lockDir)) continue;
      throw new Error(
        `another restore is already running for ${appDir} (lock ${lockDir}, pid ${owner.pid ?? "unknown"} on ${owner.host ?? "unknown host"} since ${owner.startedAt ?? "unknown"}). Wait for it to finish; remove the lock only if that process is gone.`,
      );
    }
    const token = randomUUID();
    try {
      await fs.writeFile(path.join(lockDir, "owner"),
        `pid=${process.pid}\nhost=${os.hostname()}\nstartedAt=${new Date().toISOString()}\ntoken=${token}\n`,
        { flag: "wx", mode: 0o600 });
    } catch (error) {
      await retireLock(lockDir);
      throw error;
    }
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      const owner = await lockOwner(lockDir);
      if (owner.token === token && owner.host === os.hostname() && owner.pid === String(process.pid)) {
        await retireLock(lockDir);
      }
    };
  }
  throw new Error(`could not acquire restore lock ${lockDir}`);
}

export const RESTORE_DATA_ROOTS = ["storage", "uploads", "downloads", "logs"];
const codeRoots = ["public", "prisma", "package.json", "package-lock.json"];
const manifests = [FILE_VERSIONS_MANIFEST, "external-data.json", INTEGRITY_MANIFEST];

function memberName(raw) {
  const name = raw.replace(/^(?:\.\/)+/, "").replace(/\/$/, "");
  if (name === "." || name === "") return "";
  if (name.includes("\\") || name.split("/").some((part) => !part || part === ".." || part === "." ||
      (IS_WINDOWS && (/[<>:"|?*]|[. ]$/.test(part) || /^(?:CON|AUX|NUL|PRN|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))) || /^[A-Za-z]:/.test(name)) {
    throw new Error("unsafe archive member");
  }
  return name;
}

async function walkArchive(archive, visit) {
  const extract = tarStream.extract();
  await Promise.all([
    pipeline(createReadStream(archive), createGunzip(), extract),
    (async () => {
      try {
        for await (const entry of extract) {
          const { type, name } = entry.header;
          if (type !== "file" && type !== "directory") throw new Error("archive links and special files are not supported");
          const member = memberName(name);
          if (!member && type !== "directory") throw new Error("unsafe archive member");
          await visit(entry, member);
          entry.resume();
        }
      } catch (error) { extract.destroy(error); throw error; }
    })(),
  ]);
}

const withinMember = (name, root) => name === root || name.startsWith(root + "/");

export async function inspectArchive(archive) {
  const members = new Map();
  const metadata = new Map();
  let databaseMember = null;
  await walkArchive(archive, async (entry, name) => {
    if (!name) return;
    if (members.has(name)) throw new Error("duplicate archive member");
    const { type, size } = entry.header;
    members.set(name, type);
    if (name === "database.sql.gz") {
      if (type !== "file") throw new Error("invalid database member");
      databaseMember = entry.header.name;
    }
    if (manifests.includes(name)) {
      if (type !== "file" || size > 1024 * 1024) throw new Error("invalid archive manifest");
      const parts = [];
      for await (const chunk of entry) parts.push(chunk);
      const manifest = JSON.parse(Buffer.concat(parts).toString("utf8"));
      if (manifest?.version !== 1) throw new Error("invalid archive manifest version");
      metadata.set(name, manifest);
    }
  });
  function declaredRoot(entry, history) {
    if (typeof entry?.member !== "string" || !entry.member || memberName(entry.member) !== entry.member ||
        !members.has(entry.member) || (history && members.get(entry.member) !== "directory") ||
        [...codeRoots, ...manifests, ...ENV_MEMBERS, "database.sql.gz"].some((r) => withinMember(entry.member, r)) ||
        (!history && RESTORE_DATA_ROOTS.some((r) => withinMember(entry.member, r)))) throw new Error("invalid archive data root");
    return entry.member;
  }
  const versions = metadata.get(FILE_VERSIONS_MANIFEST);
  const history = versions ? declaredRoot(versions, true) : null;
  const external = metadata.get("external-data.json");
  if (external && !Array.isArray(external.paths)) throw new Error("invalid external data manifest");
  const roots = (external?.paths ?? []).map((r) => declaredRoot(r, false));
  const files = new Set();
  for (const [name, type] of members) {
    if (RESTORE_DATA_ROOTS.includes(name) && type !== "directory") throw new Error("invalid data directory");
    if (ENV_MEMBERS.includes(name) && type !== "file") throw new Error("invalid environment member");
    if (RESTORE_DATA_ROOTS.some((r) => withinMember(name, r)) || ENV_MEMBERS.includes(name) || (history && withinMember(name, history))) files.add(name);
    else if (name !== "database.sql.gz" && !manifests.includes(name) && !codeRoots.some((r) => withinMember(name, r)) &&
      !roots.some((r) => withinMember(name, r)) && !(type === "directory" && [...roots, history].some((r) => r?.startsWith(name + "/")))) {
      throw new Error("archive contains an unrecognized installation member");
    }
  }
  return { databaseMember, files, history, externalRoots: roots, sourceSchema: metadata.get(INTEGRITY_MANIFEST)?.databaseSchema };
}

/** Extract only exact planned members into private staging. */
export async function extractRestoreFiles(archive, staging, plan) {
  await walkArchive(archive, async (entry, name) => {
    if (!plan.files.has(name)) return;
    const history = plan.history && withinMember(name, plan.history);
    const dest = history ? path.join(staging + "-file-versions", name.slice(plan.history.length)) : path.join(staging, name);
    if (entry.header.type === "directory") await fs.mkdir(dest, { recursive: true, mode: 0o700 });
    else {
      await fs.mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
      await pipeline(entry, createWriteStream(dest, { flags: "wx", mode: entry.header.mode & 0o777 }));
    }
  });
}

export function pgDumpSchemaArgs(schema) {
  return schema === "public" ? [] : ["--schema", '"' + schema.replaceAll('"', '""') + '"'];
}

export async function* checkRestoreSchema(chunks, schema) {
  let head = Buffer.alloc(0);
  let checked = false;
  const verify = () => {
    const marker = /^-- VControlHub application schema ([0-9a-f]+)\r?$/m.exec(head.toString());
    if (marker && marker[1] !== Buffer.from(schema).toString("hex")) throw new Error("Backup and target application schemas differ");
  };
  for await (const chunk of chunks) {
    if (!checked) {
      const prefix = chunk.subarray(0, 256 - head.length);
      head = Buffer.concat([head, prefix]);
      if (head.length < 256) continue;
      verify();
      checked = true;
      yield head;
      if (prefix.length < chunk.length) yield chunk.subarray(prefix.length);
      continue;
    }
    yield chunk;
  }
  if (!checked && head.length) {
    verify();
    yield head;
  }
}

export function applicationSchema(env) {
  const schema = (env.DATABASE_URL && new URL(env.DATABASE_URL).searchParams.get("schema")) || "public";
  if (Buffer.byteLength(schema) > 63 || /[\0-\x1f\x7f]/.test(schema) || /^pg_|^information_schema$/i.test(schema)) throw new Error("Invalid application schema");
  return schema;
}

/** Stream through the same EOF check before psql commits or a read-only drill succeeds. */
export async function* checkedDatabaseDump(chunks) {
  let tail = "";
  for await (const chunk of chunks) {
    tail = (tail + chunk.subarray(-4096).toString("latin1")).slice(-4096);
    yield chunk;
  }
  if (!/^-- PostgreSQL database dump complete\r?$/m.test(tail)) throw new Error("Missing pg_dump completion marker");
}

async function verifySqlGzip(file) {
  await pipeline(createReadStream(file), createGunzip(), checkedDatabaseDump, async (chunks) => {
    let head = "";
    for await (const chunk of chunks) {
      if (head.length < 8192) head += chunk.subarray(0, 8192 - head.length).toString("latin1");
    }
    if (!/PostgreSQL|SET |CREATE |DROP |COPY /i.test(head)) throw new Error("Expected PostgreSQL SQL dump");
  }, { signal: AbortSignal.timeout(600_000) });
}

export async function verifyBackupPayload(type, archive) {
  if (type === "DATABASE") return verifySqlGzip(archive);
  // tar can stop at its end-of-archive marker before reading the gzip trailer.
  await pipeline(createReadStream(archive), createGunzip(), new Writable({
    write(_chunk, _encoding, done) { done(); },
  }), { signal: AbortSignal.timeout(600_000) });
  const { databaseMember } = await inspectArchive(archive);
  if (type === "FILES") {
    if (databaseMember) throw new Error("FILES archive contains a FULL database member");
    return;
  }
  if (type !== "FULL" || !databaseMember) throw new Error("Expected FULL archive with database.sql.gz");
  const staging = await fs.mkdtemp(path.join(os.tmpdir(), "vch-drill-"));
  try {
    const tar = await findTar();
    await runBinary(tar, ["-xzf", archive, "-C", staging, "--no-same-owner", databaseMember], { timeout: 600_000 });
    await verifySqlGzip(path.join(staging, "database.sql.gz"));
  } finally {
    await fs.rm(staging, { recursive: true, force: true });
  }
}
