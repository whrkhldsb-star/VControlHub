import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/** Async scrypt: runs on the libuv pool instead of blocking the event loop (~90 ms per call). */
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { teamCreateData, shareLinkTeamWhere, storageNodeTeamWhere } from "@/lib/auth/team-scope";

import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { t } from "@/lib/i18n/service-translations";
import { createLogger } from "@/lib/logging";
import { guessMimeType } from "@/lib/image-bed/constants";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { getSftpSyncNode, syncSftpDirectoryEntries } from "@/lib/storage/sftp-sync";
import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
const logger = createLogger("share-link");

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

  // Storage resolution trims every segment (see validateSegments in storage/path-utils), so "docs/ a.txt"
  // and "docs/a.txt" are the same file on disk. The checks made on this string (inside the shared folder,
  // not in the trash) must see the same path, or a padded spelling slips past them.
  const segments = normalizedPath.split("/").map((segment) => segment.trim()).filter(Boolean);
  if (segments.length === 0 || segments.some((segment) => segment === "." || segment === "..")) {
    throw new ValidationError(t("backend.shareLink.invalidSharePath"));
  }

  return segments.join("/");
}

export async function hashSharePassword(password: string) {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 64);
  return `scrypt:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export async function verifySharePassword(password: string, stored: string) {
  const parts = stored.split(":");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1]!, "hex");
  const expected = Buffer.from(parts[2]!, "hex");
  if (salt.length === 0 || expected.length === 0) return false;
  const computed = await scryptAsync(password, salt, expected.length);
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

export async function assertShareTargetNotDeleted(
  storageNodeId: string,
  relativePath: string,
): Promise<void> {
  // The file itself or any folder above it may be in the trash: the bytes of a trashed folder's files stay on disk.
  const segments = typeof relativePath === "string" ? relativePath.split("/").filter(Boolean) : [];
  const paths = segments.map((_, index) => segments.slice(0, index + 1).join("/"));
  const trashed = await prisma.fileEntry.findFirst({
    where: { storageNodeId, relativePath: { in: paths.length ? paths : [relativePath] }, isDeleted: true },
    select: { id: true },
  });
  if (trashed) {
    throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
  }
}

async function recordShareAccess(input: {
  shareLinkId: string;
  action: string;
  ip?: string;
  userAgent?: string;
}) {
  try {
    // Prefer direct model access; fall back to delegate lookup for older
    // Prisma client shapes so access logs never silently no-op.
    const model =
      prisma.shareAccessLog ??
      (prisma as unknown as { shareAccessLog?: typeof prisma.shareAccessLog }).shareAccessLog;
    if (!model?.create) {
      logger.warn("shareAccessLog model unavailable; access log skipped", {
        shareLinkId: input.shareLinkId,
        action: input.action,
      });
      return;
    }
    await model.create({
      data: {
        shareLinkId: input.shareLinkId,
        action: input.action,
        ip: input.ip ?? null,
        userAgent: input.userAgent ?? null,
      },
    });
  } catch (error) {
    logger.warn("Failed to record share access log", {
      shareLinkId: input.shareLinkId,
      action: input.action,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function createShareLink(input: {
  session: SessionPayload;
  storageNodeId: string;
  path: string;
  entryType?: "FILE" | "DIRECTORY";
  name?: string;
  expiresInHours?: number;
  maxDownloads?: number | null;
  password?: string;
  permissionLevel?: "preview" | "download";
}) {
  if (
    input.permissionLevel === "preview" &&
    (input.password || input.maxDownloads != null)
  ) {
    const translate = await serviceT();
    throw new ValidationError(translate("api.share.previewPolicyConflict"));
  }
  const normalizedPath = normalizeSharePath(input.path);
  const access = await assertStorageAccess({ session: input.session, storageNodeId: input.storageNodeId, relativePath: normalizedPath, operation: "read" });
  if (!access.allowed) {
    const t = await serviceT();
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
      passwordHash: input.password ? await hashSharePassword(input.password) : null,
      permissionLevel: input.permissionLevel ?? "download",
      createdBy: input.session.userId,
      ...teamData,
    },
  });
  // The row carries credential material (tokenHash locates the public token's
  // storage; passwordHash is an offline-dictionary-attack target). Strip both
  // from anything a caller might serialize — the plaintext token in the return
  // value is the only credential the creator needs.
  const { tokenHash: _tokenHash, passwordHash: _passwordHash, ...safeShare } = share;
  return { share: safeShare, token };
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
  const t = await serviceT();
  // Scope file entry by storage node team so guessing another team's fileEntryId cannot open a share.
  // Storage nodes are security roots (they carry credentials and user data), so
  // the pre-lookup uses the same quarantine assertStorageAccess enforces — a
  // null-team node is not visible to non-global actors.
  const entry = await prisma.fileEntry.findFirst({
    where: {
      id: input.fileEntryId,
      isDeleted: false,
      storageNode: storageNodeTeamWhere(input.session),
    },
    include: { storageNode: true },
  });
  if (!entry) throw new NotFoundError(t("backend.shareLink.fileNotFound"));

  return createShareLink({
    session: input.session,
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

async function loadActiveShare(token: string) {
  const t = await serviceT();
  const share = await prisma.shareLink.findUnique({ where: { tokenHash: hashShareToken(token) }, include: SHARE_STORAGE_NODE_INCLUDE });
  if (!share || share.revokedAt) throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw new ValidationError(t("backend.shareLink.expired"));
  // A deleted customer is hidden with its data until restored: its public
  // links stop serving its files rather than outlive it.
  const teamIds = [share.teamId, share.storageNode?.teamId].filter((id): id is string => Boolean(id));
  if (teamIds.length > 0 && (await prisma.team.count({ where: { id: { in: teamIds }, deletedAt: { not: null } } })) > 0) {
    throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
  }
  await assertShareTargetNotDeleted(share.storageNodeId, share.path);
  return share;
}

/** Verify a share password without claiming a download quota. */
export async function authorizeShareDownload(
  token: string,
  password: string | undefined,
  context?: { ip?: string; userAgent?: string },
) {
  const t = await serviceT();
  const share = await loadActiveShare(token);
  if (share.permissionLevel === "preview") throw new ForbiddenError(t("backend.shareLink.previewOnly"));
  if (share.passwordHash) {
    if (!password || !(await verifySharePassword(password, share.passwordHash))) {
      await recordShareAccess({ shareLinkId: share.id, action: "password_attempt", ip: context?.ip, userAgent: context?.userAgent });
      throw new ValidationError(password ? t("backend.shareLink.passwordIncorrect") : t("backend.shareLink.passwordRequired"));
    }
  }
  return share;
}

/**
 * Column projection for share lists. Explicit select: `include` returned every
 * scalar column, leaking passwordHash (scrypt of a share password — offline
 * dictionary target) and tokenHash to any viewer holding share:read. Keep the
 * field list in sync with the /shares page UI.
 */
const SHARE_LINK_LIST_SELECT = {
  id: true,
  storageNodeId: true,
  path: true,
  entryType: true,
  name: true,
  expiresAt: true,
  revokedAt: true,
  accessCount: true,
  maxDownloads: true,
  permissionLevel: true,
  createdAt: true,
  updatedAt: true,
  createdBy: true,
  teamId: true,
  storageNode: { select: { id: true, name: true, driver: true } },
  creator: { select: { username: true, displayName: true } },
} as const;

type ShareListSession = { userId: string; roles: import("@/lib/auth/rbac").RoleKey[]; currentTeamId: string | null };

export const SHARE_LINK_STATUS_FILTERS = ["active", "expired", "revoked"] as const;
export type ShareLinkStatusFilter = (typeof SHARE_LINK_STATUS_FILTERS)[number];
export const SHARE_LINK_PAGE_SIZE = 50;
export const SHARE_LINK_MAX_PAGE_SIZE = 200;

export type ShareLinkListOptions = {
  status?: ShareLinkStatusFilter;
  /** Matches name, path or creator. */
  q?: string;
  page?: number;
  pageSize?: number;
};

function shareLinkFilterWhere(options: ShareLinkListOptions, now: Date) {
  const clauses: Record<string, unknown>[] = [];
  if (options.status === "active") clauses.push({ revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
  if (options.status === "expired") clauses.push({ revokedAt: null, expiresAt: { lte: now } });
  if (options.status === "revoked") clauses.push({ revokedAt: { not: null } });
  const q = options.q?.trim();
  if (q) {
    // % and _ are wildcards inside contains; escaped, a search for "100%" finds "100%" and not everything.
    const contains = { contains: escapeLikeLiteral(q), mode: "insensitive" as const };
    clauses.push({
      OR: [
        { name: contains },
        { path: contains },
        { creator: { username: contains } },
        { creator: { displayName: contains } },
      ],
    });
  }
  return clauses;
}

/**
 * One page of the share catalogue with its real total, newest first (id breaks
 * ties so pages never overlap). Every share — however old — stays reachable,
 * and status/search filters run in the database before paging.
 */
export async function listShareLinkPage(session: ShareListSession, options: ShareLinkListOptions = {}) {
  const pageSize = Math.min(Math.max(Math.trunc(options.pageSize ?? SHARE_LINK_PAGE_SIZE), 1), SHARE_LINK_MAX_PAGE_SIZE);
  const page = Math.max(Math.trunc(options.page ?? 1), 1);
  const where = { AND: [shareLinkTeamWhere(session), ...shareLinkFilterWhere(options, new Date())] };
  const [total, shares] = await Promise.all([
    prisma.shareLink.count({ where }),
    prisma.shareLink.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
      select: SHARE_LINK_LIST_SELECT,
    }),
  ]);
  return { shares, total, page, pageSize };
}

export async function revokeShareLink(
  id: string,
  userId?: string,
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null,
) {
  // Team managers (share:manage) may revoke any share inside their team scope.
  // Non-managers must own the link (createdBy). shareLinkTeamWhere quarantines
  // null-team links to global managers so one tenant cannot revoke another
  // tenant's unassigned link (availability attack).
  const where: Record<string, unknown> = { id };
  if (session) {
    Object.assign(where, shareLinkTeamWhere(session));
    const canManageTeam = sessionHasPermission(session, "share:manage");
    if (!canManageTeam) {
      where.createdBy = userId ?? session.userId;
    }
  } else if (userId) {
    where.createdBy = userId;
  }
  const share = await prisma.shareLink.findFirst({ where, select: { id: true } });
  if (!share) throw new NotFoundError(t("backend.shareLink.notFoundOrUnauthorized"));
  return prisma.shareLink.update({ where: { id: share.id }, data: { revokedAt: new Date() } });
}

export async function resolveShareToken(
  token: string,
  password?: string,
  context?: { ip?: string; userAgent?: string },
  /**
   * `claimDownload: false` checks everything a download would (password,
   * expiry, the download limit) without counting or logging a download: a
   * HEAD request only asks about the file.
   */
  options?: { authorizedShareId?: string | null; claimDownload?: boolean },
) {
  const t = await serviceT();
  const share = await loadActiveShare(token);
  if (share.permissionLevel === "preview") throw new ForbiddenError(t("backend.shareLink.previewOnly"));
  const hasTicketAuthorization = options?.authorizedShareId === share.id;
  if (share.passwordHash && !hasTicketAuthorization) {
    if (!password) {
      await recordShareAccess({ shareLinkId: share.id, action: "password_attempt", ip: context?.ip, userAgent: context?.userAgent });
      throw new ValidationError(t("backend.shareLink.passwordRequired"));
    }
    if (!(await verifySharePassword(password, share.passwordHash))) {
      await recordShareAccess({ shareLinkId: share.id, action: "password_attempt", ip: context?.ip, userAgent: context?.userAgent });
      throw new ValidationError(t("backend.shareLink.passwordIncorrect"));
    }
  }
  if (options?.claimDownload === false) {
    if (share.maxDownloads != null && share.accessCount >= share.maxDownloads) throw new ValidationError(t("backend.shareLink.maxDownloadsExceeded"));
    return share;
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
 * Compensate a prior resolveShareToken quota claim when delivery fails before
 * any bytes are streamed (missing object, bad path, SSH/archive errors).
 * Decrements accessCount only when still > 0 so concurrent claims stay safe.
 */
export async function releaseShareQuotaClaim(shareLinkId: string): Promise<void> {
  try {
    await prisma.shareLink.updateMany({
      where: { id: shareLinkId, accessCount: { gt: 0 } },
      data: { accessCount: { decrement: 1 } },
    });
  } catch {
    // Best-effort: never fail the caller error path because compensation failed.
  }
}

/**
 * 只读解析分享 token，用于落地页展示，不递增访问计数。
 * 真正的下载（/api/share/[token]）才会通过 resolveShareToken 计数。
 */
export async function peekShareToken(
  token: string,
  context?: { ip?: string; userAgent?: string; password?: string; authorizedShareId?: string | null },
) {
  const t = await serviceT();
  const share = await loadActiveShare(token);

  const hasPassword = Boolean(share.passwordHash);
  if (hasPassword && context?.authorizedShareId !== share.id) {
    if (!context?.password) {
      // Password-gated links must not leak path / node / directory listings on the landing page.
      await recordShareAccess({
        shareLinkId: share.id,
        action: "view",
        ip: context?.ip,
        userAgent: context?.userAgent,
      });
      return {
        id: share.id,
        entryType: share.entryType,
        name: share.name,
        path: "",
        permissionLevel: share.permissionLevel,
        expiresAt: share.expiresAt,
        revokedAt: share.revokedAt,
        hasPassword: true as const,
        locked: true as const,
        storageNode: { id: share.storageNodeId, name: "•", driver: share.storageNode?.driver ?? "LOCAL" },
      };
    }
    if (!share.passwordHash || !(await verifySharePassword(context.password, share.passwordHash))) {
      await recordShareAccess({
        shareLinkId: share.id,
        action: "password_attempt",
        ip: context?.ip,
        userAgent: context?.userAgent,
      });
      throw new ValidationError(t("backend.shareLink.passwordIncorrect"));
    }
  }

  await recordShareAccess({ shareLinkId: share.id, action: "view", ip: context?.ip, userAgent: context?.userAgent });
  return { ...share, hasPassword, locked: false as const };
}

async function syncLocalShareDirectory(share: { storageNodeId: string; storageNode?: { basePath: string }; path: string }) {
  const basePath = share.storageNode?.basePath;
  if (!basePath) return;
  const normalizedPrefix = share.path.replace(/^\/+|\/+$/g, "");
  const resolved = resolveStoragePathWithinBase(basePath, normalizedPrefix);
  if (!resolved.ok) return;
  const absoluteDir = resolved.path;

  // Rows written after this point are newer than the listing below.
  const listingStartedAt = new Date();
  let entries: Dirent[];
  try {
    entries = await readdir(absoluteDir, { withFileTypes: true });
  } catch {
    // Directory unreadable (permission denied, missing, etc.) — nothing to
    // list, and no evidence that anything indexed is gone.
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
  await retireVanishedShareEntries(share.storageNodeId, normalizedPrefix, new Set(entries.map((entry) => entry.name)), listingStartedAt);
  if (records.length === 0) return;

  // Query and mutate in bounded chunks so a large directory cannot exceed
  // PostgreSQL parameter limits or create an unbounded Promise.all fan-out.
  type IndexedRow = { id: string; relativePath: string; isDeleted: boolean; name: string; entryType: string; mimeType: string | null; size: bigint | null };
  const existingByPath = new Map<string, IndexedRow>();
  const batchSize = 500;
  for (let i = 0; i < records.length; i += batchSize) {
    const batch = records.slice(i, i + batchSize);
    const existingRows = await prisma.fileEntry.findMany({
      where: {
        storageNodeId: share.storageNodeId,
        relativePath: { in: batch.map((r) => r.relativePath) },
      },
      select: { id: true, relativePath: true, isDeleted: true, name: true, entryType: true, mimeType: true, size: true },
    });
    for (const row of existingRows) existingByPath.set(row.relativePath, row);
  }

  const toCreate = records.filter((r) => !existingByPath.has(r.relativePath));
  // Soft delete is index-only, so a recycle-bin file is still on disk: a
  // rescan must leave it deleted (as the SFTP and WebDAV syncs do), or a new
  // share of its folder would hand it to visitors.
  // Only rows whose facts changed: every share-page view (anonymous visitors
  // included) rewrote each live row, which moved its updatedAt to the visit —
  // the file list's modified time, and the WebDAV Last-Modified and ETag that
  // sync clients compare, so they downloaded the whole folder again.
  const toUpdate = records.filter((r) => {
    const row = existingByPath.get(r.relativePath);
    return row?.isDeleted === false && (row.name !== r.name || row.entryType !== r.entryType || row.mimeType !== r.mimeType || row.size !== r.size);
  });

  for (let i = 0; i < toCreate.length; i += batchSize) {
    const batch = toCreate.slice(i, i + batchSize);
    await prisma.fileEntry.createMany({
      data: batch.map((r) => ({
        storageNodeId: share.storageNodeId,
        relativePath: r.relativePath,
        name: r.name,
        entryType: r.entryType,
        mimeType: r.mimeType,
        size: r.size ?? undefined,
      })),
      skipDuplicates: true,
    });
  }
  for (let i = 0; i < toUpdate.length; i += batchSize) {
    const batch = toUpdate.slice(i, i + batchSize);
    await Promise.all(
      batch.map((r) => {
        const row = existingByPath.get(r.relativePath)!;
        // The predicate also covers a delete that lands between read and write.
        return prisma.fileEntry.updateMany({
          where: { id: row.id, isDeleted: false },
          data: {
            name: r.name,
            entryType: r.entryType,
            mimeType: r.mimeType,
            size: r.size,
          },
        });
      }),
    );
  }
}

/**
 * Mark direct children of a listed folder that are no longer on disk as
 * deleted. The rescan only added and refreshed rows, so a file removed on
 * the node itself (or by another program) stayed downloadable on the share
 * page for good; an emptied folder skipped the sync entirely. Rows written
 * after the listing began are left alone.
 */
async function retireVanishedShareEntries(storageNodeId: string, prefix: string, namesOnDisk: Set<string>, listingStartedAt: Date) {
  const childPrefix = prefix ? `${prefix}/` : "";
  const vanished: string[] = [];
  let cursor: { id: string } | undefined;
  for (;;) {
    const rows = await prisma.fileEntry.findMany({
      where: {
        storageNodeId,
        isDeleted: false,
        updatedAt: { lt: listingStartedAt },
        ...(childPrefix ? { relativePath: { startsWith: escapeLikeLiteral(childPrefix) } } : {}),
      },
      select: { id: true, relativePath: true },
      orderBy: { id: "asc" },
      take: 1000,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    for (const row of rows) {
      const name = row.relativePath.slice(childPrefix.length);
      if (name && !name.includes("/") && !namesOnDisk.has(name)) vanished.push(row.id);
    }
    if (rows.length < 1000) break;
    cursor = { id: rows[rows.length - 1]!.id };
  }
  for (let i = 0; i < vanished.length; i += 500) {
    await prisma.fileEntry.updateMany({
      where: { id: { in: vanished.slice(i, i + 500) }, isDeleted: false, updatedAt: { lt: listingStartedAt } },
      data: { isDeleted: true },
    });
  }
}

type DirectoryShareForList = {
  entryType: string;
  path: string;
  storageNodeId: string;
  storageNode?: { basePath?: string; driver?: string } | null;
  locked?: boolean;
  hasPassword?: boolean;
};

function assertUnlockedDirectoryShare(share: DirectoryShareForList): asserts share is DirectoryShareForList & {
  locked?: false;
  storageNodeId: string;
} {
  if (share.locked || (share.hasPassword && share.path === "")) {
    throw new ForbiddenError(t("backend.shareLink.passwordRequired"));
  }
  if (!share.storageNodeId) {
    throw new ValidationError(t("backend.shareLink.invalidSharePath"));
  }
}

async function refreshShareDirectoryIndex(share: DirectoryShareForList) {
  assertUnlockedDirectoryShare(share);
  if (share.entryType !== "DIRECTORY") return;
  if (share.storageNode?.driver === "LOCAL") {
    await syncLocalShareDirectory({
      storageNodeId: share.storageNodeId,
      path: share.path,
      storageNode: share.storageNode?.basePath
        ? { basePath: share.storageNode.basePath }
        : undefined,
    });
    return;
  }
  if (share.storageNode?.driver === "WEBDAV") {
    const node = await prisma.storageNode.findUnique({
      where: { id: share.storageNodeId },
      select: { id: true, driver: true, basePath: true, webdavConfigEncrypted: true },
    });
    if (node) {
      const { syncWebDavDirectoryEntries } = await import("@/lib/storage/webdav-sync");
      const result = await syncWebDavDirectoryEntries({ node, relativePath: share.path });
      if (result.errors.length) throw new ValidationError(result.errors[0]);
    }
    return;
  }
  if (share.storageNode?.driver === "SFTP") {
    const node = await getSftpSyncNode(share.storageNodeId);
    if (node) {
      await syncSftpDirectoryEntries({ node, remotePath: share.path, recursive: false, maxDepth: 1 });
    }
  }
}

export async function listShareDirectoryFiles(share: DirectoryShareForList) {
  assertUnlockedDirectoryShare(share);
  if (share.entryType !== "DIRECTORY") return [];
  await refreshShareDirectoryIndex(share);
  const prefix = share.path.replace(/^\/+|\/+$/g, "");
  return prisma.fileEntry.findMany({
    where: {
      storageNodeId: share.storageNodeId,
      entryType: "FILE",
      isDeleted: false,
      OR: [
        { relativePath: { startsWith: escapeLikeLiteral(`${prefix}/`) } },
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
    where: { id: shareLinkId, ...shareLinkTeamWhere(session) },
    select: { id: true, createdBy: true },
  });
  if (!share) throw new NotFoundError(t("backend.shareLink.notFound"));
  const { sessionHasPermission } = await import("@/lib/auth/authorization");
  if (share.createdBy !== session.userId && !sessionHasPermission(session, "share:manage")) {
    throw new ForbiddenError(t("backend.shareLink.missingLogPermission"));
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
    shareLink: shareLinkTeamWhere(input.session),
  };
  const [logs, grouped, uniqueIpGroups] = await Promise.all([
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
      by: ["shareLinkId", "action"], where, _count: { _all: true }, orderBy: { _count: { shareLinkId: "desc" } },
    }),
    prisma.shareAccessLog.groupBy({
      by: ["ip"],
      where: { ...where, ip: { not: null } },
    }),
  ]);
  const shareIds = Array.from(new Set(grouped.map((row) => row.shareLinkId)));
  const shares = shareIds.length > 0 ? await prisma.shareLink.findMany({
    where: { id: { in: shareIds }, ...shareLinkTeamWhere(input.session) },
    select: { id: true, name: true, path: true, permissionLevel: true, revokedAt: true },
  }) : [];
  const shareMap = new Map(shares.map((share) => [share.id, share]));
  const byShareMap = new Map<string, { shareId: string; name: string; path: string; permissionLevel: string; revoked: boolean; view: number; download: number; passwordAttempt: number; total: number }>();
  const totals = { total: 0, view: 0, download: 0, passwordAttempt: 0, uniqueIps: uniqueIpGroups.length };
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
