import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";

import type { SessionPayload } from "@/lib/auth/session";
import { serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { isUniqueViolation, prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { normalizePublicBaseUrl } from "@/lib/storage/direct-access-url";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { expandStorageBasePath } from "@/lib/storage/path-utils";
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
  return encrypt(JSON.stringify(config));
}

export type StorageNodeHealthStatus = "UNKNOWN" | "HEALTHY" | "UNHEALTHY";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

const STORAGE_NODE_SERVER_INCLUDE = {
  server: {
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
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

function teamScopeWhere(session?: TeamSession | null): Record<string, unknown> {
  return session ? teamWhere(session) : {};
}

async function assertServerInTeamScope(
  serverId: string | null | undefined,
  session?: TeamSession | null,
) {
  if (!serverId || !session) return;
  const server = await prisma.server.findFirst({
    where: { id: serverId, ...serverTeamWhere(session) },
    select: { id: true },
  });
  if (!server) {
    const t = await serviceT();
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }
}

export async function ensureDefaultNodeState(
  isDefault?: boolean,
  session?: TeamSession | null,
  excludeId?: string,
) {
  if (isDefault) {
    await prisma.storageNode.updateMany({
      where: {
        ...teamScopeWhere(session),
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
      data: { isDefault: false },
    });
  }
}

export async function checkStorageNodeHealth(
  storageNodeId: string,
  session?: TeamSession | null,
) {
  const node = session
    ? await prisma.storageNode.findFirst({
        where: { id: storageNodeId, ...teamWhere(session) },
        include: {
          server: {
            select: {
              host: true,
              port: true,
              username: true,
              password: true,
              sshKeyId: true,
              hostKeySha256: true,
              sshKey: { select: { privateKey: true } },
            },
          },
        },
      })
    : await prisma.storageNode.findUnique({
        where: { id: storageNodeId },
        include: {
          server: {
            select: {
              host: true,
              port: true,
              username: true,
              password: true,
              sshKeyId: true,
              hostKeySha256: true,
              sshKey: { select: { privateKey: true } },
            },
          },
        },
      });

  const t = await serviceT();
  if (!node) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }

  const startedAt = Date.now();
  let healthStatus: StorageNodeHealthStatus = "HEALTHY";
  let lastHealthError: string | null = null;

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

      await listRemoteDirectory({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        hostKeySha256: credentials.hostKeySha256,
        agentServerId: credentials.agentServerId,
        privateKey: credentials.privateKey,
        password: credentials.password,
        remotePath: normalizeRemotePath(node.basePath, ""),
      });
    } else {
      healthStatus = "UNKNOWN";
      lastHealthError = "WebDAV health probe is not available yet";
    }
  } catch (error) {
    healthStatus = "UNHEALTHY";
    lastHealthError = sanitizeHealthError(error);
  }

  const lastHealthLatencyMs = Math.max(0, Date.now() - startedAt);
  const healthData = {
    healthStatus,
    lastHealthCheckAt: new Date(),
    lastHealthError,
    lastHealthLatencyMs,
  };
  const claimed = await prisma.storageNode.updateMany({
    where: { id: storageNodeId, ...(session ? teamWhere(session) : {}) },
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
    ...serializeHealthFields(updated),
  };
}

export async function createStorageNode(
  input: CreateStorageNodeInput,
  session?: TeamSession | null,
) {
  const payload = createStorageNodeSchema.parse(input);

  if (payload.driver === "SFTP" && !payload.serverId && !payload.host) {
    throw new ValidationError(t("backend.storage.sftpNeedsHost"));
  }

  await assertServerInTeamScope(payload.serverId, session);
  if (payload.serverId) {
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
    storageNode = await prisma.storageNode.create({
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
        serverId: payload.serverId,
        directAccessMode: payload.directAccessMode,
        publicBaseUrl: normalizePublicBaseUrl(payload.publicBaseUrl),
        directAccessExpiresSeconds: payload.directAccessExpiresSeconds,
        ...teamData,
      },
      include: STORAGE_NODE_SERVER_INCLUDE,
    });
  } catch (error) {
    if (payload.serverId && isUniqueViolation(error)) {
      throw new ValidationError(t("backend.storage.serverAlreadyHasStorageNode"));
    }
    throw error;
  }

  // Create the replacement first so a failed create can never leave the team
  // without a default node. The old default is retired only after success.
  await ensureDefaultNodeState(payload.isDefault, session, storageNode.id);

  return {
    ...safeNodeDto(storageNode),
    connectionSummary: buildStorageConnectionSummary({
      driver: storageNode.driver,
      basePath: storageNode.basePath,
      host: storageNode.host ?? storageNode.server?.host,
      port: storageNode.port ?? storageNode.server?.port,
      username: storageNode.username ?? storageNode.server?.username,
      serverName: storageNode.server?.name,
    }),
    directAccess: buildDirectAccessStrategy({
      driver: storageNode.driver,
      nodeId: storageNode.id,
      host: storageNode.host ?? storageNode.server?.host,
      port: storageNode.port ?? storageNode.server?.port,
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

  if (payload.serverId) {
    await assertServerInTeamScope(payload.serverId, session);
  }

  const claimed = await prisma.storageNode.updateMany({
    where: { id: payload.storageNodeId, ...(session ? teamWhere(session) : {}) },
    data: {
      name: payload.name ?? current.name,
      driver: nextDriver,
      basePath: payload.basePath ?? current.basePath,
      isDefault: payload.isDefault ?? current.isDefault,
      host: nextDriver === "SFTP" ? nextHost ?? null : null,
      port: nextDriver === "SFTP" ? nextPort : null,
      username: nextDriver === "SFTP" ? nextUsername : null,
      webdavConfigEncrypted,
      serverId: nextDriver === "WEBDAV" ? null : nextServerId ?? null,
      directAccessMode: nextDriver === "WEBDAV" ? "PROXY" : payload.directAccessMode ?? (driverChanged ? "PROXY" : current.directAccessMode),
      publicBaseUrl:
        nextDriver === "WEBDAV" || driverChanged ? null : payload.publicBaseUrl === undefined
          ? current.publicBaseUrl
          : normalizePublicBaseUrl(payload.publicBaseUrl),
      directAccessExpiresSeconds:
        payload.directAccessExpiresSeconds ??
        current.directAccessExpiresSeconds,
    },
  });
  if (claimed.count === 0) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }
  const updated = await prisma.storageNode.findFirst({
    where: { id: payload.storageNodeId, ...(session ? teamWhere(session) : {}) },
    include: STORAGE_NODE_SERVER_INCLUDE,
  });
  if (!updated) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }

  // Promote first, then retire the previous default. This preserves a usable
  // default even if the second database operation is interrupted.
  await ensureDefaultNodeState(payload.isDefault, session, payload.storageNodeId);
  return safeNodeDto(updated);
}

export async function deleteStorageNode(
  storageNodeId: string,
  session?: TeamSession | null,
) {
  const node = session
    ? await prisma.storageNode.findFirst({
        where: { id: storageNodeId, ...teamWhere(session) },
        include: { fileEntries: { select: { id: true, isDeleted: true } } },
      })
    : await prisma.storageNode.findUnique({
        where: { id: storageNodeId },
        include: { fileEntries: { select: { id: true, isDeleted: true } } },
      });

  const t = await serviceT();
  if (!node) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }

  if (node.isDefault) {
    throw new BusinessError(t("backend.storage.defaultCannotDelete"));
  }

  const activeEntryCount = node.fileEntries.filter(
    (entry) => !entry.isDeleted,
  ).length;
  if (activeEntryCount > 0) {
    throw new BusinessError(t("backend.storage.nodeHasEntries"));
  }

  const deleted = await prisma.storageNode.deleteMany({
    where: { id: storageNodeId, ...(session ? teamWhere(session) : {}) },
  });
  if (deleted.count === 0) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }
  return { deleted: true };
}

