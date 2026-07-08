import path from "node:path";

import { Prisma } from "@prisma/client";

import { config } from "@/lib/config/env";
import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";

export type StorageAccessOperation = "read" | "write" | "delete";

export type StorageAccessDecision = {
  allowed: boolean;
  reason?: string;
  matchedGrantId?: string;
};

type StorageAccessGrantRow = Prisma.UserStorageAccessGetPayload<Record<string, never>>;

function normalizeAccessPath(value: string | null | undefined) {
  const cleaned = (value ?? "")
    .replace(/\\/g, "/")
    .split("/")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .join("/");

  if (!cleaned) return "";

  const normalized = path.posix.normalize(cleaned);
  if (normalized === ".") return "";
  if (normalized === ".." || normalized.startsWith("../") || path.posix.isAbsolute(normalized)) {
    return null;
  }
  return normalized;
}

function pathMatchesGrant(targetPath: string, pathPrefix: string) {
  const normalizedTarget = normalizeAccessPath(targetPath);
  const normalizedPrefix = normalizeAccessPath(pathPrefix);

  if (normalizedTarget === null || normalizedPrefix === null) {
    return false;
  }

  if (!normalizedPrefix) {
    return true;
  }

  return normalizedTarget === normalizedPrefix || normalizedTarget.startsWith(`${normalizedPrefix}/`);
}

function grantAllowsOperation(
  grant: { canRead: boolean; canWrite: boolean; canDelete: boolean },
  operation: StorageAccessOperation,
) {
  if (operation === "read") return grant.canRead;
  if (operation === "write") return grant.canWrite;
  return grant.canDelete;
}

export function parseNullableBigIntInput(value: unknown): bigint | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "bigint") return value >= BigInt(0) ? value : null;
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? BigInt(Math.floor(value)) : null;
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    if (!/^\d+$/.test(trimmed)) return null;
    return BigInt(trimmed);
  }
  return null;
}

async function getGrantUsageBytes(input: { storageNodeId: string; pathPrefix: string }) {
  const normalizedPrefix = normalizeAccessPath(input.pathPrefix);
  if (normalizedPrefix === null) return BigInt(0);
  const usage = await prisma.fileEntry.aggregate({
    where: {
      storageNodeId: input.storageNodeId,
      isDeleted: false,
      entryType: "FILE",
      ...(normalizedPrefix
        ? {
            OR: [
              { relativePath: normalizedPrefix },
              { relativePath: { startsWith: `${normalizedPrefix}/` } },
            ],
          }
        : {}),
    },
    _sum: { size: true },
  });

  return usage._sum.size ?? BigInt(0);
}

function isLegacyGrantFallbackEnabled() {
  return config.storage.grantFallback;
}

export async function assertStorageAccess(input: {
  session: SessionPayload;
  storageNodeId: string;
  relativePath?: string | null;
  operation: StorageAccessOperation;
  writeBytes?: number | bigint | null;
}): Promise<StorageAccessDecision> {
  const requiredPermission = input.operation === "delete" ? "storage:delete" : input.operation === "read" ? "storage:read" : "storage:write";
  if (!sessionHasPermission(input.session, requiredPermission)) {
    return { allowed: false, reason: "Missing operation permission" };
  }

  // Storage managers/admins retain full access for break-glass maintenance.
  if (sessionHasPermission(input.session, "storage:manage-node")) {
    return { allowed: true };
  }

  // P2: take=500 上界。单 user × 单 storageNode 的 grant 数本质有限。
  const grants = await prisma.userStorageAccess.findMany({
    where: { userId: input.session.userId, storageNodeId: input.storageNodeId },
    orderBy: [{ pathPrefix: "desc" }, { createdAt: "asc" }],
    take: 500,
  });

  if (grants.length === 0) {
    if (isLegacyGrantFallbackEnabled()) {
      return { allowed: true };
    }
    return { allowed: false, reason: "No access authorization for this storage node or path" };
  }

  const targetPath = normalizeAccessPath(input.relativePath);
  if (targetPath === null) {
    return { allowed: false, reason: "Invalid request path" };
  }
  const matchingGrants = grants.filter((grant: StorageAccessGrantRow) => pathMatchesGrant(targetPath, grant.pathPrefix));
  const operationGrant = matchingGrants.find((grant: StorageAccessGrantRow) => grantAllowsOperation(grant, input.operation));

  if (!operationGrant) {
    return { allowed: false, reason: "No access authorization for this storage node or path" };
  }

  const writeBytes = input.writeBytes === null || input.writeBytes === undefined
    ? null
    : typeof input.writeBytes === "bigint"
      ? input.writeBytes
      : BigInt(Math.max(0, Math.floor(input.writeBytes)));

  if (input.operation === "write" && writeBytes !== null) {
    if (operationGrant.maxFileBytes !== null && writeBytes > operationGrant.maxFileBytes) {
      return { allowed: false, reason: "Uploaded file exceeds the single file size limit of this authorization", matchedGrantId: operationGrant.id };
    }

    if (operationGrant.quotaBytes !== null) {
      const usedBytes = await getGrantUsageBytes({
        storageNodeId: input.storageNodeId,
        pathPrefix: operationGrant.pathPrefix,
      });
      if (usedBytes + writeBytes > operationGrant.quotaBytes) {
        return { allowed: false, reason: "Write will exceed the capacity quota of this authorization", matchedGrantId: operationGrant.id };
      }
    }
  }

  return { allowed: true, matchedGrantId: operationGrant.id };
}

