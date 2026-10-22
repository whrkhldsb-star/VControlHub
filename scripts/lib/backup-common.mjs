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
  if (configured) return path.resolve(configured);
  return process.platform === "win32"
    ? path.join(env.PROGRAMDATA ?? path.join(os.homedir(), "AppData", "Local"), "VControlHub", "file-versions")
    : "/var/lib/vcontrolhub/file-versions";
}

/** Manifest naming the archive member that holds file history bodies kept outside the app directory. */
export const FILE_VERSIONS_MANIFEST = "file-versions.json";

export function redactConnectionString(text) {
  return text.replace(/(postgres(ql)?:\/\/)[^@\s]+@/g, "$1[REDACTED]@");
}

/**
 * Run a child process to completion with bounded stdout/stderr capture and
 * connection-string redaction. Rejects on nonzero exit or spawn error with a
 * `<basename> exited with code N: <stderr>` message.
 */
export function runBinary(binary, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { stdio: ["ignore", "pipe", "pipe"], ...options });
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
      if (code === 0) resolve({ stdout, stderr: redactConnectionString(stderr) });
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
    } catch {
      throw new Error("Invalid PostgreSQL connection URL");
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
 * The lock is per installation (APP_DIR), not per restore destination, and is
 * removed on exit. mkdir is atomic on every platform. The owner file lets a
 * lock left behind by a killed process on this host be reclaimed; a live owner
 * is never displaced. scripts/restore-files.sh implements the same protocol.
 */
export function restoreLockPath(appDir) {
  return path.join(appDir, ".restore.lock");
}

function readLockOwner(content) {
  const owner = {};
  for (const line of content.split(/\r?\n/)) {
    const match = line.match(/^(pid|host|startedAt)=(.*)$/);
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

export async function acquireRestoreLock(appDir) {
  const lockDir = restoreLockPath(appDir);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await fs.mkdir(lockDir);
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;
      const owner = readLockOwner(await fs.readFile(path.join(lockDir, "owner"), "utf8").catch(() => ""));
      const pid = Number(owner.pid);
      const stale = owner.host === os.hostname() && Number.isInteger(pid) && pid > 0 && !processIsAlive(pid);
      if (attempt === 0 && stale) {
        await fs.rm(lockDir, { recursive: true, force: true });
        continue;
      }
      throw new Error(
        `another restore is already running for ${appDir} (lock ${lockDir}, pid ${owner.pid ?? "unknown"} on ${owner.host ?? "unknown host"} since ${owner.startedAt ?? "unknown"}). Wait for it to finish; remove the lock only if that process is gone.`,
      );
    }
    await fs.writeFile(
      path.join(lockDir, "owner"),
      `pid=${process.pid}\nhost=${os.hostname()}\nstartedAt=${new Date().toISOString()}\n`,
    );
    let released = false;
    return async () => {
      if (released) return;
      released = true;
      await fs.rm(lockDir, { recursive: true, force: true }).catch(() => undefined);
    };
  }
  throw new Error(`could not acquire restore lock ${lockDir}`);
}
