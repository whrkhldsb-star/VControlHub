import { createHash, randomBytes } from "node:crypto";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import type { SessionPayload } from "@/lib/auth/session";

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

const INVALID_SHARE_PATH_MESSAGE = "分享路径必须是存储节点内的安全相对路径";

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

export async function listShareLinks() {
  return prisma.shareLink.findMany({ orderBy: { createdAt: "desc" }, include: { storageNode: { select: { id: true, name: true, driver: true } }, creator: { select: { username: true, displayName: true } } } });
}

export async function revokeShareLink(id: string) {
  return prisma.shareLink.update({ where: { id }, data: { revokedAt: new Date() } });
}

export async function resolveShareToken(token: string) {
  const share = await prisma.shareLink.findUnique({ where: { tokenHash: hashShareToken(token) }, include: { storageNode: true } });
  if (!share || share.revokedAt) throw new Error("分享链接不存在或已撤销");
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw new Error("分享链接已过期");
  await prisma.shareLink.update({ where: { id: share.id }, data: { accessCount: { increment: 1 } } });
  return share;
}
