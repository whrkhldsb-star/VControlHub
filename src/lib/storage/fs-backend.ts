import { apiCopy } from "@/lib/i18n/api-copy";
import { createLogger } from "@/lib/logging";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";

import { publishLocalFile } from "./publish-local-file";
import { BusinessError, ConflictError, ValidationError } from "@/lib/errors";
import { expandStorageBasePath, resolveStoragePathWithinBase } from "./path-utils";
import { resolveStorageRemotePath } from "./remote-containment";
import { t } from "@/lib/i18n/service-translations";
import { createAgentFileClient, createRemoteStorageClient } from "./agent-file-client";
import {
  createRemoteDirectory,
  deleteRemoteFile,
  readRemoteFile,
  statRemoteEntry,
  renameRemoteFile,
  writeRemoteFile,
} from "@/lib/ssh/client";
import type { StorageSshCredentialNode } from "@/lib/storage/ssh-credentials";

/**
 * Minimum shape of a storage node that the filesystem-backend adapter needs
 * to perform SFTP or LOCAL operations. The route layer hydrates this from
 * Prisma; the adapter only consumes the structural fields.
 */
/** A node with its SFTP connection in full (see StorageSshCredentialNode). */
export type StorageNodeWithCredentials = StorageSshCredentialNode & {
  id?: string;
  driver: string;
  basePath: string;
  webdavConfigEncrypted?: string | null;
};

/**
 * Match a thrown error against the well-known "backing object already gone"
 * shapes so callers can decide whether to swallow it (e.g. on permanent
 * delete) or surface it as a real failure.
 */
export function isMissingBackingObjectError(error: unknown) {
  if (typeof error !== "object" || error === null) return false;
  const { code, status, statusCode } = error as { code?: unknown; status?: unknown; statusCode?: unknown };
  const httpStatus = status ?? statusCode;
  if (httpStatus != null && httpStatus !== 404 && httpStatus !== "404") return false;
  if (code != null) {
    if (code === "ENOENT" || code === 2 || code === "2" || code === 404 || code === "404") return true;
    // WebDavHttpError inherits the application's generic business-error code.
    return httpStatus != null && (code === "BUSINESS_RULE_FAILED" || code === "NOT_FOUND");
  }
  if (httpStatus != null) return true;
  return error instanceof Error && /no such file|not found|does not exist|不存在|no_such_file/i.test(
    error.message,
  );
}

/**
 * Resolve a relative storage entry path to an absolute local filesystem
 * path, while enforcing containment inside the storage node's base path.
 * Throws if the resolved path escapes the root.
 */
export async function resolveManagedLocalEntryPath(input: {
  basePath: string;
  relativePath: string;
}) {
  const path = await import("node:path");
  const allowedRoot = path.resolve(expandStorageBasePath(input.basePath));
  const resolved = resolveStoragePathWithinBase(
    input.basePath,
    input.relativePath.replace(/^\/+/, ""),
  );
  if (!resolved.ok) {
    throw new ValidationError(t("backend.storage.pathExceedsRoot"));
  }

  return { path, absolutePath: resolved.path, allowedRoot };
}

/**
 * Create a managed folder on the storage node's backing filesystem.
 * - LOCAL: initialize the configured root, then create the target non-recursively
 * - SFTP:  `createRemoteDirectory` with resolved SSH credentials
 * Other drivers throw — silent no-ops would leave DB indexes without backing objects.
 */
export async function createManagedFolder(input: {
  storageNode: StorageNodeWithCredentials;
  relativePath: string;
  allowExisting?: boolean;
}): Promise<{ created: boolean; removeIfEmpty?: () => Promise<void> }> {
  if (input.storageNode.driver === "WEBDAV" || input.storageNode.driver === "AGENT") {
    await createRemoteStorageClient(input.storageNode).mkdir(input.relativePath);
    return { created: true };
  }
  if (input.storageNode.driver === "LOCAL") {
    const { absolutePath, allowedRoot } = await resolveManagedLocalEntryPath({
      basePath: input.storageNode.basePath,
      relativePath: input.relativePath,
    });
    await mkdir(allowedRoot, { recursive: true });
    try {
      await mkdir(absolutePath, { recursive: false });
    } catch (error) {
      if (input.allowExisting && (error as NodeJS.ErrnoException).code === "EEXIST" &&
          (await lstat(absolutePath)).isDirectory()) return { created: false };
      throw error;
    }
    const identity = await lstat(absolutePath);
    return {
      created: true,
      async removeIfEmpty() {
        const current = await lstat(absolutePath);
        if (current.dev !== identity.dev || current.ino !== identity.ino) {
          throw new ConflictError(apiCopy("apiCopy.files.op.changed"));
        }
        await rmdir(absolutePath);
      },
    };
  }

  if (input.storageNode.driver === "SFTP") {
    const { remotePath, credentials } = await resolveStorageRemotePath(input.storageNode, input.relativePath);
    try {
      await createRemoteDirectory({ ...credentials, remotePath, recursive: false });
    } catch (error) {
      // createRemoteDirectory confirms that an existing SFTP entry is a directory.
      if (input.allowExisting && (error as NodeJS.ErrnoException).code === "EEXIST") return { created: false };
      throw error;
    }
    // Remote deletes can be recursive. Keep the directory if indexing fails.
    return { created: true };
  }

  throw new ValidationError(
    apiCopy("apiCopy.unsupported.storage.driver.for.create.38fea12e", { v0: String(input.storageNode.driver) }),
  );
}

