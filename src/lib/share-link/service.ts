import { createHash, randomBytes } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { guessMimeType } from "@/lib/image-bed/constants";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { expandStorageBasePath } from "@/lib/storage/path-utils";
import { getSftpSyncNode, syncSftpDirectoryEntries } from "@/lib/storage/sftp-sync";
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
    throw new ValidationError(INVALID_SHARE_PATH_MESSAGE);
  }

  if (/\0|[\u0000-\u001F\u007F]/.test(rawPath)) {
    throw new ValidationError(INVALID_SHARE_PATH_MESSAGE);
  }

  if (/^[a-zA-Z]:/.test(rawPath) || rawPath.startsWith("//")) {
    throw new ValidationError(INVALID_SHARE_PATH_MESSAGE);
  }

  const normalizedPath = rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new ValidationError(INVALID_SHARE_PATH_MESSAGE);
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
  if (!access.allowed) throw new ForbiddenError(access.reason || "没有该路径的分享权限");

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
  if (!entry || entry.isDeleted) throw new NotFoundError("文件不存在或已删除");

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
  if (!share || share.revokedAt) throw new NotFoundError("分享链接不存在或已撤销");
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw new ValidationError("分享链接已过期");
  await prisma.shareLink.update({ where: { id: share.id }, data: { accessCount: { increment: 1 } } });
  return share;
}

/**
 * 只读解析分享 token，用于落地页展示，不递增访问计数。
 * 真正的下载（/api/share/[token]）才会通过 resolveShareToken 计数。
 */
export async function peekShareToken(token: string) {
  const share = await prisma.shareLink.findUnique({ where: { tokenHash: hashShareToken(token) }, include: SHARE_STORAGE_NODE_INCLUDE });
  if (!share || share.revokedAt) throw new NotFoundError("分享链接不存在或已撤销");
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw new ValidationError("分享链接已过期");
  return share;
}

async function syncLocalShareDirectory(share: { storageNodeId: string; storageNode?: { basePath: string }; path: string }) {
  const basePath = share.storageNode?.basePath;
  if (!basePath) return;
  const normalizedPrefix = share.path.replace(/^\/+|\/+$/g, "");
  const allowedRoot = path.resolve(expandStorageBasePath(basePath));
  const absoluteDir = path.resolve(allowedRoot, normalizedPrefix);
  const relativeToRoot = path.relative(allowedRoot, absoluteDir);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) return;

  let entries: Dirent[];
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    return;
  }

  await Promise.all(entries.map(async (entry) => {
    if (!entry.isFile() && !entry.isDirectory()) return;
    const relativePath = `${normalizedPrefix}/${entry.name}`.replace(/^\/+/, "");
    const absolutePath = path.join(absoluteDir, entry.name);
    const fileStat = await stat(absolutePath).catch(() => null);
    if (!fileStat) return;
    const entryType = entry.isDirectory() ? "DIRECTORY" : "FILE";
    const mimeType = entryType === "DIRECTORY" ? "inode/directory" : guessMimeType(entry.name);
    const size = entryType === "FILE" ? BigInt(fileStat.size) : null;
    const existing = await prisma.fileEntry.findFirst({ where: { storageNodeId: share.storageNodeId, relativePath } });
    if (existing) {
      await prisma.fileEntry.update({ where: { id: existing.id }, data: { name: entry.name, entryType, mimeType, size, isDeleted: false } });
      return;
    }
    await prisma.fileEntry.create({ data: { storageNodeId: share.storageNodeId, relativePath, name: entry.name, entryType, mimeType, size: size ?? undefined } });
  }));
}

async function refreshShareDirectoryIndex(share: Awaited<ReturnType<typeof peekShareToken>>) {
  if (share.entryType !== "DIRECTORY") return;
  if (share.storageNode.driver === "LOCAL") {
    await syncLocalShareDirectory(share);
    return;
  }
  if (share.storageNode.driver === "SFTP") {
    const node = await getSftpSyncNode(share.storageNodeId);
    if (node) {
      await syncSftpDirectoryEntries({ node, remotePath: share.path, recursive: false, maxDepth: 1 });
    }
  }
}

export async function listShareDirectoryFiles(share: Awaited<ReturnType<typeof peekShareToken>>) {
  if (share.entryType !== "DIRECTORY") return [];
  await refreshShareDirectoryIndex(share);
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
