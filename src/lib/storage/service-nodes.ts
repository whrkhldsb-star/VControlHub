import { constants as fsConstants } from "node:fs";
import { createRemoteStorageClient } from "./agent-file-client";
import { access, stat } from "node:fs/promises";

import type { SessionPayload } from "@/lib/auth/session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import type { Prisma } from "@prisma/client";
import { isUniqueViolation, prisma } from "@/lib/db";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { normalizePublicBaseUrl } from "@/lib/storage/direct-access-url";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { purgeStorageNodeVersionBlobs } from "@/lib/storage/file-versions";
import { resolveStorageSshCredentials, resolveStorageSshPort } from "@/lib/storage/ssh-credentials";
import { expandStorageBasePath, localBasePathBelongsToTenant } from "@/lib/storage/path-utils";
import { sameStorageRoot, type StorageRoot } from "./node-root";
import { decrypt, encrypt } from "@/lib/crypto/service";

import {
  completeWebdavConfigSchema,
  webdavConfigSchema,
  createStorageNodeSchema,
  updateStorageNodeSchema,
  type CreateStorageNodeInput,
  type UpdateStorageNodeInput,
} from "./schema";
import { t } from "@/lib/i18n/service-translations";
import {
  buildDirectAccessStrategy,
  buildStorageConnectionSummary,
  type StorageNodeListRow,
} from "./service-direct-access";
import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";

function readWebdavConfig(ciphertext?: string | null) {
  if (!ciphertext) return undefined;
  try { return webdavConfigSchema.parse(JSON.parse(decrypt(ciphertext))); }
  catch { throw new ValidationError(t("backend.webdav.configurationInvalid")); }
}

function publicWebdavConfig(ciphertext?: string | null) {
  // A damaged legacy configuration must not break the entire node list.
  try {
    const config = readWebdavConfig(ciphertext);
    return config ? { url: config.url, authType: config.authType, username: config.username,
      hasPassword: Boolean(config.password), hasToken: Boolean(config.token) } : null;
  } catch { return null; }
}

function safeNodeDto<T extends { webdavConfigEncrypted?: string | null }>(node: T) {
  const { webdavConfigEncrypted, ...safe } = node;
  // Do not expose legacy password fields either, including rows read during rolling upgrades.
  Reflect.deleteProperty(safe, "password");
  Reflect.deleteProperty(safe, "webdavConfig");
  return { ...safe, webdavConfig: publicWebdavConfig(webdavConfigEncrypted) };
}

function encryptWebdavConfig(input: NonNullable<UpdateStorageNodeInput["webdavConfig"]>, ciphertext?: string | null) {
  const previous = ciphertext ? readWebdavConfig(ciphertext) : undefined;
  // Never forward stored secrets to a new endpoint/account without explicit replacement.
  const sameIdentity = previous?.url === input.url && previous?.authType === input.authType
    && (input.authType !== "basic" || previous.username === input.username);
  const config = completeWebdavConfigSchema.parse(input.authType === "basic"
    ? { url: input.url, authType: input.authType, username: input.username,
        password: input.password || (sameIdentity ? previous?.password : undefined) }
    : { url: input.url, authType: input.authType,
        token: input.token || (sameIdentity ? previous?.token : undefined) });
  if (ciphertext && previous && JSON.stringify(config) === JSON.stringify(previous)) return ciphertext;
  return encrypt(JSON.stringify(config));
}

export type StorageNodeHealthStatus = "UNKNOWN" | "HEALTHY" | "UNHEALTHY";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

const STORAGE_NODE_SERVER_INCLUDE = {
  agentFileShare: { select: { serverId: true, seenAt: true, writable: true } },
  server: {
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      operatingSystem: true,
      username: true,
    },
  },
} as const;

function sanitizeHealthError(error: unknown) {
  const rawMessage =
    error instanceof Error ? error.message : String(error || "Health check failed");
  return rawMessage
    .replace(/-----BEGIN[\s\S]*?-----END[^\n]+-----/g, "[REDACTED]")
    .replace(/SECRET/gi, "[REDACTED]")
    .slice(0, 500);
}

