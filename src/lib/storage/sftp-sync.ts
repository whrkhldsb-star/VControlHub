import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma, isUniqueViolation } from "@/lib/db";
import { guessMimeType } from "@/lib/image-bed/constants";
import { listRemoteDirectory, type SftpListEntry } from "@/lib/ssh/client";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { getSftpSyncDirectoryTimeoutMs } from "@/lib/runtime-settings/service";
import { t } from "@/lib/i18n/service-translations";
import {
  computeDirectoryRelativePath,
  computeRelativePath,
  withDirectoryTimeout,
} from "@/lib/storage/sftp-walk-utils";

type SftpSyncNode = Prisma.StorageNodeGetPayload<{
  select: {
    id: true;
    name: true;
    driver: true;
    basePath: true;
    host: true;
    port: true;
    username: true;
    hostKeySha256: true;
    server: {
      select: {
        id: true;
        host: true;
        port: true;
        username: true;
        connectionType: true;
        managementMode: true;
        password: true;
        hostKeySha256: true;
        sshKey: { select: { privateKey: true } };
      };
    };
  };
}>;
const DB_ENTRY_PAGE_SIZE = 2_000;

export interface SftpSyncResult {
  synced: number;
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

async function upsertRemoteEntry(
  nodeId: string,
  entry: SftpListEntry,
  relativePath: string,
) {
  const entryType: "DIRECTORY" | "FILE" =
    entry.type === "directory" ? "DIRECTORY" : "FILE";
  const mimeType =
    entryType === "FILE" ? guessMimeType(entry.name) : "inode/directory";
  const size = entryType === "FILE" ? BigInt(entry.size) : null;
  const data = {
    name: entry.name,
    entryType,
    mimeType,
    size,
    isDeleted: false as const,
  };

  // Prefer unique-key lookup (includes soft-deleted) so concurrent syncs converge.
  const existing = await prisma.fileEntry.findFirst({
    where: { storageNodeId: nodeId, relativePath },
  });

  if (existing) {
	  // A deleted row is a user-visible recycle-bin tombstone. Inventory refreshes
	  // must not silently restore it just because the backing object still exists.
	  if (existing.isDeleted) return "skipped" as const;
    await prisma.fileEntry.update({
      where: { id: existing.id },
      data,
    });
	return "updated" as const;
  }

  try {
    await prisma.fileEntry.create({
      data: { storageNodeId: nodeId, relativePath, ...data },
    });
    return "created" as const;
  } catch (error) {
    // Concurrent first-time create races on @@unique([storageNodeId, relativePath]).
    if (!isUniqueViolation(error)) throw error;
    const raced = await prisma.fileEntry.findFirst({
      where: { storageNodeId: nodeId, relativePath },
    });
    if (!raced) throw error;
	if (raced.isDeleted) return "skipped" as const;
    await prisma.fileEntry.update({
      where: { id: raced.id },
      data,
    });
	return "updated" as const;
  }
}

async function pruneStaleEntries(
  nodeId: string,
  basePath: string,
  dirPath: string,
  remoteRelativePaths: Set<string>,
) {
  const relativeDir = computeDirectoryRelativePath(basePath, dirPath);
  if (relativeDir === null) return 0;

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
      if (isDirectChild && !remoteRelativePaths.has(entry.relativePath))
        staleIds.push(entry.id);
    }
    if (existing.length < DB_ENTRY_PAGE_SIZE) break;
    cursorId = existing[existing.length - 1]!.id;
  }

  if (staleIds.length === 0) return 0;

  const result = await prisma.fileEntry.updateMany({
    where: { id: { in: staleIds } },
    data: { isDeleted: true },
  });
  return result.count;
}

export async function syncSftpDirectoryEntries(input: {
  node: SftpSyncNode;
  remotePath?: string;
  recursive?: boolean;
  maxDepth?: number;
  directoryTimeoutMs?: number;
}): Promise<SftpSyncResult> {
  const { node, remotePath, recursive = false, maxDepth = 1 } = input;
  if (node.driver !== "SFTP") {
    throw new Error(t("backend.storage.notSftpNode"));
  }

  let credentials: ReturnType<typeof resolveStorageSshCredentials>;
  try {
    credentials = resolveStorageSshCredentials(node);
  } catch (error) {
    const msg = error instanceof Error ? error.message : t("backend.common.unknownError");
    return {
      synced: 0,
      created: 0,
      updated: 0,
      deleted: 0,
      errors: [t("backend.storage.connectionCredentialsUnavailable", { error: msg })],
    };
  }

  const basePath = normalizeRemotePath(node.basePath);
  const normalizedStartPath = normalizeRemotePath(node.basePath, remotePath);
	const result: SftpSyncResult = {
    synced: 0,
    created: 0,
    updated: 0,
    deleted: 0,
    errors: [],
	};
  const directoryTimeoutMs =
    input.directoryTimeoutMs !== undefined
      ? Math.max(1, input.directoryTimeoutMs)
      : await getSftpSyncDirectoryTimeoutMs();

  async function syncDirectory(
    dirPath: string,
    currentDepth: number,
  ): Promise<void> {
    let entries: SftpListEntry[];
    try {
      entries = await withDirectoryTimeout(
        listRemoteDirectory({
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
          privateKey: credentials.privateKey,
          password: credentials.password,
          hostKeySha256: credentials.hostKeySha256,
          agentServerId: credentials.agentServerId,
          remotePath: dirPath,
        }),
        dirPath,
        directoryTimeoutMs,
        { stoppedVerb: "syncing" },
      );
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      result.errors.push(`Scanning ${dirPath} failed: ${msg}`);
      return;
    }

    const remoteRelativePaths = new Set<string>();

    for (const entry of entries) {
      if (entry.type === "other") continue;
      const relativePath = computeRelativePath(basePath, dirPath, entry.name);
      if (!relativePath) {
        result.errors.push(
          `Skipped entry outside basePath: ${dirPath}/${entry.name}`,
        );
        continue;
      }

      remoteRelativePaths.add(relativePath);
      result.synced += 1;
      try {
        const action = await upsertRemoteEntry(node.id, entry, relativePath);
		if (action !== "skipped") result[action] += 1;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Saving ${relativePath} failed: ${msg}`);
      }

      if (recursive && entry.type === "directory" && currentDepth < maxDepth) {
        await syncDirectory(
          `${dirPath.replace(/\/+$/, "")}/${entry.name}`,
          currentDepth + 1,
        );
      }
    }

    result.deleted += await pruneStaleEntries(
      node.id,
      basePath,
      dirPath,
      remoteRelativePaths,
    );
  }

  await syncDirectory(normalizedStartPath, 0);
  return result;
}

export async function getSftpSyncNode(
  nodeId: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null,
) {
  return prisma.storageNode.findFirst({
    where: {
      id: nodeId,
      ...(session ? teamWhere(session) : {}),
    },
    select: {
      id: true,
      name: true,
      driver: true,
      basePath: true,
      host: true,
      port: true,
      username: true,
      hostKeySha256: true,
      teamId: true,
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
          sshKey: { select: { privateKey: true } },
        },
      },
    },
  });
}
