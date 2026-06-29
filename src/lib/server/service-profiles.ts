import { mkdir } from "node:fs/promises";

import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  buildSshParamsFromServer,
  createRemoteDirectory,
} from "@/lib/ssh/client";
import { encryptServerPasswordIfPlain } from "@/lib/ssh/ssh-key-crypto";
import { normalizeServerInput } from "./config";
import { createServerSchema, type CreateServerInput } from "./schema";
import { applyServerDirectGatewayState } from "./service-direct-gateway";
import {
  assertNoDuplicateServerHost,
  enrichServer,
  getErrorMessage,
  isLocalHostLiteral,
  safeRevalidatePath,
  verifyServerSshConnectivity,
  type ServerProfileRow,
  type ServerWithRelations,
} from "./service-internals";

export async function createServerProfile(input: CreateServerInput) {
  const payload = createServerSchema.parse(input);
  const normalized = normalizeServerInput(payload);
  const onboardingWarnings: string[] = [];

  let validatedSshKey: {
    id: string;
    name: string;
    fingerprint?: string | null;
    publicKey?: string | null;
    privateKey?: string | null;
    createdAt?: Date | string;
  } | null = null;

  if (normalized.connectionType === "SSH_KEY") {
    if (!normalized.sshKeyId) throw new ValidationError("SSH 密钥连接方式需选择密钥");
    validatedSshKey = await prisma.sshKey.findUnique({
      where: { id: normalized.sshKeyId },
      select: {
        id: true,
        name: true,
        fingerprint: true,
        publicKey: true,
        privateKey: true,
        createdAt: true,
      },
    });
    if (!validatedSshKey) throw new NotFoundError("所选 SSH 密钥不存在或已被删除");
  }

  await assertNoDuplicateServerHost(normalized);

  const pendingServerForPreflight: ServerWithRelations = {
    id: "__pending__",
    name: normalized.name,
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    description: normalized.description ?? null,
    tags: normalized.tags,
    enabled: true,
    connectionType: normalized.connectionType,
    sshKeyId:
      normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
    password:
      normalized.connectionType === "PASSWORD" && normalized.password
        ? encryptServerPasswordIfPlain(normalized.password)
        : null,
    sshKey: normalized.connectionType === "SSH_KEY" ? validatedSshKey : null,
    storageNode: null,
    commandTargets: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  await verifyServerSshConnectivity(normalized, pendingServerForPreflight);

  const server = await prisma.server.create({
    data: {
      name: normalized.name,
      host: normalized.host,
      port: normalized.port,
      username: normalized.username,
      description: normalized.description,
      tags: normalized.tags,
      connectionType: normalized.connectionType,
      sshKeyId:
        normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
      password:
        normalized.connectionType === "PASSWORD" && normalized.password
          ? encryptServerPasswordIfPlain(normalized.password)
          : null,
      enabled: true,
    },
    include: {
      sshKey: {
        select: {
          id: true,
          name: true,
          fingerprint: true,
          publicKey: true,
          privateKey: true,
          createdAt: true,
        },
      },
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          isDefault: true,
          basePath: true,
          directAccessMode: true,
          publicBaseUrl: true,
        },
      },
      commandTargets: {
        select: {
          id: true,
          status: true,
          commandRequest: {
            select: {
              id: true,
              title: true,
              initiatedByType: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { commandRequest: { createdAt: "desc" } },
        take: 3,
      },
    },
  });

  // Auto-create associated storage node
  const storageNodeName = `${server.name} 存储`;
  const isLocalHost = isLocalHostLiteral(normalized.host);
  const defaultCount = await prisma.storageNode.count({
    where: { isDefault: true },
  });
  const configuredPath =
    normalized.storagePath ||
    (isLocalHost ? `/srv/storage/${server.name}` : "/root/drive");
  await prisma.storageNode.create({
    data: {
      name: storageNodeName,
      driver: isLocalHost ? "LOCAL" : "SFTP",
      basePath: configuredPath,
      isDefault: defaultCount === 0,
      serverId: isLocalHost ? null : server.id,
      directAccessMode: "PROXY",
      publicBaseUrl: null,
    },
  });

  if (isLocalHost) {
    try {
      await mkdir(configuredPath, { recursive: true });
    } catch {
      // Directory may already exist or FS unavailable — DB record proceeds regardless
    }
  } else {
    try {
      await createRemoteDirectory({
        ...(await buildSshParamsFromServer(server, server.sshKey ?? null)),
        remotePath: configuredPath,
        recursive: true,
      });
    } catch (error) {
      onboardingWarnings.push(
        `远端存储目录自动创建失败：${getErrorMessage(error)}。VPS 节点和存储节点已创建，请确认 SSH 可连接后在目标服务器手动创建 ${configuredPath}，或重新保存/重试相关操作。`,
      );
    }
  }

  if (payload.enableDirectGateway && !isLocalHost) {
    const directResult = await applyServerDirectGatewayState({
      serverId: server.id,
      enabled: true,
      bestEffort: true,
    });
    if (!directResult.enabled) {
      onboardingWarnings.push(
        `目标服务器直连自动配置失败${directResult.errorMessage ? `：${directResult.errorMessage}` : ""}。VPS 节点和存储节点已创建，可稍后在 VPS 管理面板重试启用直连。`,
      );
    }
  }

  // Re-fetch to include the newly created storageNode relation
  const refreshed = await prisma.server.findUnique({
    where: { id: server.id },
    include: {
      sshKey: {
        select: {
          id: true,
          name: true,
          fingerprint: true,
          publicKey: true,
          privateKey: true,
          createdAt: true,
        },
      },
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          isDefault: true,
          basePath: true,
          directAccessMode: true,
          publicBaseUrl: true,
        },
      },
      commandTargets: {
        select: {
          id: true,
          status: true,
          commandRequest: {
            select: {
              id: true,
              title: true,
              initiatedByType: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { commandRequest: { createdAt: "desc" } },
        take: 3,
      },
    },
  });

  safeRevalidatePath("/storage");
  safeRevalidatePath("/files");

  return {
    ...enrichServer(refreshed!),
    onboardingWarnings,
  };
}

export async function updateServerProfile(
  serverId: string,
  input: Partial<CreateServerInput> & { enabled?: boolean },
) {
  const current = await prisma.server.findUnique({
    where: { id: serverId },
    include: {
      sshKey: {
        select: {
          id: true,
          name: true,
          fingerprint: true,
          publicKey: true,
          privateKey: true,
          createdAt: true,
        },
      },
      commandTargets: {
        select: {
          id: true,
          status: true,
          commandRequest: {
            select: {
              id: true,
              title: true,
              initiatedByType: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { commandRequest: { createdAt: "desc" } },
        take: 3,
      },
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          isDefault: true,
          basePath: true,
          directAccessMode: true,
          publicBaseUrl: true,
        },
      },
    },
  });
  if (!current) throw new NotFoundError("VPS 节点不存在或已删除");

  const connectionType = input.connectionType ?? current.connectionType;
  const normalized = normalizeServerInput({
    name: input.name ?? current.name,
    host: input.host ?? current.host,
    port: input.port ? Number(input.port) : current.port,
    username: input.username ?? current.username,
    connectionType,
    sshKeyId: input.sshKeyId ?? current.sshKeyId ?? undefined,
    password: input.password ?? current.password ?? undefined,
    tags: input.tags ?? current.tags,
    description: input.description ?? current.description,
  });

  let updateSshKey: {
    id: string;
    name: string;
    fingerprint?: string | null;
    publicKey?: string | null;
    privateKey?: string | null;
    createdAt?: Date | string;
  } | null = current.sshKey ?? null;

  if (
    normalized.connectionType === "SSH_KEY" &&
    normalized.sshKeyId &&
    normalized.sshKeyId !== current.sshKeyId
  ) {
    updateSshKey = await prisma.sshKey.findUnique({
      where: { id: normalized.sshKeyId },
      select: {
        id: true,
        name: true,
        fingerprint: true,
        publicKey: true,
        privateKey: true,
        createdAt: true,
      },
    });
    if (!updateSshKey) throw new NotFoundError("所选 SSH 密钥不存在或已被删除");
  }

  await assertNoDuplicateServerHost(normalized, { excludeId: serverId });

  const connectionChanged =
    normalized.host !== current.host ||
    normalized.port !== current.port ||
    normalized.username !== current.username ||
    normalized.connectionType !== current.connectionType ||
    normalized.sshKeyId !== current.sshKeyId ||
    (normalized.connectionType === "PASSWORD" && !!input.password);

  const nextServerForPreflight: ServerWithRelations = {
    ...current,
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    connectionType: normalized.connectionType,
    sshKeyId:
      normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
    password:
      normalized.connectionType === "PASSWORD" && input.password
        ? encryptServerPasswordIfPlain(input.password)
        : current.password,
    sshKey: normalized.connectionType === "SSH_KEY" ? updateSshKey : null,
  };
  if (connectionChanged) {
    await verifyServerSshConnectivity(normalized, nextServerForPreflight);
  }

  const updated = await prisma.server.update({
    where: { id: serverId },
    data: {
      name: normalized.name,
      host: normalized.host,
      port: normalized.port,
      username: normalized.username,
      connectionType: normalized.connectionType,
      sshKeyId:
        normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
      password:
        normalized.connectionType === "PASSWORD" && normalized.password
          ? encryptServerPasswordIfPlain(normalized.password)
          : null,
      description: normalized.description,
      tags: normalized.tags,
      enabled:
        typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    },
    include: {
      sshKey: {
        select: {
          id: true,
          name: true,
          fingerprint: true,
          publicKey: true,
          privateKey: true,
          createdAt: true,
        },
      },
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          isDefault: true,
          basePath: true,
          directAccessMode: true,
          publicBaseUrl: true,
        },
      },
      commandTargets: {
        select: {
          id: true,
          status: true,
          commandRequest: {
            select: {
              id: true,
              title: true,
              initiatedByType: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { commandRequest: { createdAt: "desc" } },
        take: 3,
      },
    },
  });

  return enrichServer(updated);
}

export async function toggleServerEnabled(serverId: string) {
  const current = await prisma.server.findUnique({
    where: { id: serverId },
    select: { enabled: true },
  });
  if (!current) throw new NotFoundError("VPS 节点不存在或已删除");
  return prisma.server.update({
    where: { id: serverId },
    data: { enabled: !current.enabled },
  });
}

export async function deleteServerProfile(serverId: string) {
  const current = await prisma.server.findUnique({
    where: { id: serverId },
    include: {
      sshKey: { select: { privateKey: true } },
      storageNode: {
        select: {
          id: true,
          basePath: true,
          driver: true,
          fileEntries: { select: { id: true }, take: 1 },
          mediaItems: { select: { id: true }, take: 1 },
        },
      },
    },
  });
  if (!current) throw new NotFoundError("VPS 节点不存在或已删除");
  let cleanupSkipped = false;
  const shouldAttemptDirectGatewayCleanup =
    current.fileProxyPort &&
    current.fileProxyPort > 0 &&
    current.storageNode?.driver === "SFTP";
  if (shouldAttemptDirectGatewayCleanup) {
    const result = await applyServerDirectGatewayState({
      serverId,
      enabled: false,
      bestEffort: true,
    });
    cleanupSkipped = result.cleanupSkipped;
  }
  const storageNodeId = current.storageNode?.id ?? null;
  if (storageNodeId) {
    if ((current.storageNode?.mediaItems?.length ?? 0) > 0) {
      await prisma.mediaItem.deleteMany({ where: { storageNodeId } });
    }
    await prisma.storageNode.delete({ where: { id: storageNodeId } });
  }
  await prisma.server.delete({ where: { id: serverId } });
  return cleanupSkipped
    ? { deleted: true, cleanupSkipped: true }
    : { deleted: true };
}

export async function listServerProfiles() {
  const servers = await prisma.server.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      sshKey: {
        select: {
          id: true,
          name: true,
          fingerprint: true,
          publicKey: true,
          privateKey: true,
          createdAt: true,
        },
      },
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          isDefault: true,
          basePath: true,
          directAccessMode: true,
          publicBaseUrl: true,
        },
      },
      commandTargets: {
        select: {
          id: true,
          status: true,
          commandRequest: {
            select: {
              id: true,
              title: true,
              initiatedByType: true,
              status: true,
              createdAt: true,
            },
          },
        },
        orderBy: { commandRequest: { createdAt: "desc" } },
        take: 3,
      },
    },
    take: 500, // P2: server 总数有限
  });

  return servers.map((server: ServerProfileRow) => enrichServer(server));
}