/**
 * Write (create or overwrite) a file on the storage node's backing
 * filesystem. Parent directories are created when needed so callers can
 * write nested paths in one call — matching the previous in-line
 * behaviour in sftp-ops `write`.
 * - LOCAL: mkdir -p parent + writeFile
 * - SFTP:  recursive createRemoteDirectory on parent + writeRemoteFile
 * Other drivers throw — silent success would leave DB indexes without bytes.
 */
export async function writeBackingObject(input: {
  storageNode: StorageNodeWithCredentials;
  relativePath: string;
  content: string | Buffer;
}): Promise<{ byteSize: number }> {
  if (input.storageNode.driver === "WEBDAV" || input.storageNode.driver === "AGENT") return createRemoteStorageClient(input.storageNode).write(input.relativePath, input.content);
  const buffer = Buffer.isBuffer(input.content)
    ? input.content
    : Buffer.from(input.content, "utf8");
  const byteSize = buffer.byteLength;

  if (input.storageNode.driver === "LOCAL") {
    const { path, absolutePath } = await resolveManagedLocalEntryPath({
      basePath: input.storageNode.basePath,
      relativePath: input.relativePath,
    });
    await mkdir(path.dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, buffer);
    return { byteSize };
  }

  if (input.storageNode.driver === "SFTP") {
    const { remotePath, credentials } = await resolveStorageRemotePath(input.storageNode, input.relativePath);
    const path = await import("node:path");
    const parentDirectory = path.posix.dirname(remotePath);
    if (
      parentDirectory &&
      parentDirectory !== "." &&
      parentDirectory !== "/"
    ) {
      await createRemoteDirectory({
        ...credentials,
        remotePath: parentDirectory,
        recursive: true,
      });
    }
    await writeRemoteFile({
      ...credentials,
      remotePath,
      content: buffer,
    });
    return { byteSize };
  }

  throw new ValidationError(
    apiCopy("apiCopy.unsupported.storage.driver.for.write.b1442a38", { v0: String(input.storageNode.driver) }),
  );
}

/**
 * Read a file from the storage node's backing filesystem into a Buffer.
 * Mirrors write/delete/rename so callers (notably sftp-ops `read`) do not
 * bypass the adapter and re-resolve credentials/path themselves.
 * - LOCAL: readFile after containment check
 * - SFTP:  readRemoteFile with resolved SSH credentials
 * Other drivers throw — there is no silent empty success for reads.
 */
export async function readBackingObject(input: {
  storageNode: StorageNodeWithCredentials;
  relativePath: string;
  maxBytes?: number;
}): Promise<Buffer> {
  if (input.storageNode.driver === "WEBDAV" || input.storageNode.driver === "AGENT") return createRemoteStorageClient(input.storageNode).read(input.relativePath, input.maxBytes);
  if (input.storageNode.driver === "LOCAL") {
    const { absolutePath } = await resolveManagedLocalEntryPath({
      basePath: input.storageNode.basePath,
      relativePath: input.relativePath,
    });
    // Enforce the byte cap before buffering the whole file into memory.
    // BusinessError (422) matches the SFTP path so callers can map both to 413.
    if (input.maxBytes !== undefined) {
      const chunks: Buffer[] = [];
      let bytes = 0;
      for await (const chunk of createReadStream(absolutePath)) {
        bytes += chunk.length;
        if (bytes > input.maxBytes) throw new BusinessError(t("backend.storage.remoteReadTooLarge"));
        chunks.push(chunk as Buffer);
      }
      return Buffer.concat(chunks, bytes);
    }
    return readFile(absolutePath);
  }

  if (input.storageNode.driver === "SFTP") {
    const { remotePath, credentials } = await resolveStorageRemotePath(input.storageNode, input.relativePath);
    return readRemoteFile({
      ...credentials,
      remotePath,
      ...(input.maxBytes !== undefined ? { maxBytes: input.maxBytes } : {}),
    });
  }

  throw new ValidationError(
    apiCopy("apiCopy.unsupported.storage.driver.for.read.b2c82a5f", { v0: String(input.storageNode.driver) }),
  );
}

