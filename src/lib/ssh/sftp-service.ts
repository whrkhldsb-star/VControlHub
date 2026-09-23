/**
 * SFTP service — file transfer operations over SSH.
 *
 * Establishes an SSH connection per operation, opens the SFTP subsystem,
 * performs the requested file operation, then cleans up.
 *
 * All operations accept a `serverId` — the service looks up credentials
 * from the database and decrypts them before connecting.
 */

import { Client } from "ssh2";
import {
  createRemoteDirectory,
  createVerifiedSshConfig,
  deleteRemoteFile,
  listRemoteDirectory,
  readRemoteFile,
  renameRemoteFile,
  statRemoteEntry,
  writeRemoteFile,
  type SshConnectionParams,
} from "@/lib/ssh/client";
import type { Stats } from "ssh2";
import { Readable, PassThrough } from "node:stream";
import {
  assertDirectCredentialsConfigured,
  loadEnabledServerForSsh,
} from "@/lib/ssh/server-target";
import { createLogger } from "@/lib/logging";
import {
  AppError,
  BusinessError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  isAppError,
} from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

const logger = createLogger("sftp-service");

// Abort a stalled SFTP transfer (remote stops sending/ACKing) so it can't hang
// forever — keepalive only detects a fully dead TCP connection, not a live
// connection whose bytes simply stopped flowing. The clock resets on every
// chunk, so a slow-but-progressing large transfer is never killed. Matches the
// bound already applied in downloads' transferFileViaSsh2.
const SFTP_TRANSFER_IDLE_TIMEOUT_MS = 120_000;

/**
 * Translate a raw SFTP/SSH error into a typed AppError with an accurate status
 * and a message safe to show the user. Without this, servers-side SFTP routes
 * let plain Errors reach `apiCatch(e, 500, ...)`, which — because the status is
 * >=500 — replaces the real reason ("no such file", "permission denied", "disk
 * full") with a generic fallback and always reports 500. AppErrors are passed
 * through by apiCatch, so mapping here restores useful errors and correct codes.
 */
function mapSftpError(error: unknown): never {
  if (isAppError(error)) throw error;
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  const lower = message.toLowerCase();

  if (code === "ENOENT" || code === 2 || /no such file|not found|不存在/.test(lower)) {
    throw new NotFoundError(message || t("backend.sftp.remotePathNotFound"));
  }
  if (
    code === 3 || // SSH_FX_PERMISSION_DENIED
    code === "EACCES" ||
    /permission denied|access denied|拒绝访问|not permitted/.test(lower)
  ) {
    throw new ForbiddenError(message || t("backend.sftp.permissionDenied"));
  }
  if (/not empty|目录非空|directory is not empty/.test(lower)) {
    throw new ConflictError(message);
  }
  if (/no space left|disk full|quota exceeded|磁盘空间/.test(lower)) {
    throw new BusinessError(message);
  }
  // Unknown remote failure: surface the real message as a 502 (upstream/remote
  // fault) so it is preserved rather than masked by the generic 500 fallback.
  throw new AppError({ code: "EXTERNAL_SERVICE_ERROR", message: message || t("backend.sftp.operationFailed"), status: 502 });
}

// ── Types ──────────────────────────────────────────────────────────

export type SftpDirEntry = {
  name: string;
  longname: string;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  size: number;
  modifyTime: number;
  accessTime: number;
  owner: number;
  group: number;
};

export type SftpStat = {
  mode: number;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  isSymlink: boolean;
  modifyTime: number;
  accessTime: number;
};

type ResolvedConnection = {
  host: string;
  port: number;
  username: string;
  connectionType: string;
  privateKey?: string;
  passphrase?: string;
  password?: string;
  hostKeySha256?: string | null;
  agentServerId?: string;
};

// ── Path safety ────────────────────────────────────────────────────

/**
 * Normalise a remote path and reject obvious traversal attempts.
 * We allow absolute paths (common for root-SSH sessions) but block
 * null bytes and excessively long paths.
 */
export function sanitizeRemotePath(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new Error("Path must be a non-empty string");
  }
  if (raw.includes("\0")) {
    throw new Error("Path contains null bytes");
  }
  if (raw.length > 4096) {
    throw new Error("Path exceeds maximum length");
  }
  // Normalise consecutive slashes
  return raw.replace(/\/{2,}/g, "/");
}

