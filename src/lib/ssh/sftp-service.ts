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
import { prisma } from "@/lib/db";
import { decryptServerPassword, decryptSshPrivateKey, decryptSshKeyPassphrase } from "@/lib/ssh/ssh-key-crypto";
import { createLogger } from "@/lib/logging";

const logger = createLogger("sftp-service");

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
  if (
    raw.includes("\0") ||
    raw.includes("/") ||
    raw.includes("\\") ||
    raw === "." ||
    raw === ".." ||
    raw.includes("..")
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
  const srv = await prisma.server.findUnique({
    where: { id: serverId },
    select: {
      id: true,
      host: true,
      port: true,
      username: true,
      enabled: true,
      connectionType: true,
      password: true,
      managementMode: true,
      hostKeySha256: true,
      sshKey: { select: { privateKey: true, passphrase: true } },
    },
  });

  if (!srv || !srv.enabled) {
    throw new Error("Server not found or disabled");
  }

  const agentServerId = srv.managementMode === "AGENT" ? srv.id : undefined;
  if (srv.connectionType === "SSH_KEY" && !srv.sshKey?.privateKey && !agentServerId) {
    throw new Error("SSH key not configured for this server");
  }
  if (srv.connectionType === "PASSWORD" && !srv.password && !agentServerId) {
    throw new Error("Password not configured for this server");
  }

  return {
    host: srv.host,
    port: srv.port,
    username: srv.username,
    connectionType: srv.connectionType,
    hostKeySha256: srv.hostKeySha256,
    privateKey:
      srv.connectionType === "SSH_KEY" && srv.sshKey?.privateKey
        ? decryptSshPrivateKey(srv.sshKey!.privateKey ?? "")
        : undefined,
    passphrase:
      srv.connectionType === "SSH_KEY" && srv.sshKey?.passphrase
        ? decryptSshKeyPassphrase(srv.sshKey!.passphrase)
        : undefined,
    password:
      srv.connectionType === "PASSWORD"
        ? decryptServerPassword(srv.password ?? "")
        : undefined,
    ...(agentServerId ? { agentServerId } : {}),
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
      reject(new Error("SSH connection timed out"));
    }, 15000);

    client.on("ready", () => {
      client.sftp((err, sftp) => {
        clearTimeout(timeout);
        if (err) {
          try { client.end(); } catch { /* best-effort cleanup on SFTP error */ }
          reject(new Error(`SFTP subsystem error: ${err.message}`));
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
      reject(new Error(`SSH connection error: ${err.message}`));
    });

    const config = createVerifiedSshConfig({
      host: conn.host,
      port: conn.port,
      username: conn.username,
      hostKeySha256: conn.hostKeySha256,
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
      const fail = (err: Error) => {
        if (settled) return;
        settled = true;
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

      sourceStream.on("data", (chunk: Buffer) => {
        bytesWritten += chunk.length;
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
        resolve(bytesWritten);
      };
      writeStream.on("close", succeed);
      writeStream.on("finish", succeed);

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

  readStream.on("error", (err: Error) => {
    logger.error("SFTP download stream error", err, { serverId, path });
    passthrough.destroy(err);
    session.close();
  });

  readStream.on("close", () => {
    session.close();
  });

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
  const stats = await statRemoteEntry({ ...params, remotePath: path });
  await deleteRemoteFile({ ...params, remotePath: path, isDirectory: stats.type === "directory" });
}

export async function makeDirectory(
  serverId: string,
  remotePath: string,
): Promise<void> {
  const path = sanitizeRemotePath(remotePath);
  const conn = await resolveServerConnection(serverId);
  await createRemoteDirectory({ ...toConnectionParams(conn), remotePath: path });
}

export async function renameEntry(
  serverId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const src = sanitizeRemotePath(oldPath);
  const dst = sanitizeRemotePath(newPath);
  const conn = await resolveServerConnection(serverId);
  await renameRemoteFile({ ...toConnectionParams(conn), oldPath: src, newPath: dst });
}