function serializeHealthFields(node: {
  healthStatus?: string | null;
  lastHealthCheckAt?: Date | string | null;
  lastHealthError?: string | null;
  lastHealthLatencyMs?: number | null;
}) {
  return {
    healthStatus: (node.healthStatus ?? "UNKNOWN") as StorageNodeHealthStatus,
    lastHealthCheckAt: node.lastHealthCheckAt
      ? typeof node.lastHealthCheckAt === "string"
        ? node.lastHealthCheckAt
        : node.lastHealthCheckAt.toISOString()
      : null,
    lastHealthError: node.lastHealthError ?? null,
    lastHealthLatencyMs: node.lastHealthLatencyMs ?? null,
  };
}

async function lockStorageServer(tx: Prisma.TransactionClient, serverId: string, teamId: string | null) {
  const matches = await tx.$queryRaw<{ id: string; operatingSystem: string }[]>`
    SELECT id, "operatingSystem" FROM servers WHERE id = ${serverId} AND "teamId" IS NOT DISTINCT FROM ${teamId} FOR SHARE`;
  if (!matches.length) throw new ValidationError(t("backend.storage.serverOwnerMismatch"));
  return matches[0]!;
}

async function assertServerInTeamScope(
  serverId: string | null | undefined,
  session?: TeamSession | null,
) {
  if (!serverId || !session) return;
  const server = await prisma.server.findFirst({
    where: { id: serverId, ...serverTeamWhere(session, "connect") },
    select: { id: true },
  });
  if (!server) {
    const t = await serviceT();
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }
}

export async function ensureDefaultNodeState(
  isDefault?: boolean,
  teamId?: string | null,
  excludeId?: string,
  db: Pick<Prisma.TransactionClient, "storageNode"> = prisma,
) {
  if (isDefault) {
    await db.storageNode.updateMany({
      where: {
        teamId: teamId ?? null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      data: { isDefault: false },
    });
  }
}

/**
 * What resolveStorageSshCredentials needs, as file operations load it
 * (sftp-node.ts): without the id, management mode and OS an Agent node was
 * probed as if it lacked an SSH key and a Windows node on its RDP port.
 */
const HEALTH_PROBE_SERVER_SELECT = {
  id: true,
  teamId: true,
  host: true,
  port: true,
  username: true,
  connectionType: true,
  managementMode: true,
  operatingSystem: true,
  password: true,
  sshKeyId: true,
  hostKeySha256: true,
  sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
} as const;

export async function checkStorageNodeHealth(
  storageNodeId: string,
  session?: TeamSession | null,
) {
  const node = session
    ? await prisma.storageNode.findFirst({
        where: { id: storageNodeId, ...teamWhere(session) },
        include: {
          server: { select: HEALTH_PROBE_SERVER_SELECT },
        },
      })
    : await prisma.storageNode.findUnique({
        where: { id: storageNodeId },
        include: {
          server: { select: HEALTH_PROBE_SERVER_SELECT },
        },
      });

  const t = await serviceT();
  if (!node) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }

  const startedAt = Date.now();
  let healthStatus: StorageNodeHealthStatus = "HEALTHY";
  let lastHealthError: string | null = null;
  let transport: "Agent" | "SFTP" | null = null;

  try {
    if (node.driver === "LOCAL") {
      const expandedBasePath = expandStorageBasePath(node.basePath);
      const baseStat = await stat(expandedBasePath);
      if (!baseStat.isDirectory()) {
        throw new BusinessError(t("backend.storage.localRootNotDir"));
      }
      await access(expandedBasePath, fsConstants.R_OK | fsConstants.W_OK);
    } else if (node.driver === "SFTP") {
      const credentials = resolveStorageSshCredentials(node);
      transport = credentials.agentServerId && !credentials.password && !credentials.privateKey ? "Agent" : "SFTP";
      await listRemoteDirectory({
        ...credentials,
        remotePath: normalizeRemotePath(node.basePath, ""),
      });
    } else if (node.driver === "WEBDAV" || node.driver === "AGENT") {
      if (node.driver === "AGENT") transport = "Agent";
      // A probe of the root: reachable, authenticated, and a collection (A4-15).
      const root = await createRemoteStorageClient(node as Parameters<typeof createRemoteStorageClient>[0]).stat("");
      if (!root?.isDirectory) throw new BusinessError(t("backend.storage.webdavRootMissing"));
    } else {
      healthStatus = "UNKNOWN";
      lastHealthError = null;
    }
  } catch (error) {
    healthStatus = "UNHEALTHY";
    lastHealthError = sanitizeHealthError(error);
  }

  const lastHealthLatencyMs = Math.max(0, Date.now() - startedAt);
  const healthData = {
    healthStatus,
    lastHealthCheckAt: new Date(),
    ...(healthStatus === "HEALTHY" ? { lastHealthyAt: new Date(startedAt), lastHealthyTransport: transport?.toUpperCase() ?? node.driver } : {}),
    lastHealthError,
    lastHealthLatencyMs,
  };
  const claimed = await prisma.storageNode.updateMany({
    where: { id: storageNodeId, updatedAt: node.updatedAt, ...(session ? teamWhere(session) : {}) },
    data: healthData,
  });
  if (claimed.count === 0) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }
  const updated = await prisma.storageNode.findFirst({
    where: { id: storageNodeId, ...(session ? teamWhere(session) : {}) },
  });
  if (!updated) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }

  return {
    id: updated.id,
    transport,
    ...serializeHealthFields(updated),
  };
}

