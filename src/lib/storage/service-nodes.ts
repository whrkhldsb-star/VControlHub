import { constants as fsConstants } from "node:fs";
import { access, stat } from "node:fs/promises";

import type { SessionPayload } from "@/lib/auth/session";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { serverT } from "@/lib/i18n/server-locale";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { normalizePublicBaseUrl } from "@/lib/storage/direct-access-url";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { expandStorageBasePath } from "@/lib/storage/path-utils";

import {
  createStorageNodeSchema,
  updateStorageNodeSchema,
  type CreateStorageNodeInput,
  type UpdateStorageNodeInput,
} from "./schema";
import {
  buildDirectAccessStrategy,
  buildStorageConnectionSummary,
  type StorageNodeListRow,
} from "./service-direct-access";

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
    where: { id: serverId, ...teamWhere(session) },
    select: { id: true },
  });
  if (!server) {
    const t = await serverT();
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }
}

export async function ensureDefaultNodeState(
  isDefault?: boolean,
  session?: TeamSession | null,
) {
  if (isDefault) {
    await prisma.storageNode.updateMany({
      where: teamScopeWhere(session),
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

  const t = await serverT();
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
        throw new BusinessError("Local storage root path is not a directory");
      }
      await access(expandedBasePath, fsConstants.R_OK | fsConstants.W_OK);
    } else if (node.driver === "SFTP") {
      const credentials = resolveStorageSshCredentials(node);

      await listRemoteDirectory({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        hostKeySha256: credentials.hostKeySha256,
        privateKey: credentials.privateKey,
        password: credentials.password,
        remotePath: normalizeRemotePath(node.basePath, ""),
      });
    }
  } catch (error) {
    healthStatus = "UNHEALTHY";
    lastHealthError = sanitizeHealthError(error);
  }

  const lastHealthLatencyMs = Math.max(0, Date.now() - startedAt);
  const updated = await prisma.storageNode.update({
    where: { id: storageNodeId },
    data: {
      healthStatus,
      lastHealthCheckAt: new Date(),
      lastHealthError,
      lastHealthLatencyMs,
    },
  });

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
    throw new ValidationError("SFTP storage nodes must be bound to a VPS node or specify a remote host");
  }

  await assertServerInTeamScope(payload.serverId, session);
  await ensureDefaultNodeState(payload.isDefault, session);
  const teamData = session ? teamCreateData(session) : {};

  const storageNode = await prisma.storageNode.create({
    data: {
      name: payload.name,
      driver: payload.driver,
      basePath: payload.basePath,
      isDefault: payload.isDefault,
      host: payload.host,
      port: payload.port,
      username: payload.username,
      serverId: payload.serverId,
      directAccessMode: payload.directAccessMode,
      publicBaseUrl: normalizePublicBaseUrl(payload.publicBaseUrl),
      directAccessExpiresSeconds: payload.directAccessExpiresSeconds,
      ...teamData,
    },
    include: STORAGE_NODE_SERVER_INCLUDE,
  });

  return {
    ...storageNode,
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

  const t = await serverT();
  if (!current) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }

  const nextDriver = payload.driver ?? current.driver;
  const nextServerId =
    payload.serverId === undefined
      ? (current.serverId ?? undefined)
      : (payload.serverId ?? undefined);
  const nextHost =
    payload.host === undefined
      ? (current.host ?? undefined)
      : (payload.host ?? undefined);
  const nextPort = payload.port === undefined ? current.port : payload.port;
  const nextUsername =
    payload.username === undefined ? current.username : payload.username;

  if (nextDriver === "SFTP" && !nextServerId && !nextHost) {
    throw new ValidationError("SFTP storage nodes must be bound to a VPS node or specify a remote host");
  }

  if (payload.serverId) {
    await assertServerInTeamScope(payload.serverId, session);
  }

  await ensureDefaultNodeState(payload.isDefault, session);

  return prisma.storageNode.update({
    where: { id: payload.storageNodeId },
    data: {
      name: payload.name ?? current.name,
      driver: nextDriver,
      basePath: payload.basePath ?? current.basePath,
      isDefault: payload.isDefault ?? current.isDefault,
      host: payload.host === undefined ? current.host : payload.host,
      port: nextPort,
      username: nextUsername,
      serverId:
        payload.serverId === undefined ? current.serverId : payload.serverId,
      directAccessMode: payload.directAccessMode ?? current.directAccessMode,
      publicBaseUrl:
        payload.publicBaseUrl === undefined
          ? current.publicBaseUrl
          : normalizePublicBaseUrl(payload.publicBaseUrl),
      directAccessExpiresSeconds:
        payload.directAccessExpiresSeconds ??
        current.directAccessExpiresSeconds,
    },
  });
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

  const t = await serverT();
  if (!node) {
    throw new NotFoundError(t("backend.storage.nodeNotFound"));
  }

  const activeEntryCount = node.fileEntries.filter(
    (entry) => !entry.isDeleted,
  ).length;
  if (activeEntryCount > 0) {
    throw new BusinessError("This storage node still has file entries; please delete or migrate the files before removing the node");
  }

  await prisma.storageNode.delete({ where: { id: storageNodeId } });
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
