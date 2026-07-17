import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { guessMimeType } from "@/lib/image-bed/constants";
import { listRemoteDirectory, type SftpListEntry } from "@/lib/ssh/client";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { getSftpSyncDirectoryTimeoutMs } from "@/lib/runtime-settings/service";

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
        password: true;
        hostKeySha256: true;
        sshKey: { select: { privateKey: true } };
      };
    };
  };
}>;

export interface SftpSyncResult {
  synced: number;
  created: number;
  updated: number;
  deleted: number;
  errors: string[];
}

async function withDirectoryTimeout<T>(operation: Promise<T>, dirPath: string, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Scanning ${dirPath} exceeded ${Math.ceil(timeoutMs / 1000)} seconds; stopped syncing this directory`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function computeRelativePath(basePath: string, remotePath: string, entryName: string): string | null {
  const normalizedBase = basePath.replace(/\/+$/, "") || "/";
  const normalizedRemote = remotePath.replace(/\/+$/, "") || "/";

  let relative: string;
  if (normalizedRemote === normalizedBase) {
    relative = entryName;
  } else if (normalizedBase === "/" && normalizedRemote.startsWith("/")) {
    relative = `${normalizedRemote.slice(1)}/${entryName}`;
  } else if (normalizedRemote.startsWith(`${normalizedBase}/`)) {
    relative = `${normalizedRemote.slice(normalizedBase.length + 1)}/${entryName}`;
  } else {
    return null;
  }

  return relative.replace(/^\/+/, "");
}

async function upsertRemoteEntry(nodeId: string, entry: SftpListEntry, relativePath: string) {
  const entryType = entry.type === "directory" ? "DIRECTORY" : "FILE";
  const mimeType = entryType === "FILE" ? guessMimeType(entry.name) : "inode/directory";
  const size = entryType === "FILE" ? BigInt(entry.size) : null;

  const existing = await prisma.fileEntry.findFirst({
    where: { storageNodeId: nodeId, relativePath, isDeleted: false },
  });

  if (existing) {
    await prisma.fileEntry.update({
      where: { id: existing.id },
      data: { name: entry.name, entryType, mimeType, size },
    });
    return "updated" as const;
  }

  const softDeleted = await prisma.fileEntry.findFirst({
    where: { storageNodeId: nodeId, relativePath, isDeleted: true },
  });

  if (softDeleted) {
    await prisma.fileEntry.update({
      where: { id: softDeleted.id },
      data: { isDeleted: false, name: entry.name, entryType, mimeType, size },
    });
  } else {
    await prisma.fileEntry.create({
      data: { storageNodeId: nodeId, name: entry.name, entryType, mimeType, size, relativePath },
    });
  }
  return "created" as const;
}

function computeDirectoryRelativePath(basePath: string, remotePath: string): string | null {
  const normalizedBase = basePath.replace(/\/+$/, "") || "/";
  const normalizedRemote = remotePath.replace(/\/+$/, "") || "/";

  if (normalizedRemote === normalizedBase) return "";
  if (normalizedBase === "/" && normalizedRemote.startsWith("/")) return normalizedRemote.slice(1);
  if (normalizedRemote.startsWith(`${normalizedBase}/`)) return normalizedRemote.slice(normalizedBase.length + 1);
  return null;
}

async function pruneStaleEntries(nodeId: string, basePath: string, dirPath: string, remoteRelativePaths: Set<string>) {
  const relativeDir = computeDirectoryRelativePath(basePath, dirPath);
  if (relativeDir === null) return 0;

  // P2: take=10_000 上界。stale 检测需要全集语义,但单 nodeId+目录前缀范围下不会超 1w 条；超过即异常告警。
  const existing = await prisma.fileEntry.findMany({
    where: {
      storageNodeId: nodeId,
      isDeleted: false,
      ...(relativeDir ? { relativePath: { startsWith: `${relativeDir}/` } } : {}),
    },
    select: { id: true, relativePath: true },
    take: 10_000,
  });

  const prefix = relativeDir ? `${relativeDir}/` : "";
  const staleIds = existing
    .filter((entry) => {
      if (!entry.relativePath.startsWith(prefix)) return false;
      const remainder = entry.relativePath.slice(prefix.length);
      const isDirectChild = remainder.length > 0 && !remainder.includes("/");
      return isDirectChild && !remoteRelativePaths.has(entry.relativePath);
    })
    .map((entry) => entry.id);

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
    throw new Error("This node is not SFTP type");
  }

  let credentials: ReturnType<typeof resolveStorageSshCredentials>;
  try {
    credentials = resolveStorageSshCredentials(node);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    return { synced: 0, created: 0, updated: 0, deleted: 0, errors: [`Connection credentials unavailable: ${msg}`] };
  }

  const basePath = normalizeRemotePath(node.basePath);
  const normalizedStartPath = normalizeRemotePath(node.basePath, remotePath);
  const result: SftpSyncResult = { synced: 0, created: 0, updated: 0, deleted: 0, errors: [] };
  const directoryTimeoutMs = input.directoryTimeoutMs !== undefined
    ? Math.max(1, input.directoryTimeoutMs)
    : await getSftpSyncDirectoryTimeoutMs();

  async function syncDirectory(dirPath: string, currentDepth: number): Promise<void> {
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
          remotePath: dirPath,
        }),
        dirPath,
        directoryTimeoutMs,
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
        result.errors.push(`Skipped entry outside basePath: ${dirPath}/${entry.name}`);
        continue;
      }

      remoteRelativePaths.add(relativePath);
      result.synced += 1;
      try {
        const action = await upsertRemoteEntry(node.id, entry, relativePath);
        result[action] += 1;
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error";
        result.errors.push(`Saving ${relativePath} failed: ${msg}`);
      }

      if (recursive && entry.type === "directory" && currentDepth < maxDepth) {
        await syncDirectory(`${dirPath.replace(/\/+$/, "")}/${entry.name}`, currentDepth + 1);
      }
    }

    result.deleted += await pruneStaleEntries(node.id, basePath, dirPath, remoteRelativePaths);
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
      server: {
        select: {
          id: true,
          host: true,
          port: true,
          username: true,
          connectionType: true,
          password: true,
          hostKeySha256: true,
          sshKey: { select: { privateKey: true } },
        },
      },
    },
  });
}