export async function listStorageNodes(session?: TeamSession | null) {
  // P2: take=500 上界。storage node 数量本质有限（每存储设备 1 行），上界即异常告警。
  const nodes = await prisma.storageNode.findMany({
    where: teamScopeWhere(session),
    orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
    take: 500,
    include: {
      ...STORAGE_NODE_SERVER_INCLUDE,
      fileEntries: { where: { isDeleted: false }, select: { id: true } },
    },
  });

  return nodes.map((node: StorageNodeListRow) => ({
    id: node.id,
    name: node.name,
    driver: node.driver,
    isDefault: node.isDefault,
    basePath: node.basePath,
    host: node.host,
    port: node.port,
    username: node.username,
    webdavConfig: publicWebdavConfig(node.webdavConfigEncrypted),
    serverId: node.serverId,
    directAccessMode: node.directAccessMode,
    publicBaseUrl: node.publicBaseUrl,
    directAccessExpiresSeconds: node.directAccessExpiresSeconds,
    createdAt: node.createdAt?.toISOString?.() ?? node.createdAt,
    updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
    ...serializeHealthFields(node),
    server: node.server,
    fileCount: node.fileEntries.length,
    connectionSummary: buildStorageConnectionSummary({
      driver: node.driver,
      basePath: node.basePath,
      host: node.host ?? node.server?.host,
      port: node.port ?? node.server?.port,
      username: node.username ?? node.server?.username,
      serverName: node.server?.name,
    }),
    directAccess: buildDirectAccessStrategy({
      driver: node.driver,
      nodeId: node.id,
      host: node.host ?? node.server?.host,
      port: node.port ?? node.server?.port,
      directAccessMode: node.directAccessMode,
      publicBaseUrl: node.publicBaseUrl,
      directAccessExpiresSeconds: node.directAccessExpiresSeconds,
    }),
  }));
}
