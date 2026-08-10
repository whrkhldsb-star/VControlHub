import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma, isUniqueViolation } from "@/lib/db";
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

const DB_ENTRY_PAGE_SIZE = 2_000;

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
}) {
  const data = {
    name: input.name,
    entryType: input.entryType,
    mimeType:
      input.entryType === "FILE"
        ? guessMimeType(input.name)
        : "inode/directory",
    size: input.size,
    isDeleted: false as const,
  };
  const existing = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId: input.nodeId,
      relativePath: input.relativePath,
    },
  });

  // A recycle-bin row must stay deleted while its backing object still exists.
  if (existing?.isDeleted) return "skipped" as const;
  if (existing) {
    await prisma.fileEntry.update({ where: { id: existing.id }, data });
    return "updated" as const;
  }

  try {
    await prisma.fileEntry.create({
      data: {
        storageNodeId: input.nodeId,
        relativePath: input.relativePath,
        ...data,
      },
    });
    return "created" as const;
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.fileEntry.findFirst({
      where: {
        storageNodeId: input.nodeId,
        relativePath: input.relativePath,
      },
    });
    if (!raced) throw error;
    if (raced.isDeleted) return "skipped" as const;
    await prisma.fileEntry.update({ where: { id: raced.id }, data });
    return "updated" as const;
  }
}

async function pruneStaleEntries(
  nodeId: string,
  relativeDir: string,
  diskRelativePaths: Set<string>,
) {
  const prefix = relativeDir ? `${relativeDir}/` : "";
  const staleIds: string[] = [];
  let cursorId: string | undefined;

  for (;;) {
    const existing = await prisma.fileEntry.findMany({
      where: {
        storageNodeId: nodeId,
        isDeleted: false,
        ...(relativeDir
          ? { relativePath: { startsWith: `${relativeDir}/` } }
          : {}),
      },
      select: { id: true, relativePath: true },
      orderBy: { id: "asc" },
      take: DB_ENTRY_PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });

    for (const entry of existing) {
      if (!entry.relativePath.startsWith(prefix)) continue;
      const remainder = entry.relativePath.slice(prefix.length);
      const isDirectChild = remainder.length > 0 && !remainder.includes("/");
      if (isDirectChild && !diskRelativePaths.has(entry.relativePath)) {
        staleIds.push(entry.id);
      }
    }

    if (existing.length < DB_ENTRY_PAGE_SIZE) break;
    cursorId = existing.at(-1)?.id;
  }

  if (staleIds.length === 0) return 0;
  const result = await prisma.fileEntry.updateMany({
    where: { id: { in: staleIds } },
    data: { isDeleted: true },
  });
  return result.count;
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

  let entries;
  try {
    entries = await readdir(directoryPath.path, { withFileTypes: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    result.errors.push(`Scanning ${directoryPath.path} failed: ${message}`);
    return result;
  }

  const diskRelativePaths = new Set<string>();
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
      const action = await upsertLocalEntry({
        nodeId: input.node.id,
        name: entry.name,
        relativePath: relativePath.path,
        entryType: entry.isDirectory() ? "DIRECTORY" : "FILE",
        size,
      });
      if (action !== "skipped") result[action] += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Saving ${relativePath.path} failed: ${message}`);
    }
  }

  // Only prune from a complete inventory. A permission/stat/name error must not
  // make an existing, still-present entry look deleted.
  if (result.errors.length === 0) {
    result.deleted = await pruneStaleEntries(
      input.node.id,
      normalizedDir.path,
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
