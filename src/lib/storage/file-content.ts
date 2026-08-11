import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat as statFile,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { randomUUID } from "node:crypto";

import { Client } from "ssh2";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { connectSsh, createRemoteDirectory, deleteRemoteFile, readRemoteFile, writeRemoteFile } from "@/lib/ssh/client";
import { prisma } from "@/lib/db";
import { BusinessError, ValidationError } from "@/lib/errors";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import {
  normalizeRemoteTargetPath,
  normalizeRemoteRelativePath,
} from "@/lib/storage/remote-path";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { t } from "@/lib/i18n/service-translations";

export type StorageFileNode = {
  id: string;
  driver: "LOCAL" | "SFTP" | string;
  basePath: string;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  password?: string | null;
  hostKeySha256?: string | null;
  serverId?: string | null;
  server?: {
    id?: string;
    host?: string | null;
    port?: number | null;
    username?: string | null;
    connectionType?: string | null;
    password?: string | null;
    hostKeySha256?: string | null;
    sshKey?: { privateKey?: string | null } | null;
  } | null;
};

export const storageFileNodeSelect = {
  id: true,
  driver: true,
  basePath: true,
  host: true,
  port: true,
  username: true,
  hostKeySha256: true,
  serverId: true,
  server: {
    select: {
      id: true,
      host: true,
      port: true,
      username: true,
      connectionType: true,
      managementMode: true,
      password: true,
      hostKeySha256: true,
      sshKey: {
        select: {
          privateKey: true,
        },
      },
    },
  },
} as const;

function sftpReadFile(client: Client, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.readFile(remotePath, (readErr, data) => {
        if (readErr) return reject(readErr);
        resolve(Buffer.isBuffer(data) ? data : Buffer.from(data));
      });
    });
  });
}

export async function readStorageFileBuffer(
  node: StorageFileNode,
  relativePath: string,
) {
  if (node.driver === "LOCAL") {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (!resolved.ok) throw new ValidationError(resolved.reason);
    return readFile(resolved.path);
  }

  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const normalizedRemotePath = normalizeRemoteTargetPath(
      node.basePath,
      relativePath,
    );
    if (credentials.agentServerId && !credentials.privateKey && !credentials.password) {
      return readRemoteFile({ ...credentials, remotePath: normalizedRemotePath });
    }
    let client: Client | null = null;
    try {
      client = await connectSsh({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        hostKeySha256: credentials.hostKeySha256,
        agentServerId: credentials.agentServerId,
        privateKey: credentials.privateKey,
        password: credentials.password,
        readyTimeout: 15000,
        timeout: 10000,
      });
      return await sftpReadFile(client, normalizedRemotePath);
    } finally {
      client?.end();
    }
  }

  throw new BusinessError(t("backend.storage.unsupportedNodeType"));
}

export async function streamStorageFile(
  node: StorageFileNode,
  relativePath: string,
  range?: { start: number; end: number },
) {
  if (node.driver === "LOCAL") {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (!resolved.ok) throw new ValidationError(resolved.reason);
    const stats = await statFile(resolved.path);
    const stream = createReadStream(resolved.path, range);
    return { stream, size: stats.size, close: () => stream.destroy() };
  }
  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const normalizedRemotePath = normalizeRemoteTargetPath(
      node.basePath,
      relativePath,
    );
    if (credentials.agentServerId && !credentials.privateKey && !credentials.password) {
      const buffer = await readRemoteFile({ ...credentials, remotePath: normalizedRemotePath });
      const selected = range ? buffer.subarray(range.start, Math.min(buffer.length, range.end + 1)) : buffer;
      const stream = Readable.from(selected);
      return { stream, size: buffer.length, close: () => stream.destroy() };
    }
    const client = await connectSsh({
      host: credentials.host,
      port: credentials.port,
      username: credentials.username,
      hostKeySha256: credentials.hostKeySha256,
      agentServerId: credentials.agentServerId,
      privateKey: credentials.privateKey,
      password: credentials.password,
      readyTimeout: 15000,
      timeout: 10000,
    });
    try {
      const result = await new Promise<{
        stream: NodeJS.ReadableStream;
        size: number;
      }>((resolve, reject) =>
        client.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.stat(normalizedRemotePath, (statErr, stats) =>
            statErr
              ? reject(statErr)
              : resolve({
                  stream: sftp.createReadStream(normalizedRemotePath, range),
                  size: stats.size,
                }),
          );
        }),
      );
      return { ...result, close: () => client.end() };
    } catch (error) {
      client.end();
      throw error;
    }
  }
  throw new BusinessError(t("backend.storage.unsupportedNodeType"));
}

