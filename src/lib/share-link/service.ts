import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import type { SessionPayload } from "@/lib/auth/session";

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const INVALID_SHARE_PATH_MESSAGE = "分享路径必须是存储节点内的安全相对路径";

const SHARE_STORAGE_NODE_INCLUDE = {
  storageNode: {
    include: {
      server: {
        include: { sshKey: true },
      },
    },
  },
} as const;

export function normalizeSharePath(path: string) {
  const rawPath = path.trim();
  if (!rawPath) {
    throw new Error(INVALID_SHARE_PATH_MESSAGE);
  }

  if (/\0|[\u0000-\u001F\u007F]/.test(rawPath)) {
    throw new Error(INVALID_SHARE_PATH_MESSAGE);
  }

  if (/^[a-zA-Z]:/.test(rawPath) || rawPath.startsWith("//")) {
    throw new Error(INVALID_SHARE_PATH_MESSAGE);
  }

  const normalizedPath = rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new Error(INVALID_SHARE_PATH_MESSAGE);
  }

  return segments.join("/");
}

export async function createShareLink(input: {
  session: SessionPayload;
  fileEntryId?: string;
  storageNodeId: string;
  path: string;
  entryType?: "FILE" | "DIRECTORY";
  name?: string;
  expiresInHours?: number;
}) {
  const normalizedPath = normalizeSharePath(input.path);
  const access = await assertStorageAccess({ session: input.session, storageNodeId: input.storageNodeId, relativePath: normalizedPath, operation: "read" });
  if (!access.allowed) throw new Error(access.reason || "没有该路径的分享权限");

  const token = randomBytes(36).toString("base64url").slice(0, 48);
  const expiresAt = input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000) : null;
  const share = await prisma.shareLink.create({
    data: {
      tokenHash: hashShareToken(token),
      storageNodeId: input.storageNodeId,
      path: normalizedPath,
      entryType: input.entryType ?? "FILE",
      name: input.name ?? normalizedPath.split("/").filter(Boolean).pop() ?? normalizedPath,
      expiresAt,
      createdBy: input.session.userId,
    },
  });
  return { share, token };
}

export async function createShareLinkFromFileEntry(input: {
  session: SessionPayload;
  fileEntryId: string;
  name?: string;
  expiresInHours?: number;
}) {
  const entry = await prisma.fileEntry.findUnique({
    where: { id: input.fileEntryId },
    include: { storageNode: true },
  });
  if (!entry || entry.isDeleted) throw new Error("文件不存在或已删除");

  return createShareLink({
    session: input.session,
    fileEntryId: entry.id,
    storageNodeId: entry.storageNodeId,
    path: entry.relativePath,
    entryType: entry.entryType === "DIRECTORY" ? "DIRECTORY" : "FILE",
    name: input.name ?? entry.name,
    expiresInHours: input.expiresInHours,
  });
}

export async function listShareLinks() {
  return prisma.shareLink.findMany({
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      storageNode: { select: { id: true, name: true, driver: true } },
      creator: { select: { username: true, displayName: true } },
    },
  });
}

export async function revokeShareLink(id: string) {
  return prisma.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function resolveShareToken(token: string) {
  const share = await prisma.shareLink.findUnique({ where: { tokenHash: hashShareToken(token) }, include: SHARE_STORAGE_NODE_INCLUDE });
  if (!share || share.revokedAt) throw new Error("分享链接不存在或已撤销");
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw new Error("分享链接已过期");
  await prisma.shareLink.update({ where: { id: share.id }, data: { accessCount: { increment: 1 } } });
  return share;
}

/**
 * 只读解析分享 token，用于落地页展示，不递增访问计数。
 * 真正的下载（/api/share/[token]）才会通过 resolveShareToken 计数。
 */
export async function peekShareToken(token: string) {
  const share = await prisma.shareLink.findUnique({ where: { tokenHash: hashShareToken(token) }, include: SHARE_STORAGE_NODE_INCLUDE });
  if (!share || share.revokedAt) throw new Error("分享链接不存在或已撤销");
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw new Error("分享链接已过期");
  return share;
}

export async function listShareDirectoryFiles(share: { storageNodeId: string; path: string; entryType: string }) {
  if (share.entryType !== "DIRECTORY") return [];
  const prefix = share.path.replace(/^\/+|\/+$/g, "");
  return prisma.fileEntry.findMany({
    where: {
      storageNodeId: share.storageNodeId,
      entryType: "FILE",
      isDeleted: false,
      OR: [
        { relativePath: { startsWith: `${prefix}/` } },
        { relativePath: prefix },
      ],
    },
    orderBy: [{ relativePath: "asc" }],
    take: 200,
    select: { id: true, name: true, relativePath: true, size: true, mimeType: true, updatedAt: true },
  });
}
