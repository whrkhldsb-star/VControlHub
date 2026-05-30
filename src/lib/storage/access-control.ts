import path from "node:path";

import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";

export type StorageAccessOperation = "read" | "write" | "delete";

export type StorageAccessDecision = {
  allowed: boolean;
  reason?: string;
  matchedGrantId?: string;
};

type FileEntrySizeRow = Prisma.FileEntryGetPayload<{ select: { size: true } }>;
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
  const rows = await prisma.fileEntry.findMany({
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
    select: { size: true },
  });

  return rows.reduce((total: bigint, row: FileEntrySizeRow) => total + (row.size ?? BigInt(0)), BigInt(0));
}

function isLegacyGrantFallbackEnabled() {
  return ["1", "true", "yes", "on"].includes((process.env.VCONTROLHUB_STORAGE_GRANT_FALLBACK ?? "").trim().toLowerCase());
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
    return { allowed: false, reason: "缺少操作权限" };
  }

  // Storage managers/admins retain full access for break-glass maintenance.
  if (sessionHasPermission(input.session, "storage:manage-node")) {
    return { allowed: true };
  }

  const grants = await prisma.userStorageAccess.findMany({
    where: { userId: input.session.userId, storageNodeId: input.storageNodeId },
    orderBy: [{ pathPrefix: "desc" }, { createdAt: "asc" }],
  });

  if (grants.length === 0) {
    if (isLegacyGrantFallbackEnabled()) {
      return { allowed: true };
    }
    return { allowed: false, reason: "没有该存储节点或路径的访问授权" };
  }

  const targetPath = normalizeAccessPath(input.relativePath);
  if (targetPath === null) {
    return { allowed: false, reason: "请求路径无效" };
  }
  const matchingGrants = grants.filter((grant: StorageAccessGrantRow) => pathMatchesGrant(targetPath, grant.pathPrefix));
  const operationGrant = matchingGrants.find((grant: StorageAccessGrantRow) => grantAllowsOperation(grant, input.operation));

  if (!operationGrant) {
    return { allowed: false, reason: "没有该存储节点或路径的访问授权" };
  }

  const writeBytes = input.writeBytes === null || input.writeBytes === undefined
    ? null
    : typeof input.writeBytes === "bigint"
      ? input.writeBytes
      : BigInt(Math.max(0, Math.floor(input.writeBytes)));

  if (input.operation === "write" && writeBytes !== null) {
    if (operationGrant.maxFileBytes !== null && writeBytes > operationGrant.maxFileBytes) {
      return { allowed: false, reason: "上传文件超过该授权的单文件大小限制", matchedGrantId: operationGrant.id };
    }

    if (operationGrant.quotaBytes !== null) {
      const usedBytes = await getGrantUsageBytes({
        storageNodeId: input.storageNodeId,
        pathPrefix: operationGrant.pathPrefix,
      });
      if (usedBytes + writeBytes > operationGrant.quotaBytes) {
        return { allowed: false, reason: "写入后将超过该授权的容量配额", matchedGrantId: operationGrant.id };
      }
    }
  }

  return { allowed: true, matchedGrantId: operationGrant.id };
}

export async function getStorageAccessUsage(input: { storageNodeId: string; pathPrefix: string }) {
  return getGrantUsageBytes(input);
}
