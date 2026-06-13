import { mkdir, rename, rm, unlink } from "node:fs/promises";

import { resolveStorageSshCredentials } from "./ssh-credentials";
import { expandStorageBasePath } from "./path-utils";
import { normalizeRemoteTargetPath } from "./remote-path";
import {
  createRemoteDirectory,
  deleteRemoteFile,
  renameRemoteFile,
} from "@/lib/ssh/client";

/**
 * Minimum shape of a storage node that the filesystem-backend adapter needs
 * to perform SFTP or LOCAL operations. The route layer hydrates this from
 * Prisma; the adapter only consumes the structural fields.
 */
export type StorageNodeWithCredentials = {
  driver: string;
  basePath: string;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  server?: {
    host?: string | null;
    port?: number | null;
    username?: string | null;
    connectionType?: string | null;
    password?: string | null;
    sshKey?: { privateKey?: string | null } | null;
  } | null;
};

/**
 * Match a thrown error against the well-known "backing object already gone"
 * shapes so callers can decide whether to swallow it (e.g. on permanent
 * delete) or surface it as a real failure.
 */
export function isMissingBackingObjectError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT" || code === 2) return true;
  return /no such file|not found|does not exist|不存在|no_such_file/i.test(
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
  const normalizedRelativePath = input.relativePath.replace(/^\/+/, "");
  const allowedRoot = path.resolve(expandStorageBasePath(input.basePath));
  const absolutePath = path.resolve(allowedRoot, normalizedRelativePath);
  const relativeToRoot = path.relative(allowedRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("路径超出存储根目录");
  }

  return { path, absolutePath, allowedRoot };
}

/**
 * Create a managed folder on the storage node's backing filesystem.
 * - LOCAL: `mkdir(absolutePath, { recursive: false })`
 * - SFTP:  `createRemoteDirectory` with resolved SSH credentials
 * Other drivers are intentionally unsupported and treated as a no-op
 * (the caller is expected to guard on the node's driver up front).
 */
export async function createManagedFolder(input: {
  storageNode: StorageNodeWithCredentials;
  relativePath: string;
}) {
  if (input.storageNode.driver === "LOCAL") {
    const { absolutePath } = await resolveManagedLocalEntryPath({
      basePath: input.storageNode.basePath,
      relativePath: input.relativePath,
    });
    await mkdir(absolutePath, { recursive: false });
    return;
  }

  if (input.storageNode.driver === "SFTP") {
    const remotePath = normalizeRemoteTargetPath(
      input.storageNode.basePath,
      input.relativePath,
    );
    const credentials = resolveStorageSshCredentials(input.storageNode);
    await createRemoteDirectory({
      ...credentials,
      remotePath,
      recursive: false,
    });
  }
}

/**
 * Delete a backing file or directory on the storage node. The adapter
 * dispatches to the LOCAL or SFTP backend based on the node's driver;
 * unsupported drivers are a no-op. When `tolerateMissing` is true,
 * "already gone" errors are swallowed so permanent-delete can be
 * idempotent.
 */
export async function deleteBackingObject(input: {
  storageNode: StorageNodeWithCredentials;
  relativePath: string;
  isDirectory: boolean;
  tolerateMissing: boolean;
}) {
  try {
    if (input.storageNode.driver === "LOCAL") {
      const { absolutePath } = await resolveManagedLocalEntryPath({
        basePath: input.storageNode.basePath,
        relativePath: input.relativePath,
      });
      if (input.isDirectory) {
        await rm(absolutePath, { recursive: true, force: false });
      } else {
        await unlink(absolutePath);
      }
      return;
    }

    if (input.storageNode.driver === "SFTP") {
      const remotePath = normalizeRemoteTargetPath(
        input.storageNode.basePath,
        input.relativePath,
      );
      const credentials = resolveStorageSshCredentials(input.storageNode);
      await deleteRemoteFile({
        ...credentials,
        remotePath,
        isDirectory: input.isDirectory,
      });
    }
  } catch (error) {
    if (input.tolerateMissing && isMissingBackingObjectError(error)) return;
    throw error;
  }
}

/**
 * Rename/move a backing object on the storage node. The adapter
 * dispatches to the LOCAL or SFTP backend; unsupported drivers are a
 * no-op. For LOCAL the destination's parent directory is created
 * recursively before the rename, mirroring the previous in-line
 * behaviour in `actions.ts`.
 */
export async function renameBackingObject(input: {
  storageNode: StorageNodeWithCredentials;
  oldRelativePath: string;
  newRelativePath: string;
}) {
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
    const oldPath = normalizeRemoteTargetPath(
      input.storageNode.basePath,
      input.oldRelativePath,
    );
    const newPath = normalizeRemoteTargetPath(
      input.storageNode.basePath,
      input.newRelativePath,
    );
    const credentials = resolveStorageSshCredentials(input.storageNode);
    await renameRemoteFile({ ...credentials, oldPath, newPath });
  }
}
