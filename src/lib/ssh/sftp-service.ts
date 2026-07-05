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
import { createVerifiedSshConfig } from "@/lib/ssh/client";
import type { Stats, FileEntryWithStats } from "ssh2";
import { Readable, Writable, PassThrough } from "node:stream";
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

/** Reject filenames that contain path separators or null bytes. */
export function sanitizeFileName(raw: string): string {
  if (!raw || typeof raw !== "string") {
    throw new Error("Filename must be a non-empty string");
  }
  if (raw.includes("\0") || raw.includes("/") || raw.includes("\\..")) {
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
      hostKeySha256: true,
      sshKey: { select: { privateKey: true, passphrase: true } },
    },
  });

  if (!srv || !srv.enabled) {
    throw new Error("Server not found or disabled");
  }

  if (srv.connectionType === "SSH_KEY" && !srv.sshKey?.privateKey) {
    throw new Error("SSH key not configured for this server");
  }
  if (srv.connectionType === "PASSWORD" && !srv.password) {
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
  };
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
      try { client.end(); } catch {}
      reject(new Error("SSH connection timed out"));
    }, 15000);

    client.on("ready", () => {
      client.sftp((err, sftp) => {
        clearTimeout(timeout);
        if (err) {
          try { client.end(); } catch {}
          reject(new Error(`SFTP subsystem error: ${err.message}`));
          return;
        }
        resolve({
          sftp,
          client,
          close: () => {
            try { sftp.end(); } catch {}
            try { client.end(); } catch {}
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

function toDirEntry(entry: FileEntryWithStats): SftpDirEntry {
  const stats = entry.attrs;
  return {
    name: entry.filename,
    longname: entry.longname,
    isDirectory: stats.isDirectory(),
    isFile: stats.isFile(),
    isSymlink: stats.isSymbolicLink(),
    size: stats.size,
    modifyTime: stats.mtime,
    accessTime: stats.atime,
    owner: stats.uid,
    group: stats.gid,
  };
}

export async function listDirectory(
  serverId: string,
  remotePath: string,
): Promise<SftpDirEntry[]> {
  const path = sanitizeRemotePath(remotePath);
  const session = await openSftpSession(serverId);

  try {
    const entries = await new Promise<FileEntryWithStats[]>((resolve, reject) => {
      session.sftp.readdir(path, (err, list) => {
        if (err) reject(err);
        else resolve(list);
      });
    });

    // Sort: directories first, then files, alphabetically
    const result = entries.map(toDirEntry);
    result.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return result;
  } finally {
    session.close();
  }
}

export async function statEntry(
  serverId: string,
  remotePath: string,
): Promise<SftpStat> {
  const path = sanitizeRemotePath(remotePath);
  const session = await openSftpSession(serverId);

  try {
    const stats = await new Promise<Stats>((resolve, reject) => {
      session.sftp.stat(path, (err, s) => {
        if (err) reject(err);
        else resolve(s);
      });
    });

    return {
      mode: stats.mode,
      size: stats.size,
      isDirectory: stats.isDirectory(),
      isFile: stats.isFile(),
      isSymlink: stats.isSymbolicLink(),
      modifyTime: stats.mtime,
      accessTime: stats.atime,
    };
  } finally {
    session.close();
  }
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
  const session = await openSftpSession(serverId);

  try {
    const writeStream = session.sftp.createWriteStream(path, {
      flags: "w",
      mode: 0o644,
      autoClose: true,
    });

    let bytesWritten = 0;

    return new Promise<number>((resolve, reject) => {
      sourceStream.on("data", (chunk: Buffer) => {
        bytesWritten += chunk.length;
      });

      writeStream.on("error", (err: Error) => {
        reject(new Error(`Upload write error: ${err.message}`));
      });

      writeStream.on("close", () => {
        resolve(bytesWritten);
      });

      sourceStream.pipe(writeStream);
    });
  } catch (err) {
    session.close();
    throw err;
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
  const session = await openSftpSession(serverId);

  // Get file size for Content-Length header
  const stats = await new Promise<Stats>((resolve, reject) => {
    session.sftp.stat(path, (err, s) => {
      if (err) reject(err);
      else resolve(s);
    });
  });

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
  const session = await openSftpSession(serverId);

  try {
    // Check if path is a directory
    const stats = await new Promise<Stats>((resolve, reject) => {
      session.sftp.stat(path, (err, s) => {
        if (err) reject(err);
        else resolve(s);
      });
    });

    if (stats.isDirectory()) {
      throw new Error("Cannot delete a directory — use recursive delete");
    }

    await new Promise<void>((resolve, reject) => {
      session.sftp.unlink(path, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    session.close();
  }
}

export async function makeDirectory(
  serverId: string,
  remotePath: string,
): Promise<void> {
  const path = sanitizeRemotePath(remotePath);
  const session = await openSftpSession(serverId);

  try {
    await new Promise<void>((resolve, reject) => {
      session.sftp.mkdir(path, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    session.close();
  }
}

export async function renameEntry(
  serverId: string,
  oldPath: string,
  newPath: string,
): Promise<void> {
  const src = sanitizeRemotePath(oldPath);
  const dst = sanitizeRemotePath(newPath);
  const session = await openSftpSession(serverId);

  try {
    await new Promise<void>((resolve, reject) => {
      session.sftp.rename(src, dst, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  } finally {
    session.close();
  }
}

/** Get the home directory of the remote user (used as default browse path). */
export async function getHomeDirectory(serverId: string): Promise<string> {
  const session = await openSftpSession(serverId);

  try {
    // Try realpath on "." to get the home directory
    const home = await new Promise<string>((resolve, reject) => {
      session.sftp.realpath(".", (err: Error | undefined, absPath: string) => {
        if (err) reject(err);
        else resolve(absPath);
      });
    });
    return home;
  } catch {
    // Fallback: if realpath fails, use common default
    return "/root";
  } finally {
    session.close();
  }
}