export async function createStorageNode(
  input: CreateStorageNodeInput,
  session?: TeamSession | null,
) {
  const payload = createStorageNodeSchema.parse(input);

  if (session && !isGlobalTeamManager(session) && payload.driver === "LOCAL" &&
      (!session.currentTeamId || !localBasePathBelongsToTenant(payload.basePath, session.currentTeamId))) {
    throw new ValidationError(t("backend.storage.localPathOutsideCustomer"));
  }

  if (payload.driver === "SFTP" && !payload.serverId && !payload.host) {
    throw new ValidationError(t("backend.storage.sftpNeedsHost"));
  }

  await assertServerInTeamScope(payload.serverId, session);
  if (payload.serverId && payload.driver !== "AGENT") {
    const existingServerNode = await prisma.storageNode.findUnique({
      where: { serverId: payload.serverId },
      select: { id: true },
    });
    if (existingServerNode) {
      throw new ValidationError(t("backend.storage.serverAlreadyHasStorageNode"));
    }
  }
  const teamData = session ? teamCreateData(session) : {};

  let storageNode;
  try {
    // Create the replacement first so a failed create can never leave the team
    // without a default node; the old default is retired in the same
    // transaction. The lock makes "make me the default" one step per
    // customer: two concurrent default creates each cleared the other and
    // the customer was left with no default at all.
    storageNode = await prisma.$transaction(async (tx) => {
      if (payload.isDefault) await lockForTransaction(tx, "storage-node-default", teamData.teamId ?? "platform");
      if (payload.serverId) await lockStorageServer(tx, payload.serverId, teamData.teamId ?? null);
      if (payload.driver === "AGENT" && !await tx.server.findFirst({
        where: { id: payload.serverId, teamId: teamData.teamId ?? null, managementMode: "AGENT", enabled: true },
        select: { id: true },
      })) throw new ValidationError(t("backend.fileAgent.binding"));
      const created = await tx.storageNode.create({
        data: {
          name: payload.name,
          driver: payload.driver,
          basePath: payload.basePath,
          isDefault: payload.isDefault,
          host: payload.driver === "SFTP" ? payload.host : null,
          port: payload.driver === "SFTP" ? payload.port : null,
          username: payload.driver === "SFTP" ? payload.username : null,
          webdavConfigEncrypted: payload.driver === "WEBDAV" && payload.webdavConfig
            ? encryptWebdavConfig(payload.webdavConfig) : null,
          serverId: payload.driver === "AGENT" ? null : payload.serverId,
          directAccessMode: payload.directAccessMode,
          publicBaseUrl: normalizePublicBaseUrl(payload.publicBaseUrl),
          directAccessExpiresSeconds: payload.directAccessExpiresSeconds,
          ...teamData,
        },
        include: STORAGE_NODE_SERVER_INCLUDE,
      });
      if (payload.driver === "AGENT") {
        await tx.agentFileShare.create({ data: { storageNodeId: created.id, serverId: payload.serverId!, teamId: created.teamId } });
      }
      await ensureDefaultNodeState(payload.isDefault, created.teamId, created.id, tx);
      return created;
    });
  } catch (error) {
    if (payload.serverId && isUniqueViolation(error)) {
      throw new ValidationError(t("backend.storage.serverAlreadyHasStorageNode"));
    }
    throw error;
  }

  return {
    ...safeNodeDto(storageNode),
    connectionSummary: buildStorageConnectionSummary({
      driver: storageNode.driver,
      basePath: storageNode.basePath,
      host: storageNode.host ?? storageNode.server?.host,
      port: resolveStorageSshPort(storageNode),
      username: storageNode.username ?? storageNode.server?.username,
      serverName: storageNode.server?.name,
    }),
    directAccess: buildDirectAccessStrategy({
      driver: storageNode.driver,
      nodeId: storageNode.id,
      host: storageNode.host ?? storageNode.server?.host,
      port: resolveStorageSshPort(storageNode),
      directAccessMode: storageNode.directAccessMode,
      publicBaseUrl: storageNode.publicBaseUrl,
      directAccessExpiresSeconds: storageNode.directAccessExpiresSeconds,
    }),
  };
}