/** Reject filenames that contain path separators, traversal, or null bytes. */
export function sanitizeFileName(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new Error("Filename must be a non-empty string");
  }
  // Path separators and null bytes are the real traversal vectors and are
  // rejected outright. `.` / `..` are only dangerous as whole path segments,
  // which cannot occur here once "/" and "\" are banned — so a mere substring
  // ".." (e.g. "photo..jpg", "版本..备份.zip") is a legitimate filename and
  // must NOT be rejected.
  if (
    raw.includes("\0") ||
    raw.includes("/") ||
    raw.includes("\\") ||
    raw === "." ||
    raw === ".."
  ) {
    throw new Error("Invalid filename");
  }
  if (raw.length > 255) {
    throw new Error("Filename exceeds maximum length");
  }
  return raw;
}

// ── Connection resolution ──────────────────────────────────────────

async function resolveServerConnection(serverId: string): Promise<ResolvedConnection> {
  // Unified SSH-target loader: typed not-found/disabled errors, credential
  // presence checks, and one decryption path shared with every other module.
  const { server, ssh } = await loadEnabledServerForSsh(serverId);
  assertDirectCredentialsConfigured(server);
  return {
    host: server.host,
    port: server.port,
    username: server.username,
    connectionType: server.connectionType,
    hostKeySha256: server.hostKeySha256,
    ...(ssh.privateKey ? { privateKey: ssh.privateKey } : {}),
    ...(ssh.passphrase ? { passphrase: ssh.passphrase } : {}),
    ...(ssh.password ? { password: ssh.password } : {}),
    ...(ssh.agentServerId ? { agentServerId: ssh.agentServerId } : {}),
  };
}

function toConnectionParams(conn: ResolvedConnection): SshConnectionParams {
  return {
    host: conn.host,
    port: conn.port,
    username: conn.username,
    hostKeySha256: conn.hostKeySha256,
    ...(conn.privateKey ? { privateKey: conn.privateKey } : {}),
    ...(conn.passphrase ? { passphrase: conn.passphrase } : {}),
    ...(conn.password ? { password: conn.password } : {}),
    ...(conn.agentServerId ? { agentServerId: conn.agentServerId } : {}),
  };
}

function isAgentOnly(conn: ResolvedConnection) {
  return Boolean(conn.agentServerId && !conn.privateKey && !conn.password);
}

/**
 * Map a raw SSH transport error from session setup into a typed AppError.
 * Host-key verification failures (enforced pinning rejecting an unpinned or
 * changed host key) become a BusinessError whose message tells the operator
 * to pin the fingerprint first; other transport errors keep the original
 * detail appended to a translated prefix.
 */
function mapSshConnectError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  if (/host key verification|host verifier/i.test(message)) {
    return new BusinessError(t("backend.ssh.hostKeyNotPinned"));
  }
  return new Error(`SSH connection error: ${message}`);
}

// ── SFTP session helper ────────────────────────────────────────────

type SftpSession = {
  sftp: import("ssh2").SFTPWrapper;
  client: Client;
  close: () => void;
};

async function openSftpSession(serverId: string): Promise<SftpSession> {
  const conn = await resolveServerConnection(serverId);
  const client = new Client();

  return new Promise<SftpSession>((resolve, reject) => {
    const timeout = setTimeout(() => {
      try { client.end(); } catch { /* best-effort cleanup on timeout */ }
      reject(new Error(t("backend.ssh.connectionTimedOut")));
    }, 15000);

    client.on("ready", () => {
      client.sftp((err, sftp) => {
        clearTimeout(timeout);
        if (err) {
          try { client.end(); } catch { /* best-effort cleanup on SFTP error */ }
          reject(new Error(t("backend.ssh.sftpSubsystemError", { message: err.message })));
          return;
        }
        resolve({
          sftp,
          client,
          close: () => {
            try { sftp.end(); } catch { /* best-effort SFTP teardown */ }
            try { client.end(); } catch { /* best-effort client teardown */ }
          },
        });
      });
    });

    client.on("error", (err) => {
      clearTimeout(timeout);
      reject(mapSshConnectError(err));
    });

    const config = createVerifiedSshConfig({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      hostKeySha256: conn.hostKeySha256,
      // OPEN-1 parity with the command-execution path: refuse SFTP sessions
      // against servers whose host key has never been pinned (fail-closed)
      // instead of silently accepting whatever key the host presents.
      enforceHostKeyPin: true,
      ...(conn.connectionType === "SSH_KEY"
        ? { privateKey: conn.privateKey, ...(conn.passphrase ? { passphrase: conn.passphrase } : {}) }
        : { password: conn.password }),
    });
    config.readyTimeout = 15000;
    config.keepaliveInterval = 5000;
    config.keepaliveCountMax = 3;
    client.connect(config);
  });
}