function sftpMkdir(client: Client, remoteDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      const normalized = normalizeRemoteRelativePath(remoteDir).replace(
        /\/$/,
        "",
      );
      const absolute = remoteDir.startsWith("/");
      const segments = normalized.split("/").filter(Boolean);
      let current = absolute ? "/" : "";
      const ensureNext = (index: number) => {
        if (index >= segments.length) return resolve();
        current =
          current === "/"
            ? `/${segments[index]!}`
            : current
              ? `${current}/${segments[index]!}`
              : segments[index]!;
        sftp.stat(current, (statErr) => {
          if (!statErr) return ensureNext(index + 1);
          sftp.mkdir(current, (mkdirErr) => {
            if (!mkdirErr) return ensureNext(index + 1);
            sftp.stat(current, (verifyErr, stats) => {
              if (!verifyErr && stats?.isDirectory())
                return ensureNext(index + 1);
              reject(mkdirErr);
            });
          });
        });
      };
      ensureNext(0);
    });
  });
}

function sftpWriteFile(
  client: Client,
  remotePath: string,
  buffer: Buffer,
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.writeFile(remotePath, buffer, (writeErr) => {
        if (writeErr) return reject(writeErr);
        resolve();
      });
    });
  });
}

function sftpUnlink(client: Client, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.unlink(remotePath, (unlinkErr) => {
        if (unlinkErr) return reject(unlinkErr);
        resolve();
      });
    });
  });
}

export async function writeStorageFileBuffer(
  node: StorageFileNode,
  relativePath: string,
  buffer: Buffer,
) {
  if (node.driver === "LOCAL") {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (!resolved.ok) throw new ValidationError(resolved.reason);
    await mkdir(path.dirname(resolved.path), { recursive: true });
    await writeFile(resolved.path, buffer);
    return resolved.path;
  }

  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const normalizedRemotePath = normalizeRemoteTargetPath(
      node.basePath,
      relativePath,
    );
    if (credentials.agentServerId && !credentials.privateKey && !credentials.password) {
      await createRemoteDirectory({ ...credentials, remotePath: path.posix.dirname(normalizedRemotePath), recursive: true });
      await writeRemoteFile({ ...credentials, remotePath: normalizedRemotePath, content: buffer });
      return normalizedRemotePath;
    }
    let client: Client | null = null;
    try {
      client = await connectSsh({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        hostKeySha256: credentials.hostKeySha256,
        agentServerId: credentials.agentServerId,
        privateKey: credentials.privateKey,
        password: credentials.password,
        readyTimeout: 15000,
        timeout: 10000,
      });
      await sftpMkdir(client, path.posix.dirname(normalizedRemotePath));
      await sftpWriteFile(client, normalizedRemotePath, buffer);
      return normalizedRemotePath;
    } finally {
      client?.end();
    }
  }

  throw new BusinessError(t("backend.storage.unsupportedNodeType"));
}

/**
 * Best-effort delete of a previously written storage object (LOCAL or SFTP).
 * Used for compensating cleanup when DB indexing fails after a successful write.
 */
export async function deleteStorageFileBuffer(
  node: StorageFileNode,
  relativePath: string,
) {
  if (node.driver === "LOCAL") {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (!resolved.ok) throw new ValidationError(resolved.reason);
    await rm(resolved.path, { force: true });
    return resolved.path;
  }

  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const normalizedRemotePath = normalizeRemoteTargetPath(
      node.basePath,
      relativePath,
    );
    if (credentials.agentServerId && !credentials.privateKey && !credentials.password) {
      await deleteRemoteFile({ ...credentials, remotePath: normalizedRemotePath });
      return normalizedRemotePath;
    }
    let client: Client | null = null;
    try {
      client = await connectSsh({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        hostKeySha256: credentials.hostKeySha256,
        agentServerId: credentials.agentServerId,
        privateKey: credentials.privateKey,
        password: credentials.password,
        readyTimeout: 15000,
        timeout: 10000,
      });
      await sftpUnlink(client, normalizedRemotePath);
      return normalizedRemotePath;
    } finally {
      client?.end();
    }
  }

  throw new BusinessError(t("backend.storage.unsupportedNodeType"));
}