export type StorageAccessCapability = {
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
};

export function getStorageAccessCapabilityKey(input: {
  storageNodeId: string;
  relativePath?: string | null;
}) {
  const normalizedPath = normalizeAccessPath(input.relativePath);
  if (normalizedPath === null) return null;
  return `${input.storageNodeId}:${normalizedPath}`;
}

export async function getStorageAccessCapabilities(input: {
  session: SessionPayload;
  targets: Array<{ storageNodeId: string; relativePath?: string | null }>;
}): Promise<Map<string, StorageAccessCapability>> {
  const result = new Map<string, StorageAccessCapability>();
  const canRoleRead = sessionHasPermission(input.session, "storage:read");
  const canRoleWrite = sessionHasPermission(input.session, "storage:write");
  const canRoleDelete = sessionHasPermission(input.session, "storage:delete");
  const canManageNodes = sessionHasPermission(input.session, "storage:manage-node");

  const uniqueTargets = new Map<string, { storageNodeId: string; relativePath: string }>();
  for (const target of input.targets) {
    const normalizedPath = normalizeAccessPath(target.relativePath);
    if (normalizedPath === null) {
      result.set(`${target.storageNodeId}:`, { canRead: false, canWrite: false, canDelete: false });
      continue;
    }
    uniqueTargets.set(`${target.storageNodeId}:${normalizedPath}`, {
      storageNodeId: target.storageNodeId,
      relativePath: normalizedPath,
    });
  }

  if (uniqueTargets.size === 0) return result;

  if (canManageNodes) {
    for (const [key] of uniqueTargets) {
      result.set(key, { canRead: true, canWrite: true, canDelete: true });
    }
    return result;
  }

  const nodeIds = [...new Set([...uniqueTargets.values()].map((target) => target.storageNodeId))];
  // P2: take=5000 上界。批量预查 (user × N nodeId)，N 通常 <=10 节点 × 500 grant = 5k 足够。
  const grants = await prisma.userStorageAccess.findMany({
    where: { userId: input.session.userId, storageNodeId: { in: nodeIds } },
    orderBy: [{ pathPrefix: "desc" }, { createdAt: "asc" }],
    take: 5000,
  });
  const grantsByNode = new Map<string, StorageAccessGrantRow[]>();
  for (const grant of grants) {
    const rows = grantsByNode.get(grant.storageNodeId) ?? [];
    rows.push(grant);
    grantsByNode.set(grant.storageNodeId, rows);
  }

  const legacyFallback = isLegacyGrantFallbackEnabled();
  for (const [key, target] of uniqueTargets) {
    const nodeGrants = grantsByNode.get(target.storageNodeId) ?? [];
    if (nodeGrants.length === 0) {
      result.set(key, {
        canRead: canRoleRead && legacyFallback,
        canWrite: canRoleWrite && legacyFallback,
        canDelete: canRoleDelete && legacyFallback,
      });
      continue;
    }

    const matchingGrants = nodeGrants.filter((grant) => pathMatchesGrant(target.relativePath, grant.pathPrefix));
    result.set(key, {
      canRead: canRoleRead && matchingGrants.some((grant) => grant.canRead),
      canWrite: canRoleWrite && matchingGrants.some((grant) => grant.canWrite),
      canDelete: canRoleDelete && matchingGrants.some((grant) => grant.canDelete),
    });
  }

  return result;
}

export async function getStorageAccessUsage(input: { storageNodeId: string; pathPrefix: string }) {
  return getGrantUsageBytes(input);
}