/**
 * Read a backing file's size and last-modified time without fetching its body.
 *
 * Used as the optimistic-lock probe for the online editor: the editor records
 * `lastModifiedMs` when it loads a file and sends it back on save, so a write
 * can be refused when someone else changed the file meanwhile. Returns null when
 * the entry does not exist (a brand-new file has nothing to conflict with).
 */
export async function statBackingObject(input: {
  storageNode: StorageNodeWithCredentials;
  relativePath: string;
}): Promise<{ size: number; lastModifiedMs: number; isDirectory: boolean } | null> {
  if (input.storageNode.driver === "WEBDAV" || input.storageNode.driver === "AGENT") { const entry = await createRemoteStorageClient(input.storageNode).stat(input.relativePath, true); return entry ? { size: entry.size, lastModifiedMs: entry.lastModifiedMs, isDirectory: entry.isDirectory } : null; }
  if (input.storageNode.driver === "LOCAL") {
    const { absolutePath } = await resolveManagedLocalEntryPath({
      basePath: input.storageNode.basePath,
      relativePath: input.relativePath,
    });
    try {
      const { lstat } = await import("node:fs/promises");
      const fileStat = await lstat(absolutePath);
      return { size: fileStat.size, lastModifiedMs: fileStat.mtimeMs, isDirectory: fileStat.isDirectory() };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
      throw error;
    }
  }

  if (input.storageNode.driver === "SFTP") {
    const { remotePath, credentials } = await resolveStorageRemotePath(input.storageNode, input.relativePath);
    try {
      const entry = await statRemoteEntry({ ...credentials, remotePath });
      return { size: entry.size ?? 0, lastModifiedMs: entry.modifyTime ?? 0, isDirectory: entry.type === "directory" };
    } catch (error) {
      // Occupancy decides whether a later rollback may delete or restore bytes.
      // A filename in a permission or transport error can itself contain "not found".
      const code = (error as { code?: unknown } | null)?.code;
      if (code === 2 || code === "ENOENT") return null;
      throw error;
    }
  }

  throw new ValidationError(
    apiCopy("apiCopy.unsupported.storage.driver.for.stat.8a21e7e0", { v0: String(input.storageNode.driver) }),
  );
}

/**
 * Delete a backing file or directory on the storage node. The adapter
 * dispatches to the LOCAL or SFTP backend based on the node's driver;
 * unsupported drivers throw. When `tolerateMissing` is true,
 * "already gone" errors are swallowed so permanent-delete can be
 * idempotent.
 */
export async function deleteBackingObject(input: {
  storageNode: StorageNodeWithCredentials;
  relativePath: string;
  isDirectory: boolean;
  tolerateMissing: boolean;
  emptyOnly?: boolean;
  expectedRoot?: string;
  version?: string;
}) {
  try {
    if (input.storageNode.driver === "AGENT") {
      if (!input.storageNode.id) throw new ValidationError(t("backend.fileAgent.unavailable"));
      await createAgentFileClient(input.storageNode.id, undefined, input.expectedRoot)
        .delete(input.relativePath, input.isDirectory, input.version, input.emptyOnly);
      return;
    }
    if (input.storageNode.driver === "WEBDAV") {
      if (input.emptyOnly) throw new ConflictError(t("backend.storage.recycledDirectoryConflict"));
      await createRemoteStorageClient(input.storageNode).delete(input.relativePath);
      return;
    }
    if (input.storageNode.driver === "LOCAL") {
      const { absolutePath } = await resolveManagedLocalEntryPath({
        basePath: input.storageNode.basePath,
        relativePath: input.relativePath,
      });
      if (input.isDirectory) {
        if (input.emptyOnly) await rmdir(absolutePath);
        else await rm(absolutePath, { recursive: true, force: false });
      } else {
        await unlink(absolutePath);
      }
      return;
    }

    if (input.storageNode.driver === "SFTP") {
      const { remotePath, credentials } = await resolveStorageRemotePath(input.storageNode, input.relativePath);
      await deleteRemoteFile({
        ...credentials,
        remotePath,
        isDirectory: input.isDirectory,
        ...(input.emptyOnly ? { emptyOnly: true } : {}),
      });
      return;
    }

    throw new ValidationError(
      apiCopy("apiCopy.unsupported.storage.driver.for.delete.960924c3", { v0: String(input.storageNode.driver) }),
    );
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (input.emptyOnly && (code === "ENOTEMPTY" || code === "EEXIST" || code === 18)) {
      throw new ConflictError(t("backend.storage.recycledDirectoryConflict"));
    }
    if (input.tolerateMissing && isMissingBackingObjectError(error)) return;
    throw error;
  }
}

/**
 * Rename/move a backing object on the storage node. The adapter
 * dispatches to the LOCAL or SFTP backend; unsupported drivers throw.
 * For LOCAL the destination's parent directory is created
 * recursively before the rename, mirroring the previous in-line
 * behaviour in `actions.ts`.
 */