/**
 * Stream-copy a file within the same storage node into a temporary sibling path,
 * then promote to the final destination. Avoids full-file buffering for large COPY.
 */
export async function copyStorageFile(
  node: StorageFileNode,
  sourceRelativePath: string,
  destinationRelativePath: string,
): Promise<{ size: number }> {
  if (sourceRelativePath === destinationRelativePath) {
    throw new ValidationError(t("backend.storage.copySourceDestinationMustDiffer"));
  }

  if (node.driver === "LOCAL") {
    const source = resolveStoragePathWithinBase(
      node.basePath,
      sourceRelativePath,
    );
    if (!source.ok) throw new ValidationError(source.reason);
    const dest = resolveStoragePathWithinBase(
      node.basePath,
      destinationRelativePath,
    );
    if (!dest.ok) throw new ValidationError(dest.reason);
    const tempPath = `${dest.path}.vch-copy-${randomUUID()}.tmp`;
    try {
      await mkdir(path.dirname(dest.path), { recursive: true });
      await copyFile(source.path, tempPath);
      const stats = await statFile(tempPath);
      await rename(tempPath, dest.path);
      return { size: stats.size };
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const sourceRemote = normalizeRemoteTargetPath(
      node.basePath,
      sourceRelativePath,
    );
    const destRemote = normalizeRemoteTargetPath(
      node.basePath,
      destinationRelativePath,
    );
    const tempRemote = `${destRemote}.vch-copy-${randomUUID()}.tmp`;
    if (credentials.agentServerId && !credentials.privateKey && !credentials.password) {
      const buffer = await readRemoteFile({ ...credentials, remotePath: sourceRemote });
      await createRemoteDirectory({ ...credentials, remotePath: path.posix.dirname(destRemote), recursive: true });
      await writeRemoteFile({ ...credentials, remotePath: destRemote, content: buffer });
      return { size: buffer.length };
    }
    let client: Client | null = null;
    try {
      client = await connectSsh({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        hostKeySha256: credentials.hostKeySha256,
        agentServerId: credentials.agentServerId,
        privateKey: credentials.privateKey,
        password: credentials.password,
        readyTimeout: 15000,
        timeout: 10000,
      });
      await sftpMkdir(client, path.posix.dirname(destRemote));
      await new Promise<void>((resolve, reject) => {
        client!.sftp((err, sftp) => {
          if (err) return reject(err);
          const readStream = sftp.createReadStream(sourceRemote);
          const writeStream = sftp.createWriteStream(tempRemote);
          pipeline(readStream, writeStream).then(resolve).catch(reject);
        });
      });
      const size = await new Promise<number>((resolve, reject) => {
        client!.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.stat(tempRemote, (statErr, stats) =>
            statErr ? reject(statErr) : resolve(stats.size),
          );
        });
      });
      await new Promise<void>((resolve, reject) => {
        client!.sftp((err, sftp) => {
          if (err) return reject(err);
          sftp.rename(tempRemote, destRemote, (renameErr) =>
            renameErr ? reject(renameErr) : resolve(),
          );
        });
      });
      return { size };
    } catch (error) {
      if (client) {
        await new Promise<void>((resolve) => {
          client!.sftp((err, sftp) => {
            if (err || !sftp) return resolve();
            sftp.unlink(tempRemote, () => resolve());
          });
        }).catch(() => undefined);
      }
      throw error;
    } finally {
      client?.end();
    }
  }

  throw new BusinessError(t("backend.storage.unsupportedNodeType"));
}

export function buildStorageFileDownloadUrl(
  node: Pick<StorageFileNode, "id" | "driver">,
  relativePath: string,
  download = false,
) {
  const params = new URLSearchParams({
    nodeId: node.id,
    path: normalizeRemoteRelativePath(relativePath),
  });
  if (download) params.set("download", "1");
  if (node.driver === "SFTP")
    return `/api/storage/sftp-download?${params.toString()}`;
  return `/api/storage/local?${params.toString()}`;
}

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

/**
 * Load a storage node for file I/O. When `session` is provided, applies
 * `teamWhere` so callers cannot open another team's node by id (IDOR).
 */
export async function getStorageFileNode(
  storageNodeId: string,
  session?: TeamSession | null,
) {
  return prisma.storageNode.findFirst({
    where: {
      id: storageNodeId,
      ...(session ? teamWhere(session) : {}),
    },
    select: storageFileNodeSelect,
  });
}
