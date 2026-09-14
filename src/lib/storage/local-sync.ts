import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { readDirectoryIndex, type DirectoryIndexEntry } from "./directory-index";
import { guessMimeType } from "@/lib/image-bed/constants";
import {
  expandStorageBasePath,
  joinStoragePath,
  normalizeStorageTargetDirectory,
  resolveStoragePathWithinBase,
} from "@/lib/storage/path-utils";

type LocalSyncNode = Prisma.StorageNodeGetPayload<{
  select: {
    id: true;
    name: true;
    driver: true;
    basePath: true;
  };
}>;

const WRITE_BATCH_SIZE = 500;

export interface LocalSyncResult {
  synced: number;
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

async function upsertLocalEntry(input: {
  nodeId: string;
  name: string;
  relativePath: string;
  entryType: "DIRECTORY" | "FILE";
  size: bigint | null;
}, existing: DirectoryIndexEntry) {
  const data = {
    name: input.name,
    entryType: input.entryType,
    mimeType:
      input.entryType === "FILE"
        ? guessMimeType(input.name)
        : "inode/directory",
    size: input.size,
  };
  // A recycle-bin row must stay deleted while its backing object still exists.
  if (existing.isDeleted) return 0;
  if (existing.name === data.name && existing.entryType === data.entryType &&
      existing.mimeType === data.mimeType && existing.size === data.size) return 0;
  const updated = await prisma.fileEntry.updateMany({
    where: { id: existing.id, isDeleted: false, updatedAt: existing.updatedAt }, data,
  });
  return updated.count;
}

async function pruneStaleEntries(
  nodeId: string,
  indexed: Map<string, DirectoryIndexEntry>,
  diskRelativePaths: Set<string>,
) {
  const stale = [...indexed.values()].filter((entry) => !entry.isDeleted && !diskRelativePaths.has(entry.relativePath));
  let deleted = 0;
  for (let offset = 0; offset < stale.length; offset += WRITE_BATCH_SIZE) {
    const result = await prisma.fileEntry.updateMany({
      where: { storageNodeId: nodeId, isDeleted: false, OR: stale.slice(offset, offset + WRITE_BATCH_SIZE).map((entry) => ({ id: entry.id, updatedAt: entry.updatedAt })) },
      data: { isDeleted: true },
    });
    deleted += result.count;
  }
  return deleted;
}

export async function syncLocalDirectoryEntries(input: {
  node: LocalSyncNode;
  relativePath?: string;
}): Promise<LocalSyncResult> {
  const result: LocalSyncResult = {
    synced: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [],
  };

  if (input.node.driver !== "LOCAL") {
    throw new Error("Storage node is not a LOCAL node");
  }

  const normalizedDir = normalizeStorageTargetDirectory(input.relativePath);
  if (!normalizedDir.ok) {
    result.errors.push(normalizedDir.reason);
    return result;
  }

  const directoryPath = normalizedDir.path
    ? resolveStoragePathWithinBase(input.node.basePath, normalizedDir.path)
    : { ok: true as const, path: path.resolve(expandStorageBasePath(input.node.basePath)) };
  if (!directoryPath.ok) {
    result.errors.push(directoryPath.reason);
    return result;
  }

  // Capture prune candidates before scanning disk: uploads created during the
  // scan must never be deleted by an older directory inventory.
  const indexed = new Map<string, DirectoryIndexEntry>();
  for await (const page of readDirectoryIndex(input.node.id, normalizedDir.path)) {
    for (const entry of page) indexed.set(entry.relativePath, entry);
  }

  let entries;
  try {
    entries = await readdir(directoryPath.path, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Scanning ${directoryPath.path} failed: ${message}`);
    return result;
  }

  const diskRelativePaths = new Set<string>();
  const missing: Prisma.FileEntryCreateManyInput[] = [];
  for (const entry of entries) {
    // Symlinks and special files are intentionally not exposed by the file manager.
    if (!entry.isDirectory() && !entry.isFile()) continue;
    const relativePath = joinStoragePath(normalizedDir.path, entry.name);
    if (
      !relativePath.ok ||
      path.posix.basename(relativePath.path) !== entry.name
    ) {
      const reason = relativePath.ok
        ? "Name changes during path normalization"
        : relativePath.reason;
      result.errors.push(`Skipped unsupported entry ${entry.name}: ${reason}`);
      continue;
    }

    const absolutePath = resolveStoragePathWithinBase(
      input.node.basePath,
      relativePath.path,
    );
    if (!absolutePath.ok) {
      result.errors.push(`Skipped unsafe entry ${relativePath.path}`);
      continue;
    }

    let size: bigint | null = null;
    if (entry.isFile()) {
      try {
        const fileStat = await stat(absolutePath.path);
        if (!fileStat.isFile()) continue;
        size = BigInt(fileStat.size);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Reading ${relativePath.path} failed: ${message}`);
        continue;
      }
    }

    diskRelativePaths.add(relativePath.path);
    result.synced += 1;
    try {
      const data = {
        nodeId: input.node.id,
        name: entry.name,
        relativePath: relativePath.path,
        entryType: entry.isDirectory() ? "DIRECTORY" as const : "FILE" as const,
        size,
      };
      const existing = indexed.get(relativePath.path);
      if (existing) {
        result.updated += await upsertLocalEntry(data, existing);
      } else {
        missing.push({
          storageNodeId: input.node.id, relativePath: data.relativePath, name: data.name,
          entryType: data.entryType, size: data.size,
          mimeType: data.entryType === "DIRECTORY" ? "inode/directory" : guessMimeType(data.name),
          isDeleted: false,
        });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Saving ${relativePath.path} failed: ${message}`);
    }
  }

  for (let offset = 0; offset < missing.length; offset += WRITE_BATCH_SIZE) {
    try {
      // Concurrent inserts or tombstones win; a later refresh reconciles live metadata.
      const created = await prisma.fileEntry.createMany({ data: missing.slice(offset, offset + WRITE_BATCH_SIZE), skipDuplicates: true });
      result.created += created.count;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Saving directory entries failed: ${message}`);
    }
  }

  // Only prune from a complete inventory. A permission/stat/name error must not
  // make an existing, still-present entry look deleted.
  if (result.errors.length === 0) {
    result.deleted = await pruneStaleEntries(
      input.node.id,
      indexed,
      diskRelativePaths,
    );
  }
  return result;
}

export async function getLocalSyncNode(
  nodeId: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null,
) {
  return prisma.storageNode.findFirst({
    where: { id: nodeId, ...(session ? teamWhere(session) : {}) },
    select: {
      id: true,
      name: true,
      driver: true,
      basePath: true,
    },
  });
}
