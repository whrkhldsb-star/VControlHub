import { noRecycledAncestorSql } from "@/lib/storage/archive-access";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

/** Async scrypt: runs on the libuv pool instead of blocking the event loop (~90 ms per call). */
const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
import { shareLinkTeamWhere, storageNodeTeamWhere } from "@/lib/auth/team-scope";

import { Prisma } from "@prisma/client";
import { sameStorageRoot, storageRootSelect, type StorageRoot } from "@/lib/storage/node-root";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { SHARE_BATCH_MAX } from "@/lib/share-link/policy";
import { t } from "@/lib/i18n/service-translations";
import { createLogger } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { isStorageStagingPath, storageStagingPathRegex } from "@/lib/storage/staging-paths";
import { hasCaseInsensitiveLocalPaths, normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { syncLocalDirectoryEntries } from "@/lib/storage/local-sync";
import { syncSftpDirectoryEntries } from "@/lib/storage/sftp-sync";
import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
const logger = createLogger("share-link");

export function hashShareToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function normalizeSharePath(path: string) {
  const portable = path.replace(/\\/g, "/");
  if (/^(?:[a-z]:|\/\/)/i.test(portable)) throw new ValidationError(t("backend.shareLink.invalidSharePath"));
  const normalized = normalizeStorageRelativePath(portable.replace(/^\//, ""));
  if (!normalized.ok) throw new ValidationError(t("backend.shareLink.invalidSharePath"));
  return normalized.path;
}

/** Indexed paths already identify a particular file. Reject any rewrite of a legacy name. */
function indexedSharePath(path: string) {
  const normalized = normalizeSharePath(path);
  if (normalized !== path) throw new ValidationError(t("backend.shareLink.invalidSharePath"));
  return path;
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
      agentFileShare: { select: { rootIdentity: true } },
      server: {
        include: { sshKey: true },
      },
    },
  },
} as const;

export async function assertShareTargetNotDeleted(
  storageNodeId: string,
  relativePath: string,
  driver: string,
): Promise<void> {
  // The file itself or any folder above it may be in the trash: the bytes of a trashed folder's files stay on disk.
  const segments = typeof relativePath === "string" ? relativePath.split("/").filter(Boolean) : [];
  const path = segments.join("/");
  const caseInsensitive = hasCaseInsensitiveLocalPaths(driver);
  if (isStorageStagingPath(caseInsensitive ? path.toLowerCase() : path)) {
    throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
  }
  const paths = segments.map((_, index) => segments.slice(0, index + 1).join("/"));
  const trashed = await prisma.fileEntry.findFirst({
    where: { storageNodeId, relativePath: { in: paths.length ? paths : [relativePath], ...(caseInsensitive ? { mode: "insensitive" } : {}) }, isDeleted: true },
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

type SharePolicy = {
  expiresInHours?: number;
  maxDownloads?: number | null;
  password?: string;
  permissionLevel?: "preview" | "download";
};

/** A preview-only link has no downloads to count or to protect. */
async function assertSharePolicy(policy: SharePolicy) {
  if (policy.permissionLevel === "preview" && (policy.password || policy.maxDownloads != null)) {
    const translate = await serviceT();
    throw new ValidationError(translate("api.share.previewPolicyConflict"));
  }
}

/** The row of a new share and the token that opens it; only the token's hash is stored. */
const shareNodeSelect = { ...storageRootSelect, teamId: true, server: { select: { host: true, port: true, username: true, operatingSystem: true } }, agentFileShare: { select: { rootIdentity: true } } } as const;

function shareRoot(node: { driver: string; agentFileShare?: { rootIdentity: string | null } | null }) {
  if (node.driver !== "AGENT") return null;
  const identity = node.agentFileShare?.rootIdentity;
  if (!identity?.startsWith("v2:")) throw new ValidationError(t("backend.fileAgent.unavailable"));
  return identity;
}

function newShareRow(input: {
  createdBy: string;
  storageNodeId: string;
  /** The customer of the storage node (see createShareLink). */
  teamId: string | null;
  agentRootIdentity: string | null;
  path: string;
  entryType?: "FILE" | "DIRECTORY";
  name?: string;
  policy: SharePolicy;
  passwordHash: string | null;
}) {
  const token = randomBytes(36).toString("base64url").slice(0, 48);
  const data = {
    tokenHash: hashShareToken(token),
    storageNodeId: input.storageNodeId,
    path: input.path,
    entryType: input.entryType ?? ("FILE" as const),
    name: input.name ?? input.path.split("/").filter(Boolean).pop() ?? input.path,
    expiresAt: input.policy.expiresInHours ? new Date(Date.now() + input.policy.expiresInHours * 60 * 60 * 1000) : null,
    maxDownloads: input.policy.maxDownloads ?? null,
    passwordHash: input.passwordHash,
    permissionLevel: input.policy.permissionLevel ?? "download",
    createdBy: input.createdBy,
    teamId: input.teamId,
    agentRootIdentity: input.agentRootIdentity,
  };
  return { token, data };
}

/**
 * The row carries credential material (tokenHash locates the public token's
 * storage; passwordHash is an offline-dictionary-attack target). Strip both
 * from anything a caller might serialize — the plaintext token in the return
 * value is the only credential the creator needs.
 */
function withoutShareSecrets<Row extends { tokenHash: string; passwordHash: string | null }>(share: Row) {
  const { tokenHash: _tokenHash, passwordHash: _passwordHash, ...safeShare } = share;
  return safeShare;
}

type ShareNode = Prisma.StorageNodeGetPayload<{ select: typeof shareNodeSelect }>;

/** Hold the authorized roots until insert commits. A concurrent rebind either revokes these links or wins first. */
async function insertShareRows(rows: ReturnType<typeof newShareRow>[], bindings: Map<string, ShareNode>) {
  return prisma.$transaction(async (tx) => {
    // Server profile updates take the server lock before updating any bound node. Use the same order.
    const sftp = [...bindings.values()].filter(node => node.driver === "SFTP" && node.serverId);
    if (sftp.length) {
      const servers = await tx.$queryRaw<(NonNullable<ShareNode["server"]> & { id: string })[]>`
        SELECT id, host, port, username, "operatingSystem" FROM servers
        WHERE id IN (${Prisma.join(sftp.map(node => node.serverId!))}) ORDER BY id FOR SHARE`;
      const byId = new Map(servers.map(server => [server.id, server]));
      for (const node of sftp) {
        const server = byId.get(node.serverId!);
        const expected = node.server;
        if (!server || !expected || expected.operatingSystem !== server.operatingSystem ||
          (node.host == null && expected.host !== server.host) ||
          (node.port == null && expected.operatingSystem !== "WINDOWS" && expected.port !== server.port) ||
          (node.username == null && expected.username !== server.username)) {
          throw new NotFoundError(t("backend.shareLink.fileNotFound"));
        }
      }
    }
    const roots = await tx.$queryRaw<(StorageRoot & { id: string; teamId: string | null })[]>`
      SELECT id, "teamId", "basePath", driver::text, host, port, username, "serverId", "webdavConfigEncrypted"
      FROM "StorageNode" WHERE id IN (${Prisma.join([...bindings.keys()])}) ORDER BY id FOR SHARE`;
    if (roots.length !== bindings.size || roots.some(root => {
      const expected = bindings.get(root.id);
      return !expected || expected.teamId !== root.teamId || !sameStorageRoot(expected, root);
    })) throw new NotFoundError(t("backend.shareLink.fileNotFound"));
    return Promise.all(rows.map(({ data }) => tx.shareLink.create({ data })));
  });
}

type CreateShareInput = SharePolicy & {
  session: SessionPayload;
  storageNodeId: string;
  path: string;
  entryType?: "FILE" | "DIRECTORY";
  name?: string;
};

export async function createShareLink(input: CreateShareInput) {
  const node = await prisma.storageNode.findUnique({
    where: { id: input.storageNodeId, AND: storageNodeTeamWhere(input.session) },
    select: shareNodeSelect,
  });
  return createShareForNode(input, node);
}

async function createShareForNode(input: CreateShareInput, node: ShareNode | null) {
  await assertSharePolicy(input);
  const normalizedPath = normalizeSharePath(input.path);
  const access = await assertStorageAccess({ session: input.session, storageNodeId: input.storageNodeId, relativePath: normalizedPath, operation: "read" });
  if (!access.allowed) {
    // The reason is a code for programs ("no_access"); the share dialog showed it as the message.
    throw new ForbiddenError(storageAccessDeniedCopy(access.reason));
  }

  if (!node) throw new NotFoundError(t("backend.shareLink.fileNotFound"));

  const { token, data } = newShareRow({
    createdBy: input.session.userId,
    storageNodeId: input.storageNodeId,
    teamId: node.teamId,
    agentRootIdentity: shareRoot(node),
    path: normalizedPath,
    entryType: input.entryType,
    name: input.name,
    policy: input,
    passwordHash: input.password ? await hashSharePassword(input.password) : null,
  });
  const [share] = await insertShareRows([{ token, data }], new Map([[input.storageNodeId, node]]));
  return { share: withoutShareSecrets(share!), token };
}

/**
 * One link per file, for several files selected in the drive, in the order
 * asked. All or none: a link made before a later file was refused would be
 * live with its token known to nobody.
 */
export async function createShareLinksFromFileEntries(input: SharePolicy & {
  session: SessionPayload;
  fileEntryIds: string[];
}) {
  const translate = await serviceT();
  await assertSharePolicy(input);
  const ids = [...new Set(input.fileEntryIds)];
  if (ids.length === 0) throw new ValidationError(translate("api.share.selectFileOrPath"));
  if (ids.length > SHARE_BATCH_MAX) throw new ValidationError(translate("api.share.tooManyFiles", { max: SHARE_BATCH_MAX }));

  // As for a single file: the node filter keeps another customer's entry from being shared by its id.
  const entries = await prisma.fileEntry.findMany({
    where: { id: { in: ids }, isDeleted: false, storageNode: storageNodeTeamWhere(input.session) },
    select: { id: true, name: true, relativePath: true, entryType: true, storageNodeId: true, storageNode: { select: shareNodeSelect } },
  });
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  if (byId.size !== ids.length) throw new NotFoundError(translate("backend.shareLink.fileNotFound"));

  const targets = ids.map((id) => {
    const entry = byId.get(id)!;
    return { entry, path: indexedSharePath(entry.relativePath) };
  });
  for (const target of targets) {
    const access = await assertStorageAccess({ session: input.session, storageNodeId: target.entry.storageNodeId, relativePath: target.path, operation: "read" });
    if (!access.allowed) throw new ForbiddenError(storageAccessDeniedCopy(access.reason));
  }

  // One password for the batch: one derivation (about 90 ms each).
  const passwordHash = input.password ? await hashSharePassword(input.password) : null;
  const rows = targets.map(({ entry, path }) => newShareRow({
    createdBy: input.session.userId,
    storageNodeId: entry.storageNodeId,
    teamId: entry.storageNode.teamId,
    agentRootIdentity: shareRoot(entry.storageNode),
    path,
    entryType: entry.entryType === "DIRECTORY" ? "DIRECTORY" : "FILE",
    name: entry.name,
    policy: input,
    passwordHash,
  }));
  const shares = await insertShareRows(rows, new Map(entries.map((entry) => [entry.storageNodeId, entry.storageNode])));
  return shares.map((share, index) => ({ fileEntryId: ids[index]!, share: withoutShareSecrets(share), token: rows[index]!.token }));
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
    include: { storageNode: { select: shareNodeSelect } },
  });
  if (!entry) throw new NotFoundError(t("backend.shareLink.fileNotFound"));

  return createShareForNode({
    session: input.session,
    storageNodeId: entry.storageNodeId,
    path: indexedSharePath(entry.relativePath),
    entryType: entry.entryType === "DIRECTORY" ? "DIRECTORY" : "FILE",
    name: input.name ?? entry.name,
    expiresInHours: input.expiresInHours,
    maxDownloads: input.maxDownloads,
    password: input.password,
    permissionLevel: input.permissionLevel,
  }, entry.storageNode);
}

async function loadActiveShare(token: string) {
  const t = await serviceT();
  // Prisma may fetch the included node in a second statement. It must be the same snapshot as revokedAt.
  const share = await prisma.$transaction(tx => tx.shareLink.findUnique({
    where: { tokenHash: hashShareToken(token) }, include: SHARE_STORAGE_NODE_INCLUDE,
  }), { isolationLevel: "RepeatableRead" });
  if (!share || share.revokedAt || share.teamId !== share.storageNode?.teamId ||
      (share.agentRootIdentity ?? null) !== shareRoot(share.storageNode)) throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
  if (share.expiresAt && share.expiresAt.getTime() < Date.now()) throw new ValidationError(t("backend.shareLink.expired"));
  // A deleted customer is hidden with its data until restored: its public
  // links stop serving its files rather than outlive it.
  const teamIds = [share.teamId, share.storageNode?.teamId].filter((id): id is string => Boolean(id));
  if (teamIds.length > 0 && (await prisma.team.count({ where: { id: { in: teamIds }, deletedAt: { not: null } } })) > 0) {
    throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
  }
  await assertShareTargetNotDeleted(share.storageNodeId, share.path, share.storageNode.driver);
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
  return prisma.shareLink.update({ where: { id: share.id }, data: { revokedAt: new Date() }, select: { id: true, revokedAt: true } });
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
  // A claim may wait behind a revocation or another download. Evaluate the database clock and
  // remaining allowance on the locked row, including when the link expires during that wait.
  const claimed = await prisma.$executeRaw(Prisma.sql`
    WITH candidate AS MATERIALIZED (
      SELECT id, "revokedAt", "expiresAt", "maxDownloads", "accessCount"
      FROM share_links WHERE id = ${share.id} FOR UPDATE
    )
    UPDATE share_links AS s SET "accessCount" = c."accessCount" + 1, "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC')
    FROM candidate c WHERE s.id = c.id AND c."revokedAt" IS NULL
      AND (c."expiresAt" IS NULL OR c."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC'))
      AND (c."maxDownloads" IS NULL OR c."accessCount" < c."maxDownloads")
  `);
  if (claimed === 0) {
    if (share.maxDownloads != null) throw new ValidationError(t("backend.shareLink.maxDownloadsExceeded"));
    throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
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

type DirectoryShareForList = {
  id?: string;
  entryType: string;
  path: string;
  storageNodeId: string;
  agentRootIdentity?: string | null;
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
    // The file manager's own directory sync, so a LOCAL folder's index has one writer. The rescan kept here gave a
    // file of unknown type "application/octet-stream" where that sync stores none: a view of the share page and
    // one of the file manager each rewrote the row, moving its modified time (WebDAV Last-Modified and ETag)
    // with nothing changed. It also read every row below the folder on each visit to find the folder's own
    // children. A folder that cannot be read leaves the index as it is.
    if (share.storageNode.basePath) {
      await syncLocalDirectoryEntries({
        node: { id: share.storageNodeId, driver: "LOCAL", basePath: share.storageNode.basePath },
        relativePath: share.path,
      });
    }
    return;
  }
  if (!["WEBDAV", "AGENT", "SFTP"].includes(share.storageNode?.driver ?? "")) return;
  const node = await prisma.storageNode.findUnique({
    where: { id: share.storageNodeId, ...activeDirectoryShare(share) },
    include: SHARE_STORAGE_NODE_INCLUDE.storageNode.include,
  });
  if (!node) throw new NotFoundError(t("backend.shareLink.notFoundOrRevoked"));
  if (node.driver === "SFTP") {
    await syncSftpDirectoryEntries({ node, remotePath: share.path, recursive: false, maxDepth: 1 });
  } else if (node.driver === "WEBDAV" || node.driver === "AGENT") {
    const { syncWebDavDirectoryEntries } = await import("@/lib/storage/webdav-sync");
    const result = await syncWebDavDirectoryEntries({ node: { ...node, expectedRoot: share.agentRootIdentity ?? undefined }, relativePath: share.path });
    if (result.errors.length) throw new ValidationError(result.errors[0]);
  }
}

function activeDirectoryShare(share: DirectoryShareForList) {
  return {
    ...(share.id ? { shareLinks: { some: { id: share.id, revokedAt: null } } } : {}),
    ...(share.agentRootIdentity ? { agentFileShare: { rootIdentity: share.agentRootIdentity } } : {}),
  };
}

export async function listShareDirectoryFiles(share: DirectoryShareForList) {
  assertUnlockedDirectoryShare(share);
  if (share.entryType !== "DIRECTORY") return [];
  await refreshShareDirectoryIndex(share);
  const prefix = share.path.replace(/^\/+|\/+$/g, "");
  // Filter before the landing page limit. Legacy active children of a recycled directory stay hidden.
  return prisma.$queryRaw<Array<{ id: string; name: string; relativePath: string; size: bigint | null; mimeType: string | null; updatedAt: Date }>>(Prisma.sql`
    SELECT e.id, e.name, e."relativePath", e.size, e."mimeType", e."updatedAt" FROM file_entries e
    WHERE e."storageNodeId" = ${share.storageNodeId} AND e."entryType" = 'FILE' AND NOT e."isDeleted"
      AND (e."relativePath" = ${prefix} OR starts_with(e."relativePath", ${prefix + "/"}))
      AND ${noRecycledAncestorSql} AND e."relativePath" !~ ${storageStagingPathRegex}
      ${share.id ? Prisma.sql`AND EXISTS (SELECT 1 FROM share_links s WHERE s.id = ${share.id}
        AND s."storageNodeId" = e."storageNodeId" AND s."revokedAt" IS NULL
        AND (s."expiresAt" IS NULL OR s."expiresAt" > (clock_timestamp() AT TIME ZONE 'UTC')))` : Prisma.empty}
      ${share.agentRootIdentity ? Prisma.sql`AND EXISTS (SELECT 1 FROM agent_file_shares a
        WHERE a."storageNodeId" = e."storageNodeId" AND a."rootIdentity" = ${share.agentRootIdentity})` : Prisma.empty}
    ORDER BY e."relativePath" LIMIT ${SHARE_DIRECTORY_LIST_LIMIT + 1}
  `);
}

/** Files a directory share lists; the page shows a notice beyond this many. */
export const SHARE_DIRECTORY_LIST_LIMIT = 1000;

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
