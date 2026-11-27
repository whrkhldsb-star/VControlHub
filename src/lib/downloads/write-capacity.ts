import type { Prisma } from "@prisma/client";
import { quotaGrantPolicy } from "@/lib/storage/quota-policy";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { prisma } from "@/lib/db";
import { isGlobalTeamManager } from "@/lib/auth/team-scope";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { getStorageWriteCapacity, StorageWriteCapacity } from "@/lib/storage/access-control";
import { isCaseInsensitiveStorageNode, normalizeStorageTargetDirectory } from "@/lib/storage/path-utils";

function minimum(a: bigint | null, b: bigint | null) {
  return a === null ? b : b === null || a < b ? a : b;
}

/** Admission and staging use every enclosing writable grant, each measured under its own prefix. */
export async function downloadWriteCapacity(input: Parameters<typeof getStorageWriteCapacity>[0], fileName: string | null,
  db: Pick<Prisma.TransactionClient, "userStorageAccess" | "fileEntry"> = prisma): Promise<StorageWriteCapacity & { denied?: boolean; replacing?: boolean }> {
  const directory = input.relativePath === "." ? "" : input.relativePath;
  const path = normalizeStorageTargetDirectory([directory, fileName].filter(Boolean).join("/"));
  const unlimited = { maxFileBytes: null, remainingBytes: null };
  if (!path.ok) return { denied: true, maxFileBytes: BigInt(0), remainingBytes: BigInt(0) };
  if (isGlobalTeamManager(input.session) || sessionHasPermission(input.session, "storage:manage-node")) return unlimited;
  const grants = await db.userStorageAccess.findMany({
    where: { storageNodeId: input.storageNodeId, userId: input.session.userId },
    select: { canWrite: true, pathPrefix: true, maxFileBytes: true, quotaBytes: true },
  });
  if (!grants.length) return unlimited;
  const storageNodeModel = (db as { storageNode?: { findUnique?: typeof prisma.storageNode.findUnique } }).storageNode;
  const node = storageNodeModel?.findUnique
    ? await storageNodeModel.findUnique({
      where: { id: input.storageNodeId },
      select: { driver: true, basePath: true, server: { select: { operatingSystem: true } } },
    })
    : null;
  const caseInsensitive = isCaseInsensitiveStorageNode(node);
  const { matching, writable } = quotaGrantPolicy(grants, path.path, caseInsensitive);
  if (!writable) return { denied: true, maxFileBytes: BigInt(0), remainingBytes: BigInt(0) };
  let maxFileBytes: bigint | null = null;
  let remainingBytes: bigint | null = null;
  const mode = caseInsensitive ? { mode: "insensitive" as const } : {};
  const replaced = fileName && matching.some(grant => grant.quotaBytes !== null) ? await db.fileEntry.findFirst({
    where: {
      storageNodeId: input.storageNodeId,
      relativePath: caseInsensitive ? { equals: path.path, mode: "insensitive" as const } : path.path,
      entryType: "FILE",
      isDeleted: false,
    },
    select: { size: true },
  }) : null;
  for (const grant of matching) {
    maxFileBytes = minimum(maxFileBytes, grant.maxFileBytes);
    if (grant.quotaBytes === null) continue;
    const prefix = normalizeStorageTargetDirectory(grant.pathPrefix);
    if (!prefix.ok) continue;
    const exactPrefix = caseInsensitive ? { equals: prefix.path, mode: "insensitive" as const } : prefix.path;
    const usage = await db.fileEntry.aggregate({
      where: { storageNodeId: input.storageNodeId, entryType: "FILE", isDeleted: false,
        ...(prefix.path && { OR: [{ relativePath: exactPrefix }, { relativePath: { startsWith: escapeLikeLiteral(prefix.path + "/"), ...mode } }] }) },
      _sum: { size: true },
    });
    const available = grant.quotaBytes - (usage._sum.size ?? BigInt(0)) + (replaced?.size ?? BigInt(0));
    remainingBytes = minimum(remainingBytes, available > BigInt(0) ? available : BigInt(0));
  }
  return { maxFileBytes, remainingBytes, ...(replaced ? { replacing: true } : {}) };
}