// ── Public operations ──────────────────────────────────────────────

export async function listDirectory(
  serverId: string,
  remotePath: string,
): Promise<SftpDirEntry[]> {
  const path = sanitizeRemotePath(remotePath);
  const conn = await resolveServerConnection(serverId);
  const entries = await listRemoteDirectory({ ...toConnectionParams(conn), remotePath: path });
  const result: SftpDirEntry[] = entries.map((entry) => ({
    name: entry.name,
    longname: entry.longname,
    isDirectory: entry.type === "directory",
    isFile: entry.type === "file",
    isSymlink: false,
    size: entry.size,
    modifyTime: Math.floor(entry.modifyTime / 1000),
    accessTime: Math.floor(entry.accessTime / 1000),
    owner: 0,
    group: 0,
  }));
  result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
  });
  return result;
}

export async function statEntry(
  serverId: string,
  remotePath: string,
): Promise<SftpStat> {
  const path = sanitizeRemotePath(remotePath);
  const conn = await resolveServerConnection(serverId);
  const stats = await statRemoteEntry({ ...toConnectionParams(conn), remotePath: path });
  return {
    mode: stats.mode,
    size: stats.size,
    isDirectory: stats.type === "directory",
    isFile: stats.type === "file",
    isSymlink: stats.type === "other",
    modifyTime: Math.floor(stats.modifyTime / 1000),
    accessTime: Math.floor(stats.accessTime / 1000),
  };
}

/**
 * Upload a readable stream to a remote path.
 * Returns the number of bytes written.
 */
export async function uploadFile(
  serverId: string,
  remotePath: string,
  sourceStream: Readable,
): Promise<number> {
  const path = sanitizeRemotePath(remotePath);
  const conn = await resolveServerConnection(serverId);
  if (isAgentOnly(conn)) {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of sourceStream) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > 5 * 1_048_576) {
        throw new Error("Agent-only uploads are limited to 5 MB; enable target direct access for larger files");
      }
      chunks.push(buffer);
    }
    await writeRemoteFile({ ...toConnectionParams(conn), remotePath: path, content: Buffer.concat(chunks) });
    return size;
  }
  const session = await openSftpSession(serverId);

  try {
    const writeStream = session.sftp.createWriteStream(path, {
      flags: "w",
      mode: 0o644,
      autoClose: true,
    });

    let bytesWritten = 0;

    return await new Promise<number>((resolve, reject) => {
      let settled = false;
      let idleTimer: NodeJS.Timeout | undefined;
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        // Destroy both ends so a half-failed pipe cannot leave the SSH
        // session open after we reject (resource leak / fd exhaustion).
        try {
          sourceStream.destroy(err);
        } catch {
          /* best-effort */
        }
        try {
          // ssh2 WriteStream.destroy typings omit the optional error arg.
          (writeStream as unknown as { destroy: (err?: Error) => void }).destroy(err);
        } catch {
          /* best-effort */
        }
        reject(err);
      };
      // Reset on progress; fire only after a true stall (no data for the idle
      // window) so an abandoned/hung upload frees the session instead of pinning
      // it until GC.
      const resetIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(
          () => fail(new Error(t("backend.ssh.uploadStalled", { seconds: SFTP_TRANSFER_IDLE_TIMEOUT_MS / 1000 }))),
          SFTP_TRANSFER_IDLE_TIMEOUT_MS,
        );
      };

      sourceStream.on("data", (chunk: Buffer) => {
        bytesWritten += chunk.length;
        resetIdle();
      });
      sourceStream.on("error", (err: Error) => {
        fail(new Error(`Upload source error: ${err.message}`));
      });

      writeStream.on("error", (err: Error) => {
        fail(new Error(`Upload write error: ${err.message}`));
      });

      // ssh2 WriteStream emits "close" after autoClose; Node Writable also
      // emits "finish" when the final write completes. Accept either so we
      // always settle (and the outer finally can tear down the SSH session).
      const succeed = () => {
        if (settled) return;
        settled = true;
        if (idleTimer) clearTimeout(idleTimer);
        resolve(bytesWritten);
      };
      writeStream.on("close", succeed);
      writeStream.on("finish", succeed);

      resetIdle();
      sourceStream.pipe(writeStream);
    });
  } finally {
    // Always tear down the per-op SSH/SFTP session — including the success
    // path. The previous implementation only closed on sync throw before the
    // pipe started, leaking connections on every successful upload.
    session.close();
  }
}