export async function renameBackingObject(input: {
  storageNode: StorageNodeWithCredentials;
  oldRelativePath: string;
  newRelativePath: string;
  noReplace?: boolean;
}) {
  if (input.storageNode.driver === "WEBDAV" || input.storageNode.driver === "AGENT") {
    const client = createRemoteStorageClient(input.storageNode);
    if (input.storageNode.driver === "AGENT" && input.noReplace) {
      await client.rename(input.oldRelativePath, input.newRelativePath, false, true);
    } else {
      await client.rename(input.oldRelativePath, input.newRelativePath);
    }
    return;
  }
  if (input.storageNode.driver === "LOCAL") {
    const oldPath = await resolveManagedLocalEntryPath({
      basePath: input.storageNode.basePath,
      relativePath: input.oldRelativePath,
    });
    const newPath = await resolveManagedLocalEntryPath({
      basePath: input.storageNode.basePath,
      relativePath: input.newRelativePath,
    });
    await mkdir(newPath.path.dirname(newPath.absolutePath), {
      recursive: true,
    });
    await rename(oldPath.absolutePath, newPath.absolutePath);
    return;
  }

  if (input.storageNode.driver === "SFTP") {
    const { remotePath: oldPath, credentials } = await resolveStorageRemotePath(input.storageNode, input.oldRelativePath);
    const { remotePath: newPath } = await resolveStorageRemotePath(input.storageNode, input.newRelativePath, { credentials });
    const path = await import("node:path");
    const targetParentDirectory = path.posix.dirname(newPath);
    if (
      targetParentDirectory &&
      targetParentDirectory !== "." &&
      targetParentDirectory !== "/"
    ) {
      await createRemoteDirectory({
        ...credentials,
        remotePath: targetParentDirectory,
        recursive: true,
      });
    }
    const agentOnly = credentials.agentServerId && !credentials.privateKey && !credentials.password;
    await renameRemoteFile({ ...credentials, oldPath, newPath, ...(agentOnly && input.noReplace ? { noReplace: true } : {}) });
    return;
  }

  throw new ValidationError(
    apiCopy("apiCopy.unsupported.storage.driver.for.rename.b9ceac0e", { v0: String(input.storageNode.driver) }),
  );
}

/**
 * Cross-directory move for a backing object on the storage node.
 * Implementation is shared with `renameBackingObject` (both mkdir -p the
 * destination parent then rename on LOCAL/SFTP). Kept as a separate export
 * so call sites can express intent (rename vs move) without dual code paths.
 */
export async function moveBackingObject(input: {
  storageNode: StorageNodeWithCredentials;
  oldRelativePath: string;
  newRelativePath: string;
}) {
  if (input.storageNode.driver !== "LOCAL") return renameBackingObject({ ...input, noReplace: true });
  const source = await resolveManagedLocalEntryPath({ basePath: input.storageNode.basePath, relativePath: input.oldRelativePath });
  const target = await resolveManagedLocalEntryPath({ basePath: input.storageNode.basePath, relativePath: input.newRelativePath });
  await mkdir(target.path.dirname(target.absolutePath), { recursive: true });
  const stat = await lstat(source.absolutePath);
  if (stat.isDirectory()) {
    // POSIX rename can replace an empty directory. Reserve it exclusively first.
    // Windows already refuses to replace a directory.
    if (process.platform === "win32") return rename(source.absolutePath, target.absolutePath);
    await mkdir(target.absolutePath);
    const reserved = await lstat(target.absolutePath);
    try {
      await rename(source.absolutePath, target.absolutePath);
    } catch (error) {
      await undoMoveTarget(target.absolutePath, reserved, true);
      throw error;
    }
    return;
  }
  if (!stat.isFile()) throw new ValidationError(t("backend.storage.pathExceedsRoot"));
  await publishLocalFile(source.absolutePath, target.absolutePath, input.newRelativePath);
  try {
    await unlink(source.absolutePath);
  } catch (error) {
    const remaining = await lstat(source.absolutePath).catch(() => null);
    if (remaining?.ino === stat.ino && remaining.dev === stat.dev) await undoMoveTarget(target.absolutePath, stat, false);
    else createLogger("storage:move").error("Could not confirm source after link publication", { source: source.absolutePath, target: target.absolutePath });
    throw error;
  }
}

async function undoMoveTarget(target: string, owned: { ino: number; dev: number }, directory: boolean) {
  try {
    const current = await lstat(target);
    if (current.ino !== owned.ino || current.dev !== owned.dev) throw new Error("Target identity changed");
    if (directory) await rmdir(target);
    else await unlink(target);
  } catch (error) {
    createLogger("storage:move").error("Partial LOCAL move requires reconciliation", { target, error });
  }
}