export async function updateStorageNode(
  input: UpdateStorageNodeInput,
  session?: TeamSession | null,
) {
  const payload = updateStorageNodeSchema.parse(input);
  const current = session
    ? await prisma.storageNode.findFirst({
        where: { id: payload.storageNodeId, ...teamWhere(session) },
        include: STORAGE_NODE_SERVER_INCLUDE,
      })
    : await prisma.storageNode.findUnique({
        where: { id: payload.storageNodeId },
        include: STORAGE_NODE_SERVER_INCLUDE,
      });

  const t = await serviceT();
  if (!current) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }

  const nextDriver = payload.driver ?? current.driver;
  const driverChanged = nextDriver !== current.driver;
  if ((driverChanged && (current.driver === "AGENT" || nextDriver === "AGENT"))
      || (nextDriver === "AGENT" && ((payload.basePath && payload.basePath !== "/") || payload.serverId && current.agentFileShare && payload.serverId !== current.agentFileShare.serverId))) {
    throw new ValidationError(t("backend.fileAgent.separateDrive"));
  }
  // Apply driver-specific constraints even when PATCH omitted the driver.
  updateStorageNodeSchema.parse({ ...payload, driver: nextDriver });
  const webdavConfigEncrypted = nextDriver === "WEBDAV"
    ? payload.webdavConfig
      ? encryptWebdavConfig(payload.webdavConfig, driverChanged ? null : current.webdavConfigEncrypted)
      : driverChanged || !current.webdavConfigEncrypted
        ? (() => { throw new ValidationError(t("backend.webdav.configurationRequired")); })()
        : current.webdavConfigEncrypted
    : null;
  if (current.isDefault && payload.isDefault === false) {
    throw new BusinessError(t("backend.storage.defaultMustBeReplacedFirst"));
  }
  if (current.isDefault && nextDriver !== current.driver) {
    throw new BusinessError(t("backend.storage.defaultDriverLocked"));
  }
  const nextServerId =
    payload.serverId === undefined
      ? (driverChanged ? undefined : current.serverId ?? undefined)
      : (payload.serverId ?? undefined);
  const nextHost =
    payload.host === undefined
      ? (driverChanged ? undefined : current.host ?? undefined)
      : (payload.host ?? undefined);
  const nextPort = payload.port === undefined ? (driverChanged ? null : current.port) : payload.port;
  const nextUsername =
    payload.username === undefined ? (driverChanged ? null : current.username) : payload.username;

  if (nextDriver === "SFTP" && !nextServerId && !nextHost) {
    throw new ValidationError(t("backend.storage.sftpNeedsHost"));
  }
  if (session && !isGlobalTeamManager(session) && nextDriver === "LOCAL" &&
      (driverChanged || (payload.basePath !== undefined && payload.basePath !== current.basePath)) &&
      (!session.currentTeamId || !localBasePathBelongsToTenant(payload.basePath ?? current.basePath, session.currentTeamId))) {
    throw new ValidationError(t("backend.storage.localPathOutsideCustomer"));
  }
  const nextAccessMode = nextDriver === "WEBDAV" ? "PROXY" : payload.directAccessMode ?? (driverChanged ? "PROXY" : current.directAccessMode);
  const nextPublicBaseUrl = nextDriver === "WEBDAV" || driverChanged ? null : payload.publicBaseUrl === undefined
    ? current.publicBaseUrl : normalizePublicBaseUrl(payload.publicBaseUrl);
  if (nextAccessMode !== "PROXY" && !nextPublicBaseUrl) {
    throw new ValidationError(t("backend.storage.urlRequired"));
  }

  if (payload.serverId) {
    await assertServerInTeamScope(payload.serverId, session);
  }

  const nextRoot: StorageRoot = {
    driver: nextDriver,
    basePath: payload.basePath ?? current.basePath,
    host: nextDriver === "SFTP" ? nextHost ?? null : null,
    port: nextDriver === "SFTP" ? nextPort : null,
    username: nextDriver === "SFTP" ? nextUsername : null,
    webdavConfigEncrypted,
    serverId: nextDriver === "WEBDAV" || nextDriver === "AGENT" ? null : nextServerId ?? null,
  };
  const rootChanged = !sameStorageRoot(current, nextRoot) ||
    (nextDriver === "AGENT" && !current.agentFileShare && Boolean(payload.serverId));

  // Promote, then retire the previous default, in one transaction under the
  // customer's default lock (see createStorageNode).
  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      if (payload.isDefault) await lockForTransaction(tx, "storage-node-default", current.teamId ?? "platform");
      if (rootChanged) await lockForTransaction(tx, "storage-editable", current.id + ":");
      const nextServer = nextServerId && nextDriver === "SFTP" ? await lockStorageServer(tx, nextServerId, current.teamId) : null;
      const resetGateway = rootChanged && (current.server?.operatingSystem === "WINDOWS" || nextServer?.operatingSystem === "WINDOWS");
      const claimed = await tx.storageNode.updateMany({
        where: { ...(session ? teamWhere(session) : {}), id: payload.storageNodeId, teamId: current.teamId,
          basePath: current.basePath, driver: current.driver, host: current.host, port: current.port,
          username: current.username, serverId: current.serverId, webdavConfigEncrypted: current.webdavConfigEncrypted,
          ...(driverChanged || payload.isDefault === false ? { isDefault: false } : {}) },
        data: {
          name: payload.name ?? current.name,
          ...nextRoot,
          ...(payload.isDefault ? { isDefault: true } : {}),
          directAccessMode: resetGateway ? "PROXY" : nextAccessMode,
          publicBaseUrl: resetGateway ? null : nextPublicBaseUrl,
          directAccessExpiresSeconds:
            payload.directAccessExpiresSeconds ??
            current.directAccessExpiresSeconds,
        },
      });
      if (claimed.count === 0) {
        throw new NotFoundError(t("backend.storage.nodeNotFound"));
      }
      if (rootChanged) {
        // Tombstones from older releases have no binding. A later driver must never operate on their bytes.
        await tx.fileEntry.updateMany({ where: { storageNodeId: current.id, isDeleted: true, deletedAgentRoot: null },
          data: { deletedAgentRoot: "retired-root" } });
      }
      if (nextDriver === "AGENT" && !current.agentFileShare && payload.serverId) {
        const server = await tx.server.findFirst({
          where: { id: payload.serverId, teamId: current.teamId, enabled: true, managementMode: "AGENT" },
          select: { id: true },
        });
        if (!server) throw new ValidationError(t("backend.fileAgent.binding"));
        await tx.agentFileShare.create({ data: { storageNodeId: current.id, serverId: server.id, teamId: current.teamId } });
      }
      const row = await tx.storageNode.findFirst({
        where: { id: payload.storageNodeId, ...(session ? teamWhere(session) : {}) },
        include: {
          ...STORAGE_NODE_SERVER_INCLUDE,
          _count: rootChanged && { select: { shareLinks: { where: { revokedAt: null } } } },
        },
      });
      if (!row) {
        throw new NotFoundError(t("backend.storage.nodeNotFound"));
      }
      const { _count, ...node } = row;
      if (rootChanged && _count.shareLinks > 0) {
        await tx.shareLink.updateMany({ where: { storageNodeId: node.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      await ensureDefaultNodeState(payload.isDefault, row.teamId, payload.storageNodeId, tx);
      return node;
    });
  } catch (error) {
    // A server carries one storage node: binding it to a second one is the
    // administrator's mistake, said as such (as on create), not a 500.
    if (nextServerId && isUniqueViolation(error)) {
      throw new ValidationError(t("backend.storage.serverAlreadyHasStorageNode"));
    }
    throw error;
  }
  return safeNodeDto(updated);
}

