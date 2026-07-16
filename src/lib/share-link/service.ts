import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";

import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { serverT } from "@/lib/i18n/server-locale";
import { t } from "@/lib/i18n/translations";
import { guessMimeType } from "@/lib/image-bed/constants";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { expandStorageBasePath } from "@/lib/storage/path-utils";
import { getSftpSyncNode, syncSftpDirectoryEntries } from "@/lib/storage/sftp-sync";
import type { SessionPayload } from "@/lib/auth/session";

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeSharePath(path: string) {
  const rawPath = path.trim();
  if (!rawPath) {
    throw new ValidationError(t("backend.shareLink.invalidSharePath"));
  }

  if (/\0|[\u0000-\u001F\u007F]/.test(rawPath)) {
    throw new ValidationError(t("backend.shareLink.invalidSharePath"));
  }

  if (/^[a-zA-Z]:/.test(rawPath) || rawPath.startsWith("//")) {
    throw new ValidationError(t("backend.shareLink.invalidSharePath"));
  }

  const normalizedPath = rawPath
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+/g, "/");

  const segments = normalizedPath.split("/").filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new ValidationError(t("backend.shareLink.invalidSharePath"));
  }

  return segments.join("/");
}

export function hashSharePassword(password: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifySharePassword(password: string, stored: string) {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  const computed = scryptSync(password, salt, expected.length);
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

const SHARE_STORAGE_NODE_INCLUDE = {
  storageNode: {
    include: {
      server: {
        include: { sshKey: true },
      },
    },
  },
} as const;

async function recordShareAccess(input: { shareLinkId: string; action: string; ip?: string; userAgent?: string }) {
  const model = prisma.shareAccessLog;
  if (!model) return;
  await model.create({ data: { shareLinkId: input.shareLinkId, action: input.action, ip: input.ip ?? null, userAgent: input.userAgent ?? null } }).catch(() => undefined);
}

export async function createShareLink(input: {
  session: SessionPayload;
  fileEntryId?: string;
  storageNodeId: string;
  path: string;
  entryType?: "FILE" | "DIRECTORY";
  name?: string;
  expiresInHours?: number;
  maxDownloads?: number | null;
  password?: string;
  permissionLevel?: "preview" | "download";
}) {
  const normalizedPath = normalizeSharePath(input.path);
  const access = await assertStorageAccess({ session: input.session, storageNodeId: input.storageNodeId, relativePath: normalizedPath, operation: "read" });
  if (!access.allowed) {
    const t = await serverT();
    throw new ForbiddenError(access.reason || t("backend.shareLink.noSharePermission"));
  }

  const token = randomBytes(36).toString("base64url").slice(0, 48);
  const expiresAt = input.expiresInHours ? new Date(Date.now() + input.expiresInHours * 60 * 60 * 1000) : null;
  const teamData = teamCreateData(input.session);
  const share = await prisma.shareLink.create({
    data: {
      tokenHash: hashShareToken(token),
      storageNodeId: input.storageNodeId,
      path: normalizedPath,
      entryType: input.entryType ?? "FILE",
      name: input.name ?? normalizedPath.split("/").filter(Boolean).pop() ?? normalizedPath,
      expiresAt,
      maxDownloads: input.maxDownloads ?? null,
      passwordHash: input.password ? hashSharePassword(input.password) : null,
      permissionLevel: input.permissionLevel ?? "download",
      createdBy: input.session.userId,
      ...teamData,
    },
  });
  return { share, token };
}

export async function createShareLinkFromFileEntry(input: {
  session: SessionPayload;
  fileEntryId: string;
  name?: string;
  expiresInHours?: number;
  maxDownloads?: number | null;
  password?: string;
  permissionLevel?: "preview" | "download";
}) {
  const t = await serverT();
  const entry = await prisma.fileEntry.findUnique({
    where: { id: input.fileEntryId },
    include: { storageNode: true },
  });
  if (!entry || entry.isDeleted) throw new NotFoundError(t("backend.shareLink.fileNotFound"));

  return createShareLink({
    session: input.session,
    fileEntryId: entry.id,
    storageNodeId: entry.storageNodeId,
    path: entry.relativePath,
    entryType: entry.entryType === "DIRECTORY" ? "DIRECTORY" : "FILE",
    name: input.name ?? entry.name,
    expiresInHours: input.expiresInHours,
    maxDownloads: input.maxDownloads,
    password: input.password,
    permissionLevel: input.permissionLevel,
  });
}

export async function listShareLinks(userId?: string, session?: { userId: string; roles: import("@/lib/auth/rbac").RoleKey[]; currentTeamId: string | null }) {
  const teamFilter = session ? teamWhere(session) : {};
  const where: Record<string, unknown> = userId ? { createdBy: userId } : {};
  if (session) Object.assign(where, teamFilter);
  return prisma.shareLink.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
    include: {
      storageNode: { select: { id: true, name: true, driver: true } },
      creator: { select: { username: true, displayName: true } },
    },
  });
}

