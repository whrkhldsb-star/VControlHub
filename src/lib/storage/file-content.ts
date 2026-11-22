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

import { sftpRequest } from "@/lib/ssh/sftp-operations";
import { matchTargetMode } from "./local-permissions";
import { localPathVersion, withMovedLocalVersion } from "./local-identity";
import { Client } from "ssh2";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { AGENT_FILE_MAX_BYTES, connectSsh, createRemoteDirectory, deleteRemoteFile, readRemoteFile, writeRemoteFile, renameRemoteFile } from "@/lib/ssh/client";
import { prisma } from "@/lib/db";
import { BusinessError, ConflictError, ValidationError } from "@/lib/errors";
import { resolveStorageSshCredentials, type StorageSshCredentialNode } from "@/lib/storage/ssh-credentials";
import { normalizeRemoteRelativePath, normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { resolveStorageRemotePath } from "@/lib/storage/remote-containment";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { t } from "@/lib/i18n/service-translations";
import { createWebDavClient } from "@/lib/storage/webdav-client";
import { createAgentFileClient, createRemoteStorageClient } from "@/lib/storage/agent-file-client";
import { publishLocalFile } from "@/lib/storage/publish-local-file";
import { createLogger } from "@/lib/logging";
import { managedSftpWriteRoot, readBackingObject, statBackingObject, writeBackingObject } from "./fs-backend";
import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";

/** A node as storageFileNodeSelect loads it (the SFTP connection in full). */
export type StorageFileNode = StorageSshCredentialNode & {
  id: string;
  expectedRoot?: string;
  agentFileShare?: { rootIdentity: string | null } | null;
  driver: "LOCAL" | "SFTP" | string;
  basePath: string;
  webdavConfigEncrypted?: string | null;
  password?: string | null;
  serverId?: string | null;
};

export const storageFileNodeSelect = {
  id: true,
  agentFileShare: { select: { rootIdentity: true } },
  driver: true,
  basePath: true,
  webdavConfigEncrypted: true,
  host: true,
  port: true,
  username: true,
  teamId: true,
  hostKeySha256: true,
  serverId: true,
  server: {
    select: {
      id: true,
      teamId: true,
      host: true,
      port: true,
      username: true,
      connectionType: true,
      managementMode: true,
      agentTokenHash: true,
      operatingSystem: true,
      password: true,
      hostKeySha256: true,
      sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
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
  maxBytes?: number,
) {
  if (maxBytes !== undefined) return readBackingObject({ storageNode: node, relativePath, maxBytes });
  if (node.driver === "WEBDAV" || node.driver === "AGENT") return createRemoteStorageClient(node).read(relativePath);
  if (node.driver === "LOCAL") {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (!resolved.ok) throw new ValidationError(resolved.reason);
    return readFile(resolved.path);
  }

  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const normalizedRemotePath = (await resolveStorageRemotePath(node, relativePath, { credentials })).remotePath;
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
        enforceHostKeyPin: true,
        agentServerId: credentials.agentServerId,
        privateKey: credentials.privateKey,
        passphrase: credentials.passphrase,
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
  if (node.driver === "WEBDAV" || node.driver === "AGENT") {
    const client = createRemoteStorageClient(node);
    const entry = await client.stat(relativePath);
    if (!entry || entry.isDirectory) throw new ValidationError(t("backend.webdav.fileNotFound"));
    const stream = Readable.fromWeb(await client.stream(relativePath, range, entry.size, entry.etag) as import("node:stream/web").ReadableStream);
    return { stream, size: entry.size, close: () => stream.destroy() };
  }
  if (node.driver === "LOCAL") {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (!resolved.ok) throw new ValidationError(resolved.reason);
    const stats = await statFile(resolved.path);
    const stream = createReadStream(resolved.path, range);
    return { stream, size: stats.size, close: () => stream.destroy() };
  }
  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const normalizedRemotePath = (await resolveStorageRemotePath(node, relativePath, { credentials })).remotePath;
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
      enforceHostKeyPin: true,
      agentServerId: credentials.agentServerId,
      privateKey: credentials.privateKey,
      passphrase: credentials.passphrase,
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
  if (node.driver === "WEBDAV" || node.driver === "AGENT") {
    const client = createRemoteStorageClient(node);
    const parent = path.posix.dirname(relativePath);
    if (parent !== ".") {
      let directory = "";
      for (const part of parent.split("/").filter(Boolean)) {
        directory = directory ? `${directory}/${part}` : part;
        const existing = await client.stat(directory);
        if (existing && !existing.isDirectory) throw new ValidationError(t("backend.webdav.parentNotDirectory"));
        if (!existing) await client.mkdir(directory);
      }
    }
    await client.write(relativePath, buffer);
    return relativePath;
  }
  if (node.driver === "LOCAL") {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (!resolved.ok) throw new ValidationError(resolved.reason);
    await mkdir(path.dirname(resolved.path), { recursive: true });
    // Write beside the target and rename: a crash mid-write must not leave a
    // truncated file under the real name (A4-26).
    const temporaryPath = path.join(path.dirname(resolved.path), `.vch-write-${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, buffer, { flag: "wx", mode: 0o600 });
      await matchTargetMode(temporaryPath, resolved.path);
      await rename(temporaryPath, resolved.path);
    } finally { await rm(temporaryPath, { force: true }).catch(() => undefined); }
    return resolved.path;
  }

  if (node.driver === "SFTP") {
    await writeBackingObject({ storageNode: node, relativePath, content: buffer });
    return normalizeRemoteTargetPath(node.basePath, relativePath);
  }

  throw new BusinessError(t("backend.storage.unsupportedNodeType"));
}

function sftpVersion(attrs: { size: number; mtime: number }) {
  return [attrs.size, attrs.mtime * 1000].join(":");
}

/** SFTP v3 RENAME refuses an occupied name. Only POSIX rename can replace it atomically. */
async function sftpAtomicRename(sftp: import("ssh2").SFTPWrapper, from: string, to: string, expected?: string | null): Promise<void> {
  const renameExclusive = (source: string, target: string) => new Promise<void>((resolve, reject) =>
    sftp.rename(source, target, error => error ? reject(error) : resolve()));
  const target = await new Promise<import("ssh2").Stats | null>((resolve, reject) =>
    sftp.lstat(to, (error, stats) => {
      if (!error) return resolve(stats);
      if ((error as { code?: number }).code === 2) return resolve(null);
      reject(error);
    }));
  if (expected !== undefined && expected !== (target ? sftpVersion(target) : null)) throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
  if (!target) return renameExclusive(from, to);
  if (!target.isFile()) throw new ConflictError(t("backend.storage.targetIsDirectory"));
  const staged = await sftpRequest<import("ssh2").Stats>(done => sftp.lstat(from, done));
  if (target.uid !== staged.uid || target.gid !== staged.gid) {
    await sftpRequest<void>(done => sftp.chown(from, target.uid, target.gid, done));
  }
  if ((target.mode & 0o777) !== (staged.mode & 0o777) || staged.uid !== target.uid || staged.gid !== target.gid) {
    await sftpRequest<void>(done => sftp.chmod(from, target.mode & 0o777, done));
  }
  const applied = await sftpRequest<import("ssh2").Stats>(done => sftp.lstat(from, done));
  if (applied.uid !== target.uid || applied.gid !== target.gid || (applied.mode & 0o777) !== (target.mode & 0o777)) {
    throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
  }
  try {
    await new Promise<void>((resolve, reject) =>
      sftp.ext_openssh_rename(from, to, error => error ? reject(error) : resolve()));
    return;
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    // ssh2 throws synchronously when the extension was not advertised.
    if (code !== 8 && (code !== undefined || !(error instanceof Error) ||
        !/unsupported|not supported|does not support/i.test(error.message))) throw error;
  }

  const backup = path.posix.join(path.posix.dirname(to), `.vch-backup-${randomUUID()}`);
  await renameExclusive(to, backup);
  try {
    await renameExclusive(from, to);
  } catch (error) {
    // A competing/ambiguously published file keeps its name. Retain the backup if restoration fails.
    await renameExclusive(backup, to).catch(rollbackError =>
      createLogger("storage:sftp").error("SFTP publish rollback failed", { to, backup, error, rollbackError }));
    throw error;
  }
  await new Promise<void>((resolve, reject) =>
    sftp.unlink(backup, error => error ? reject(error) : resolve()))
    .catch(error => createLogger("storage:sftp").warn("SFTP publish backup cleanup failed", { backup, error }));
}

/**
 * Stores a staged upload (`sourcePath`) as `relativePath` on the node. The source is its caller's to discard:
 * on a local node it is moved into place when it is on the same filesystem, so it may be gone afterwards.
 */
export async function writeStorageFileFromLocalPath(node: StorageFileNode, relativePath: string, sourcePath: string, upload?: { checksum?: string; beforePublish?: () => Promise<void>; expectedVersion?: string | null; onPublished?: (created: boolean) => void; onVersion?: (version: string | null) => void }) {
  if (node.driver === "AGENT") {
    const version = await createAgentFileClient(node.id, undefined, node.expectedRoot)
      .writeLocal(relativePath, sourcePath, upload?.checksum, upload?.beforePublish, upload?.expectedVersion, upload?.onPublished);
    upload?.onVersion?.(version);
    return relativePath;
  }
  if (node.driver === "LOCAL") {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (!resolved.ok) throw new ValidationError(resolved.reason);
    // Beside the target but not named after it: a name close to the 255-byte limit plus a suffix cannot be created.
    const temporaryPath = path.join(path.dirname(resolved.path), `.vch-upload-${randomUUID()}.tmp`);
    try {
      await mkdir(path.dirname(resolved.path), { recursive: true });
      // Moved, not copied, where staging and the node share a filesystem (the default layout): the copy
      // wrote an upload a third time, after its chunks and its assembled file. Any refusal to move
      // (another filesystem, a directory the source cannot be taken out of) falls back to the copy.
      await rename(sourcePath, temporaryPath).catch(() => copyFile(sourcePath, temporaryPath));
      // The assembled upload is 0600 in the temp dir; a move or copyFile keeps that, and a
      // web root served by another account then answered 403 (A4-01).
      const expected = upload?.expectedVersion === undefined && upload?.onPublished
        ? await localPathVersion(node.basePath, relativePath) : upload?.expectedVersion;
      await matchTargetMode(temporaryPath, resolved.path);
      if (upload?.onVersion) upload.onVersion(String((await statFile(temporaryPath)).mtimeMs));
      if (expected === null) {
        await publishLocalFile(temporaryPath, resolved.path, relativePath);
        upload?.onPublished?.(true);
      } else if (expected !== undefined) {
        await withMovedLocalVersion(resolved.path, expected, async backup => {
          await publishLocalFile(temporaryPath, resolved.path, relativePath);
          await rm(backup);
        });
        upload?.onPublished?.(false);
      } else await rename(temporaryPath, resolved.path);
      return resolved.path;
    } finally { await rm(temporaryPath, { force: true }).catch(() => undefined); }
  }
  const temporaryRelativePath = path.posix.join(path.posix.dirname(relativePath), `.vch-upload-${randomUUID()}.tmp`);
  if (node.driver === "WEBDAV") {
    const client = createWebDavClient(node);
    const parent = path.posix.dirname(relativePath);
    if (parent !== ".") {
      let directory = "";
      for (const part of parent.split("/").filter(Boolean)) {
        directory = directory ? `${directory}/${part}` : part;
        const existing = await client.stat(directory);
        if (existing && !existing.isDirectory) throw new ValidationError(t("backend.webdav.parentNotDirectory"));
        if (!existing) await client.mkdir(directory);
      }
    }
    let source: ReturnType<typeof createReadStream> | undefined;
    try {
      const { size } = await statFile(sourcePath);
      source = createReadStream(sourcePath, { highWaterMark: 64 * 1024 });
      await client.writeStream(temporaryRelativePath, Readable.toWeb(source) as ReadableStream<Uint8Array>, size);
      if (upload?.onVersion) {
        const staged = await client.stat(temporaryRelativePath);
        upload.onVersion(staged?.etag ?? (staged?.lastModifiedMs ? String(staged.lastModifiedMs) : null));
      }
      const destination = await client.stat(relativePath, true);
      if (destination?.isDirectory) throw new ConflictError(t("backend.storage.targetIsDirectory"));
      const expected = upload?.expectedVersion;
      const status = expected === undefined ? await client.rename(temporaryRelativePath, relativePath, Boolean(destination))
        : await client.rename(temporaryRelativePath, relativePath, expected !== null, expected ?? undefined);
      upload?.onPublished?.(status === 201 || (status !== 204 && !destination));
      return relativePath;
    } catch (error) { await client.delete(temporaryRelativePath).catch(() => undefined); throw error; }
    finally { source?.destroy(); }
  }
  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const destination = (await resolveStorageRemotePath(node, relativePath, { credentials })).remotePath;
    const temporaryPath = (await resolveStorageRemotePath(node, temporaryRelativePath, { credentials })).remotePath;
    if (credentials.agentServerId && !credentials.privateKey && !credentials.password) {
      // The Agent protocol embeds base64 in a bounded command payload.
      if ((await statFile(sourcePath)).size > AGENT_FILE_MAX_BYTES) throw new BusinessError(t("backend.server.agentWriteLimit"));
      const content = await readFile(sourcePath);
      await createRemoteDirectory({ ...credentials, remotePath: path.posix.dirname(destination), recursive: true });
      const previous = await statBackingObject({ storageNode: node, relativePath });
      const version = previous ? [previous.size, previous.lastModifiedMs].join(":") : null;
      if (previous?.isDirectory || (upload?.expectedVersion !== undefined && upload.expectedVersion !== version)) {
        throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
      }
      const root = managedSftpWriteRoot(destination, relativePath);
      if (previous) {
        // The Linux Agent's atomic writer preserves the destination's mode, uid and gid on its private stage.
        await writeRemoteFile({ ...credentials, remotePath: destination, content, root });
      } else {
        try {
          await writeRemoteFile({ ...credentials, remotePath: temporaryPath, content, root });
          await renameRemoteFile({ ...credentials, oldPath: temporaryPath, newPath: destination, noReplace: true });
        } finally {
          await deleteRemoteFile({ ...credentials, remotePath: temporaryPath }).catch(() => undefined);
        }
      }
      upload?.onPublished?.(!previous);
      return destination;
    }
    const client = await connectSsh({ ...credentials, enforceHostKeyPin: true, readyTimeout: 15000, timeout: 10000 });
    try {
      await sftpMkdir(client, path.posix.dirname(destination));
      const sftp = await sftpRequest<import("ssh2").SFTPWrapper>(done => client.sftp(done));
      const previous = await sftpRequest<import("ssh2").Stats>(done => sftp.lstat(destination, done)).catch(error => {
        if (error.code === 2) return null;
        throw error;
      });
      await pipeline(createReadStream(sourcePath, { highWaterMark: 64 * 1024 }),
        sftp.createWriteStream(temporaryPath, { flags: "wx", mode: previous ? 0o600 : 0o666 }));
      if (upload?.onVersion) {
        const attrs = await sftpRequest<import("ssh2").Stats>(done => sftp.stat(temporaryPath, done));
        upload.onVersion(attrs.mtime ? String(attrs.mtime * 1000) : null);
      }
      const checked = await resolveStorageRemotePath(node, relativePath, { credentials });
      if (checked.remotePath !== destination) throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
      const initial = previous ? sftpVersion(previous) : null;
      await sftpAtomicRename(sftp, temporaryPath, destination, upload?.expectedVersion === undefined ? initial : upload.expectedVersion);
      upload?.onPublished?.(!previous);
      return destination;
    } catch (error) { await sftpUnlink(client, temporaryPath).catch(() => undefined); throw error; }
    finally { client.end(); }
  }
  throw new BusinessError(t("backend.storage.unsupportedNodeType"));
}

export async function deleteStorageFileBuffer(
  node: StorageFileNode,
  relativePath: string,
) {
  if (node.driver === "WEBDAV" || node.driver === "AGENT") {
    await createRemoteStorageClient(node).delete(relativePath);
    return relativePath;
  }
  if (node.driver === "LOCAL") {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (!resolved.ok) throw new ValidationError(resolved.reason);
    await rm(resolved.path, { force: true });
    return resolved.path;
  }

  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const normalizedRemotePath = (await resolveStorageRemotePath(node, relativePath, { credentials })).remotePath;
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
        enforceHostKeyPin: true,
        agentServerId: credentials.agentServerId,
        privateKey: credentials.privateKey,
        passphrase: credentials.passphrase,
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
  overwrite = true,
): Promise<{ size: number }> {
  if (sourceRelativePath === destinationRelativePath) {
    throw new ValidationError(t("backend.storage.copySourceDestinationMustDiffer"));
  }

  if (node.driver === "WEBDAV" || node.driver === "AGENT") {
    const client = createRemoteStorageClient(node);
    await client.copy(sourceRelativePath, destinationRelativePath);
    const result = await client.stat(destinationRelativePath);
    if (!result || result.isDirectory) throw new ValidationError(t("backend.storage.unsupportedNodeType"));
    return { size: result.size };
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
    // Beside the destination but not named after it (see writeStorageFileFromLocalPath): the destination's name plus
    // a 50-character suffix does not fit the 255-byte limit once the name itself is longer than 205 bytes.
    const tempPath = path.join(path.dirname(dest.path), `.vch-copy-${randomUUID()}.tmp`);
    try {
      await mkdir(path.dirname(dest.path), { recursive: true });
      await copyFile(source.path, tempPath);
      const stats = await statFile(tempPath);
      if (overwrite) await rename(tempPath, dest.path);
      else {
        await publishLocalFile(tempPath, dest.path, destinationRelativePath);
        await rm(tempPath, { force: true });
      }
      return { size: stats.size };
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  if (node.driver === "SFTP") {
    const credentials = resolveStorageSshCredentials(node);
    const sourceRemote = (await resolveStorageRemotePath(node, sourceRelativePath, { credentials })).remotePath;
    const destRemote = (await resolveStorageRemotePath(node, destinationRelativePath, { credentials })).remotePath;
    const tempRemote = path.posix.join(path.posix.dirname(destRemote), `.vch-copy-${randomUUID()}.tmp`);
    if (credentials.agentServerId && !credentials.privateKey && !credentials.password) {
      const buffer = await readRemoteFile({ ...credentials, remotePath: sourceRemote });
      await createRemoteDirectory({ ...credentials, remotePath: path.posix.dirname(destRemote), recursive: true });
      try {
        await writeRemoteFile({ ...credentials, remotePath: tempRemote, content: buffer, root: managedSftpWriteRoot(destRemote, destinationRelativePath) });
        await renameRemoteFile({ ...credentials, oldPath: tempRemote, newPath: destRemote, noReplace: !overwrite });
      } catch (error) {
        await deleteRemoteFile({ ...credentials, remotePath: tempRemote }).catch(() => undefined);
        throw error;
      }
      return { size: buffer.length };
    }
    let client: Client | null = null;
    try {
      client = await connectSsh({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        hostKeySha256: credentials.hostKeySha256,
        enforceHostKeyPin: true,
        agentServerId: credentials.agentServerId,
        privateKey: credentials.privateKey,
        passphrase: credentials.passphrase,
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
  if (node.driver === "WEBDAV" || node.driver === "AGENT")
    return `/api/storage/webdav-download?${params.toString()}`;
  if (node.driver === "LOCAL") return `/api/storage/local?${params.toString()}`;
  throw new BusinessError(t("backend.storage.unsupportedNodeType"));
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