export async function deleteStorageNode(
  storageNodeId: string,
  session?: TeamSession | null,
) {
  const t = await serviceT();
  await prisma.$transaction(async (tx) => {
    // FileEntry inserts take a foreign-key lock on this row. A concurrent
    // upload or default promotion must either finish before this check or
    // observe the completed deletion.
    await tx.$queryRaw`SELECT id FROM "StorageNode" WHERE id = ${storageNodeId} FOR UPDATE`;
    const node = await tx.storageNode.findFirst({
      where: { id: storageNodeId, ...(session ? teamWhere(session) : {}) },
      select: { id: true, isDefault: true },
    });
    if (!node) throw new NotFoundError(t("backend.storage.nodeNotFound"));
    if (node.isDefault) throw new BusinessError(t("backend.storage.defaultCannotDelete"));
    const activeCount = await tx.fileEntry.count({ where: { storageNodeId, isDeleted: false } });
    if (activeCount > 0) throw new BusinessError(t("backend.storage.nodeHasEntries"));

    // Restoring an existing recycled row need not re-check its foreign key.
    // Claim those rows before the final check, so a restore that won that row
    // lock becomes visible and rolls the entire delete back.
    await tx.fileEntry.deleteMany({ where: { storageNodeId, isDeleted: true } });
    await tx.mediaItem.deleteMany({ where: { storageNodeId } });
    const deleted = await tx.storageNode.deleteMany({
      where: { id: storageNodeId, isDefault: false, fileEntries: { none: { isDeleted: false } } },
    });
    if (!deleted.count) throw new BusinessError(t("backend.storage.nodeHasEntries"));
  });
  await purgeStorageNodeVersionBlobs(storageNodeId).catch(() => undefined);
  return { deleted: true };
}