export async function revokeShareLink(id: string, userId?: string) {
  // When userId is provided, scope by ownership to prevent IDOR.
  // Admin users with share:manage-all can pass undefined to revoke any.
  const where = userId ? { id, createdBy: userId } : { id };
  const share = await prisma.shareLink.findFirst({ where, select: { id: true } });
  if (!share) throw new NotFoundError("Share link not found or not authorized to revoke");
  return prisma.shareLink.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
}

export async function resolveShareToken(token: string, password?: string, context?: { ip?: string; userAgent?: string }) {
  const t = await serverT();
  const share = await prisma.shareLink.findUnique({ where: { tokenHash: hashShareToken(token) }, include: SHARE_STORAGE_NODE_INCLUDE });
  if (!share || share.revokedAt) throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw new ValidationError(t("backend.shareLink.expired"));
  if (share.permissionLevel === "preview") throw new ForbiddenError("This share is preview-only; downloads are not permitted");
  if (share.passwordHash) {
    if (!password) {
      await recordShareAccess({ shareLinkId: share.id, action: "password_attempt", ip: context?.ip, userAgent: context?.userAgent });
      throw new ValidationError(t("backend.shareLink.passwordRequired"));
    }
    if (!verifySharePassword(password, share.passwordHash)) {
      await recordShareAccess({ shareLinkId: share.id, action: "password_attempt", ip: context?.ip, userAgent: context?.userAgent });
      throw new ValidationError(t("backend.shareLink.passwordIncorrect"));
    }
  }
  // Atomic quota claim: only increment when still under maxDownloads (or unlimited).
  // Prevents concurrent downloads from exceeding the cap, and avoids a separate
  // read-then-write race on accessCount.
  if (share.maxDownloads != null) {
    const claimed = await prisma.shareLink.updateMany({
      where: {
        id: share.id,
        revokedAt: null,
        accessCount: { lt: share.maxDownloads },
      },
      data: { accessCount: { increment: 1 } },
    });
    if (claimed.count === 0) {
      throw new ValidationError(t("backend.shareLink.maxDownloadsExceeded"));
    }
  } else {
    await prisma.shareLink.update({ where: { id: share.id }, data: { accessCount: { increment: 1 } } });
  }
  // Record access log (best-effort, non-blocking on failure).
  await recordShareAccess({ shareLinkId: share.id, action: "download", ip: context?.ip, userAgent: context?.userAgent });
  return share;
}

/**
 * 只读解析分享 token，用于落地页展示，不递增访问计数。
 * 真正的下载（/api/share/[token]）才会通过 resolveShareToken 计数。
 */
export async function peekShareToken(token: string, context?: { ip?: string; userAgent?: string }) {
  const t = await serverT();
  const share = await prisma.shareLink.findUnique({ where: { tokenHash: hashShareToken(token) }, include: SHARE_STORAGE_NODE_INCLUDE });
  if (!share || share.revokedAt) throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw new ValidationError(t("backend.shareLink.expired"));
  // Record view access log (best-effort, non-blocking on failure).
  await recordShareAccess({ shareLinkId: share.id, action: "view", ip: context?.ip, userAgent: context?.userAgent });
  return { ...share, hasPassword: !!share.passwordHash };
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
		// Directory unreadable (permission denied, missing, etc.) — nothing to list.
		return;
	}

	// Build a deterministic list of records (filter + stat) so we can
	// resolve the existing rows in a single `findMany` instead of one
	// `findFirst` per entry. (TR-040 R1.2)
	const records: Array<{
		relativePath: string;
		name: string;
		entryType: "FILE" | "DIRECTORY";
		mimeType: string;
		size: bigint | null;
	}> = [];
	for (const entry of entries) {
		if (!entry.isFile() && !entry.isDirectory()) continue;
		const relativePath = `${normalizedPrefix}/${entry.name}`.replace(/^\/+/, "");
		const absolutePath = path.join(absoluteDir, entry.name);
		const fileStat = await stat(absolutePath).catch(() => null);
		if (!fileStat) continue;
		const entryType: "FILE" | "DIRECTORY" = entry.isDirectory() ? "DIRECTORY" : "FILE";
		records.push({
			relativePath,
			name: entry.name,
			entryType,
			mimeType: entryType === "DIRECTORY" ? "inode/directory" : (guessMimeType(entry.name) ?? "application/octet-stream"),
			size: entryType === "FILE" ? BigInt(fileStat.size) : null,
		});
	}
	if (records.length === 0) return;

	// Single round-trip to learn which records already exist.
	const existingRows = await prisma.fileEntry.findMany({
		where: {
			storageNodeId: share.storageNodeId,
			relativePath: { in: records.map((r) => r.relativePath) },
		},
		select: { id: true, relativePath: true },
		take: 5000, // P2: records.length 已外部限,5k 作 hard 上界
	});
	const existingByPath = new Map(existingRows.map((row) => [row.relativePath, row]));

	const toCreate = records.filter((r) => !existingByPath.has(r.relativePath));
	const toUpdate = records.filter((r) => existingByPath.has(r.relativePath));

	// Batch inserts (createMany) + parallel updates (Promise.all). Per-row
	// failure isolation only matters for the update branch; createMany is
	// atomic on the DB side and a schema mismatch will surface as a single
	// thrown error, matching the prior all-or-nothing semantics of the
	// per-entry findFirst path.
	if (toCreate.length > 0) {
		await prisma.fileEntry.createMany({
			data: toCreate.map((r) => ({
				storageNodeId: share.storageNodeId,
				relativePath: r.relativePath,
				name: r.name,
				entryType: r.entryType,
				mimeType: r.mimeType,
				size: r.size ?? undefined,
			})),
		});
	}
	if (toUpdate.length > 0) {
		await Promise.all(
			toUpdate.map((r) => {
				const row = existingByPath.get(r.relativePath)!;
				return prisma.fileEntry.update({
					where: { id: row.id },
					data: { name: r.name, entryType: r.entryType, mimeType: r.mimeType, size: r.size, isDeleted: false },
				});
			}),
		);
	}
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