/**
 * Download a remote file as a readable stream.
 * The caller is responsible for consuming the stream — when the stream
 * ends or errors, the SFTP session is automatically cleaned up.
 */
export async function downloadFile(
  serverId: string,
  remotePath: string,
): Promise<{ stream: Readable; size: number }> {
  const path = sanitizeRemotePath(remotePath);
  const conn = await resolveServerConnection(serverId);
  if (isAgentOnly(conn)) {
    const content = await readRemoteFile({ ...toConnectionParams(conn), remotePath: path });
    return { stream: Readable.from(content), size: content.length };
  }
  const session = await openSftpSession(serverId);

  // Get file size for Content-Length header
  // Wrap stat in try/catch so a stat failure (missing file, permission denied)
  // does not leak the SSH/SFTP session -- close before re-throwing.
  let stats: Stats;
  try {
    stats = await new Promise<Stats>((resolve, reject) => {
      session.sftp.stat(path, (err, s) => {
        if (err) reject(err);
        else resolve(s);
      });
    });
  } catch (err) {
    session.close();
    throw err;
  }

  if (stats.isDirectory()) {
    session.close();
    throw new Error("Cannot download a directory");
  }

  const readStream = session.sftp.createReadStream(path, {
    autoClose: true,
  });

  const passthrough = new PassThrough();

  // Tear the SSH/SFTP session down exactly once, from whichever end settles
  // first: a read error, the read finishing, the consumer aborting (HTTP client
  // disconnect), or an idle stall. `.pipe()` does NOT auto-destroy the source
  // when the destination is destroyed, so without the passthrough "close"
  // handler a cancelled download would pin the SSH connection until GC.
  let closed = false;
  let idleTimer: NodeJS.Timeout | undefined;
  const teardown = () => {
    if (closed) return;
    closed = true;
    if (idleTimer) clearTimeout(idleTimer);
    try {
      readStream.destroy();
    } catch {
      /* best-effort */
    }
    session.close();
  };
  // Abort a stalled read (remote stops sending) so a hung download cannot pin
  // the session — and, for the VPS-backup job caller, hang the worker forever.
  // Reset on every chunk so a slow-but-progressing large file is never killed.
  const resetIdle = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      passthrough.destroy(
        new Error(t("backend.ssh.downloadStalled", { seconds: SFTP_TRANSFER_IDLE_TIMEOUT_MS / 1000 })),
      );
    }, SFTP_TRANSFER_IDLE_TIMEOUT_MS);
  };

  readStream.on("error", (err: Error) => {
    logger.error("SFTP download stream error", err, { serverId, path });
    passthrough.destroy(err);
    teardown();
  });

  readStream.on("close", teardown);
  readStream.on("data", resetIdle);
  // Consumer abort / passthrough error must also release the session.
  passthrough.on("close", teardown);

  resetIdle();
  readStream.pipe(passthrough);

  return { stream: passthrough, size: stats.size };
}

export async function deleteFile(
  serverId: string,
  remotePath: string,
): Promise<void> {
  const path = sanitizeRemotePath(remotePath);
  const conn = await resolveServerConnection(serverId);
  const params = toConnectionParams(conn);
  try {
    const stats = await statRemoteEntry({ ...params, remotePath: path });
    await deleteRemoteFile({ ...params, remotePath: path, isDirectory: stats.type === "directory" });
  } catch (error) {
    mapSftpError(error);
  }
}

export async function makeDirectory(
  serverId: string,
  remotePath: string,
): Promise<void> {
  const path = sanitizeRemotePath(remotePath);
  const conn = await resolveServerConnection(serverId);
  try {
    await createRemoteDirectory({ ...toConnectionParams(conn), remotePath: path });
  } catch (error) {
    mapSftpError(error);
  }
}

export async function renameEntry(
  serverId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const src = sanitizeRemotePath(oldPath);
  const dst = sanitizeRemotePath(newPath);
  const conn = await resolveServerConnection(serverId);
  try {
    await renameRemoteFile({ ...toConnectionParams(conn), oldPath: src, newPath: dst });
  } catch (error) {
    mapSftpError(error);
  }
}