export async function listStorageNodes(session: TeamSession, operation: "read" | "write" = "read") {
  const manage = isGlobalTeamManager(session) || sessionHasPermission(session, "storage:manage-node");
  if (!manage && !sessionHasPermission(session, operation === "read" ? "storage:read" : "storage:write")) return [];
  const grant = { userId: session.userId };
  const capability = operation === "read" ? "canRead" : "canWrite";
  // P2: take=500 上界。storage node 数量本质有限（每存储设备 1 行），上界即异常告警。
  const nodes = await prisma.storageNode.findMany({
    where: {
      ...teamWhere(session),
      ...(manage ? {} : { OR: [
        { accessGrants: { none: grant } },
        { accessGrants: { some: { ...grant, [capability]: true } } },
      ] }),
    },
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      ...STORAGE_NODE_SERVER_INCLUDE,
      _count: { select: { fileEntries: { where: { isDeleted: false } } } },
      team: { select: { name: true } },
    },
  });
  // Administrators may list every customer's nodes; name the owner for them.
  const showCustomer = session ? isGlobalTeamManager(session) : false;

  return nodes.map((node: StorageNodeListRow & { team: { name: string } | null }) => ({
    id: node.id,
    name: node.name,
    teamName: showCustomer ? node.team?.name ?? null : null,
    driver: node.driver,
    isDefault: node.isDefault,
    basePath: node.basePath,
    host: node.host,
    port: node.port,
    username: node.username,
    webdavConfig: publicWebdavConfig(node.webdavConfigEncrypted),
    serverId: node.agentFileShare?.serverId ?? node.serverId,
    fileAgent: node.agentFileShare?.seenAt
      ? { seenAt: node.agentFileShare.seenAt.toISOString(), writable: node.agentFileShare.writable } : null,
    directAccessMode: node.directAccessMode,
    publicBaseUrl: node.publicBaseUrl,
    directAccessExpiresSeconds: node.directAccessExpiresSeconds,
    createdAt: node.createdAt?.toISOString?.() ?? node.createdAt,
    updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
    ...serializeHealthFields(node),
    server: node.server,
    fileCount: node._count.fileEntries,
    connectionSummary: buildStorageConnectionSummary({
      driver: node.driver,
      basePath: node.basePath,
      host: node.host ?? node.server?.host,
      port: resolveStorageSshPort(node),
      username: node.username ?? node.server?.username,
      serverName: node.server?.name,
    }),
    directAccess: buildDirectAccessStrategy({
      driver: node.driver,
      nodeId: node.id,
      host: node.host ?? node.server?.host,
      port: resolveStorageSshPort(node),
      directAccessMode: node.directAccessMode,
      publicBaseUrl: node.publicBaseUrl,
      directAccessExpiresSeconds: node.directAccessExpiresSeconds,
    }),
  }));
}