export async function listShareAccessLogs(
  shareLinkId: string,
  session: { userId: string; roles: import("@/lib/auth/rbac").RoleKey[]; currentTeamId: string | null },
  take = 100,
) {
  const share = await prisma.shareLink.findFirst({
    where: { id: shareLinkId, ...teamWhere(session) },
    select: { id: true, createdBy: true },
  });
  if (!share) throw new NotFoundError("Share link not found");
  const { sessionHasPermission } = await import("@/lib/auth/authorization");
  if (share.createdBy !== session.userId && !sessionHasPermission(session, "share:manage")) {
    throw new ForbiddenError("Missing permission to view share access logs");
  }
  return prisma.shareAccessLog.findMany({
    where: { shareLinkId },
    orderBy: { accessedAt: "desc" },
    take,
  });
}

export type ShareAccessReportAction = "all" | "view" | "download" | "password_attempt";

export async function getShareAccessReport(input: {
  session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
  days?: number;
  action?: ShareAccessReportAction;
  take?: number;
}) {
  const days = Math.min(Math.max(input.days ?? 30, 1), 365);
  const take = Math.min(Math.max(input.take ?? 100, 1), 500);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const action = input.action ?? "all";
  const where = {
    accessedAt: { gte: since },
    ...(action === "all" ? {} : { action }),
    shareLink: teamWhere(input.session),
  };
  const [logs, grouped, uniqueIpRows] = await Promise.all([
    prisma.shareAccessLog.findMany({
      where,
      orderBy: { accessedAt: "desc" },
      take,
      select: {
        id: true, action: true, ip: true, userAgent: true, accessedAt: true,
        shareLink: { select: { id: true, name: true, path: true, permissionLevel: true, revokedAt: true } },
      },
    }),
    prisma.shareAccessLog.groupBy({
      by: ["shareLinkId", "action"], where, _count: { _all: true }, orderBy: { _count: { shareLinkId: "desc" } }, take: 2000,
    }),
    prisma.shareAccessLog.findMany({ where: { ...where, ip: { not: null } }, distinct: ["ip"], select: { ip: true }, take: 10000 }),
  ]);
  const shareIds = Array.from(new Set(grouped.map((row) => row.shareLinkId)));
  const shares = shareIds.length > 0 ? await prisma.shareLink.findMany({
    where: { id: { in: shareIds }, ...teamWhere(input.session) },
    select: { id: true, name: true, path: true, permissionLevel: true, revokedAt: true },
  }) : [];
  const shareMap = new Map(shares.map((share) => [share.id, share]));
  const byShareMap = new Map<string, { shareId: string; name: string; path: string; permissionLevel: string; revoked: boolean; view: number; download: number; passwordAttempt: number; total: number }>();
  const totals = { total: 0, view: 0, download: 0, passwordAttempt: 0, uniqueIps: uniqueIpRows.length };
  for (const row of grouped) {
    const count = row._count._all;
    const share = shareMap.get(row.shareLinkId);
    const current = byShareMap.get(row.shareLinkId) ?? {
      shareId: row.shareLinkId, name: share?.name ?? share?.path ?? row.shareLinkId, path: share?.path ?? "", permissionLevel: share?.permissionLevel ?? "download", revoked: Boolean(share?.revokedAt),
      view: 0, download: 0, passwordAttempt: 0, total: 0,
    };
    current.total += count;
    totals.total += count;
    if (row.action === "view") { current.view += count; totals.view += count; }
    else if (row.action === "download") { current.download += count; totals.download += count; }
    else if (row.action === "password_attempt") { current.passwordAttempt += count; totals.passwordAttempt += count; }
    byShareMap.set(row.shareLinkId, current);
  }
  return {
    range: { days, since: since.toISOString(), until: new Date().toISOString(), action },
    totals,
    byShare: Array.from(byShareMap.values()).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 100),
    logs: logs.map((log) => ({ ...log, accessedAt: log.accessedAt.toISOString(), share: log.shareLink })),
  };
}
