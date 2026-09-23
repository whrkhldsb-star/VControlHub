import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
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

type RemoteEntryPayload = {
  relativePath: string;
  name: string;
  entryType: "DIRECTORY" | "FILE";
  mimeType: string | null;
  size: bigint | null;
};

/** Rows per index lookup / insert batch. Bounds both the IN list and the write. */
const SFTP_SYNC_BATCH_SIZE = 500;

function payloadData(payload: RemoteEntryPayload) {
  return {
    name: payload.name,
    entryType: payload.entryType,
    mimeType: payload.mimeType,
    size: payload.size,
    isDeleted: false as const,
  };
}

function isPayloadUnchanged(
  existing: {
    name: string;
    entryType: string;
    mimeType: string | null;
    size: bigint | null;
  },
  payload: RemoteEntryPayload,
) {
  return (
    existing.name === payload.name &&
    existing.entryType === payload.entryType &&
    existing.mimeType === payload.mimeType &&
    existing.size === payload.size
  );
}

function describeError(error: unknown) {
  return error instanceof Error ? error.message : "Unknown error";
}

/**
 * Write a whole directory listing with a bounded number of queries.
 *
 * The previous per-entry upsert did one `findFirst` + one `update`/`create` per
 * remote entry — a 1 000-file directory cost 2 000+ round-trips, which is why
 * refreshing a large node stalled the request. This mirrors the WebDAV sync:
 * one indexed lookup per batch, `createMany` for new paths, and no write at all
 * for entries that have not changed.
 */
async function syncRemoteEntries(nodeId: string, payloads: RemoteEntryPayload[]) {
  const counts = { created: 0, updated: 0, skipped: 0, errors: [] as string[] };

  for (let offset = 0; offset < payloads.length; offset += SFTP_SYNC_BATCH_SIZE) {
    const batch = payloads.slice(offset, offset + SFTP_SYNC_BATCH_SIZE);
    const paths = batch.map((payload) => payload.relativePath);

    let indexed: Awaited<ReturnType<typeof loadIndexedEntries>>;
    try {
      indexed = await loadIndexedEntries(nodeId, paths);
    } catch (error) {
      counts.errors.push(`Indexing ${paths.length} remote entries failed: ${describeError(error)}`);
      continue;
    }

    const missing: RemoteEntryPayload[] = [];
    for (const payload of batch) {
      const existing = indexed.get(payload.relativePath);
      if (!existing) {
        missing.push(payload);
        continue;
      }
      // A deleted row is a user-visible recycle-bin tombstone. Inventory
      // refreshes must not silently restore it just because the backing object
      // still exists.
      if (existing.isDeleted) {
        counts.skipped += 1;
        continue;
      }
      if (isPayloadUnchanged(existing, payload)) continue;
      try {
        // The predicate keeps a concurrent recycle-bin delete from being
        // resurrected; never write isDeleted=false here.
        const updated = await prisma.fileEntry.updateMany({
          where: { id: existing.id, isDeleted: false },
          data: payloadData(payload),
        });
        counts.updated += updated.count;
      } catch (error) {
        counts.errors.push(`Saving ${payload.relativePath} failed: ${describeError(error)}`);
      }
    }

    if (missing.length === 0) continue;
    try {
      // skipDuplicates so a concurrent first-time insert on
      // @@unique([storageNodeId, relativePath]) cannot fail the batch.
      const created = await prisma.fileEntry.createMany({
        data: missing.map((payload) => ({
          storageNodeId: nodeId,
          relativePath: payload.relativePath,
          ...payloadData(payload),
        })),
        skipDuplicates: true,
      });
      counts.created += created.count;
      if (created.count === missing.length) continue;
      // Someone else inserted the remainder — reconcile so the index reflects
      // the listing we just read instead of the racing writer's version.
      const raced = await loadIndexedEntries(nodeId, missing.map((payload) => payload.relativePath));
      for (const payload of missing) {
        const existing = raced.get(payload.relativePath);
        if (!existing || existing.isDeleted || isPayloadUnchanged(existing, payload)) continue;
        const updated = await prisma.fileEntry.updateMany({
          where: { id: existing.id, isDeleted: false },
          data: payloadData(payload),
        });
        counts.updated += updated.count;
      }
    } catch (error) {
      counts.errors.push(`Indexing ${missing.length} new entries failed: ${describeError(error)}`);
    }
  }

  return counts;
}

/** One query for the current index state of `paths` (tombstones included). */
async function loadIndexedEntries(nodeId: string, paths: string[]) {
  const rows = await prisma.fileEntry.findMany({
    where: { storageNodeId: nodeId, relativePath: { in: paths } },
    select: {
      id: true,
      relativePath: true,
      isDeleted: true,
      name: true,
      entryType: true,
      mimeType: true,
      size: true,
    },
    take: paths.length,
  });
  return new Map(rows.map((row) => [row.relativePath, row]));
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
    const payloads: RemoteEntryPayload[] = [];
    const childDirectories: Array<{ path: string; depth: number }> = [];

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
      payloads.push({
        relativePath,
        name: entry.name,
        entryType: entry.type === "directory" ? "DIRECTORY" : "FILE",
        mimeType:
          entry.type === "directory" ? "inode/directory" : guessMimeType(entry.name),
        size: entry.type === "directory" ? null : BigInt(entry.size),
      });

      if (recursive && entry.type === "directory" && currentDepth < maxDepth) {
        childDirectories.push({
          path: `${dirPath.replace(/\/+$/, "")}/${entry.name}`,
          depth: currentDepth + 1,
        });
      }
    }

    const synced = await syncRemoteEntries(node.id, payloads);
    result.created += synced.created;
    result.updated += synced.updated;
    result.errors.push(...synced.errors);

    for (const child of childDirectories) {
      await syncDirectory(child.path, child.depth);
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
