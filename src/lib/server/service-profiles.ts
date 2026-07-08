import { Prisma } from "@prisma/client";
import { mkdir } from "node:fs/promises";

import { prisma } from "@/lib/db";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { serverT } from "@/lib/i18n/server-locale";
import {
  buildSshParamsFromServer,
  createRemoteDirectory,
} from "@/lib/ssh/client";
import { requireApprovedSshHostKey } from "@/lib/ssh/host-key";
import { encryptServerPasswordIfPlain } from "@/lib/ssh/ssh-key-crypto";
import { normalizeServerInput } from "./config";
import { SERVER_PROFILE_INCLUDE } from "./service-profile-includes";
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
    passphrase?: string | null;
    createdAt?: Date | string;
  } | null = null;

  if (normalized.connectionType === "SSH_KEY") {
    if (!normalized.sshKeyId) throw new ValidationError("SSH key connection method requires selecting a key");
    validatedSshKey = await prisma.sshKey.findUnique({
      where: { id: normalized.sshKeyId },
      select: {
        id: true,
        name: true,
        fingerprint: true,
        publicKey: true,
        privateKey: true, passphrase: true,
        createdAt: true,
      },
    });
    if (!validatedSshKey) throw new NotFoundError("The selected SSH key does not exist or has been deleted");
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
    costAutoSync: normalized.costAutoSync,
    costMonthlyAmount: normalized.costMonthlyAmount ? new Prisma.Decimal(normalized.costMonthlyAmount) : null,
    costCurrency: normalized.costCurrency,
    hostKeySha256: null,
    costProvider: normalized.costProvider,
    costLastSyncedAt: null,
    storageNode: null,
    commandTargets: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const pendingSsh = await buildSshParamsFromServer(
    pendingServerForPreflight,
    pendingServerForPreflight.sshKey
      ? {
          privateKey: pendingServerForPreflight.sshKey.privateKey ?? null,
          passphrase: pendingServerForPreflight.sshKey.passphrase ?? null,
        }
      : null,
  );
  const hostKeySha256 = await requireApprovedSshHostKey({
    ssh: pendingSsh,
    approvedHostKeySha256: payload.approvedHostKeySha256 || payload.hostKeySha256,
  });
  pendingServerForPreflight.hostKeySha256 = hostKeySha256;
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
      hostKeySha256,
      sshKeyId:
        normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
      password:
        normalized.connectionType === "PASSWORD" && normalized.password
          ? encryptServerPasswordIfPlain(normalized.password)
          : null,
      costAutoSync: normalized.costAutoSync,
      costMonthlyAmount: normalized.costMonthlyAmount ? new Prisma.Decimal(normalized.costMonthlyAmount) : null,
      costCurrency: normalized.costCurrency,
      costProvider: normalized.costProvider,
      enabled: true,
    },
    include: SERVER_PROFILE_INCLUDE,
  });

  // Auto-create associated storage node
  const storageNodeName = `${server.name} storage`;
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
      hostKeySha256,
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
        `Failed to auto-create remote storage directory: ${getErrorMessage(error)}. VPS node and storage node have been created. After confirming SSH connectivity, please manually create ${configuredPath} on the target server, or re-save/retry the relevant operation.`,
      );
    }
  }

  if (payload.enableDirectGateway && !isLocalHost) {
    const directResult = await applyServerDirectGatewayState({
      serverId: server.id,
      enabled: true,
      bestEffort: true,
      publicProtocol: payload.directGatewayProtocol,
    });
    if (!directResult.enabled) {
      onboardingWarnings.push(
        `Failed to auto-configure direct gateway on target server${directResult.errorMessage ? `: ${directResult.errorMessage}` : ""}. VPS node and storage node have been created. You can retry enabling the direct gateway later in the VPS management panel.`,
      );
    }
  }

  // Re-fetch to include the newly created storageNode relation
  const refreshed = await prisma.server.findUnique({
    where: { id: server.id },
    include: SERVER_PROFILE_INCLUDE,
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
    include: SERVER_PROFILE_INCLUDE,
  });
  const t = await serverT();
  if (!current) throw new NotFoundError(t("backend.server.nodeNotFound"));

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
    costAutoSync: input.costAutoSync ?? current.costAutoSync,
    costMonthlyAmount:
      input.costMonthlyAmount !== undefined
        ? input.costMonthlyAmount
        : current.costMonthlyAmount?.toFixed(2),
    costCurrency: input.costCurrency ?? (current.costCurrency as "CNY" | "USD" | "EUR" | "JPY" | "HKD"),
    costProvider: input.costProvider ?? current.costProvider,
  });

  let updateSshKey: {
    id: string;
    name: string;
    fingerprint?: string | null;
    publicKey?: string | null;
    privateKey?: string | null;
    passphrase?: string | null;
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
        privateKey: true, passphrase: true,
        createdAt: true,
      },
    });
    if (!updateSshKey) throw new NotFoundError("The selected SSH key does not exist or has been deleted");
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
  let hostKeySha256 = current.hostKeySha256 ?? null;
  if (connectionChanged) {
    const nextSsh = await buildSshParamsFromServer(
      nextServerForPreflight,
      nextServerForPreflight.sshKey
        ? {
            privateKey: nextServerForPreflight.sshKey.privateKey ?? null,
            passphrase: nextServerForPreflight.sshKey.passphrase ?? null,
          }
        : null,
    );
    hostKeySha256 = await requireApprovedSshHostKey({
      ssh: nextSsh,
      pinnedHostKeySha256:
        normalized.host === current.host && normalized.port === current.port ? current.hostKeySha256 : null,
      approvedHostKeySha256: input.approvedHostKeySha256 || input.hostKeySha256,
    });
    nextServerForPreflight.hostKeySha256 = hostKeySha256;
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
      hostKeySha256,
      sshKeyId:
        normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
      password:
        normalized.connectionType === "PASSWORD" && normalized.password
          ? encryptServerPasswordIfPlain(normalized.password)
          : null,
      description: normalized.description,
      tags: normalized.tags,
      costAutoSync: normalized.costAutoSync,
      costMonthlyAmount: normalized.costMonthlyAmount ? new Prisma.Decimal(normalized.costMonthlyAmount) : null,
      costCurrency: normalized.costCurrency,
      costProvider: normalized.costProvider,
      enabled:
        typeof input.enabled === "boolean" ? input.enabled : current.enabled,
    },
    include: SERVER_PROFILE_INCLUDE,
  });

  return enrichServer(updated);
}

export async function toggleServerEnabled(serverId: string) {
  const current = await prisma.server.findUnique({
    where: { id: serverId },
    select: { enabled: true },
  });
  const t = await serverT();
  if (!current) throw new NotFoundError(t("backend.server.nodeNotFound"));
  return prisma.server.update({
    where: { id: serverId },
    data: { enabled: !current.enabled },
  });
}

export async function deleteServerProfile(serverId: string) {
  const current = await prisma.server.findUnique({
    where: { id: serverId },
    include: {
      sshKey: { select: { privateKey: true, passphrase: true } },
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
  const t = await serverT();
  if (!current) throw new NotFoundError(t("backend.server.nodeNotFound"));
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

export async function listServerProfiles(teamId?: string | null) {
  const servers = await prisma.server.findMany({
    where: teamId === undefined ? undefined : { teamId: teamId ?? null },
    orderBy: { createdAt: "desc" },
    include: SERVER_PROFILE_INCLUDE,
    take: 500, // P2: server 总数有限
  });

  return servers.map((server: ServerProfileRow) => enrichServer(server));
}
