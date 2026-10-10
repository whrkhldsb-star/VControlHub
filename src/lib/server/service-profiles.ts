import { Prisma } from "@prisma/client";
import { mkdir } from "node:fs/promises";

import type { SessionPayload } from "@/lib/auth/session";
import { serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import {
  buildSshParamsFromServer,
  createRemoteDirectory,
} from "@/lib/ssh/client";
import { requireApprovedSshHostKey, SshHostKeyApprovalRequiredError } from "@/lib/ssh/host-key";
import {
  detectOsDialect,
  serializeDialect,
} from "@/lib/ssh/os-dialect";
import { encryptServerPasswordIfPlain, SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";
import type { TFn } from "@/lib/i18n/core";
import { checkStorageNodeHealth } from "@/lib/storage/service-nodes";
import { normalizeServerInput } from "./config";
import { SERVER_PROFILE_INCLUDE, type ServerProfileRecord } from "./service-profile-includes";
import { createServerSchema, type CreateServerInput } from "./schema";
import { applyServerDirectGatewayState } from "./service-direct-gateway";
import { installServerAgent, uninstallServerAgent } from "./agent-service";
import { createWindowsServerProfile, updateWindowsServerProfile } from "./service-profiles-windows";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import {
  assertNoDuplicateServerHost,
  enrichServer,
  getErrorMessage,
  isLocalHostLiteral,
  safeRevalidatePath,
  sessionForTeamWhere,
  verifyServerSshConnectivity,
  type ProfileSession,
  type ServerProfileRow,
  type ServerWithRelations,
} from "./service-internals";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

export type UpdateServerInput = Partial<CreateServerInput> & {
  enabled?: boolean;
  repairStoragePath?: boolean;
  removeSshCredential?: boolean;
  windowsSftpEnabled?: boolean;
  windowsSftpPort?: number;
  windowsSftpUsername?: string;
  windowsSftpPassword?: string;
  windowsSftpPath?: string;
};

function toStoredDirectGatewayProtocol(value: "http" | "https") {
  return value === "https" ? "HTTPS" as const : "HTTP" as const;
}

function fromStoredDirectGatewayProtocol(value: string | null | undefined): "http" | "https" {
  return value === "HTTPS" || value === "https" ? "https" : "http";
}

async function findServerProfileForSession(
  serverId: string,
  session?: TeamSession | null,
  include: typeof SERVER_PROFILE_INCLUDE | undefined = SERVER_PROFILE_INCLUDE,
) {
  if (session) {
    return prisma.server.findFirst({
      where: { id: serverId, ...serverTeamWhere(session, "manage") },
      include,
    });
  }
  return prisma.server.findUnique({
    where: { id: serverId },
    include,
  });
}

const SSH_KEY_PREFLIGHT_SELECT = {
  id: true,
  name: true,
  fingerprint: true,
  publicKey: true,
  ...SSH_KEY_CREDENTIAL_SELECT,
  createdAt: true,
} as const;

type PreflightSshKey = {
  id: string;
  name: string;
  fingerprint?: string | null;
  publicKey?: string | null;
  privateKey?: string | null;
  passphrase?: string | null;
  createdAt?: Date | string;
};

/** The SSH key a server will connect with, scoped to the caller's team. */
async function findSshKeyForServer(sshKeyId: string, session: ProfileSession | null | undefined, t: TFn): Promise<PreflightSshKey> {
  const scope = sessionForTeamWhere(session);
  const key = scope
    ? await prisma.sshKey.findFirst({ where: { id: sshKeyId, ...teamWhere(scope) }, select: SSH_KEY_PREFLIGHT_SELECT })
    : await prisma.sshKey.findUnique({ where: { id: sshKeyId }, select: SSH_KEY_PREFLIGHT_SELECT });
  if (!key) throw new NotFoundError(t("backend.server.sshKeyNotFound"));
  return key;
}

/** Unsaved server used to verify the host key and SSH login before create. */
function buildPendingServer(
  normalized: ReturnType<typeof normalizeServerInput>,
  sshKey: PreflightSshKey | null,
): ServerWithRelations {
  return {
    id: "__pending__",
    name: normalized.name,
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    description: normalized.description ?? null,
    tags: normalized.tags,
    enabled: true,
    connectionType: normalized.connectionType,
    managementMode: normalized.managementMode,
    sshKeyId:
      normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
    password:
      normalized.connectionType === "PASSWORD" && normalized.password
        ? encryptServerPasswordIfPlain(normalized.password)
        : null,
    sshKey: normalized.connectionType === "SSH_KEY" ? sshKey : null,
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
}

/**
 * Best-effort provisioning after a Linux node is saved: storage directory and
 * health, direct gateway, OS dialect and agent. Each failure becomes an
 * onboarding warning instead of failing the create.
 */
async function provisionNewServer(ctx: {
  server: ServerProfileRecord;
  payload: { enableDirectGateway: boolean; directGatewayProtocol: "http" | "https"; directGatewayDomain?: string };
  managementMode: string;
  isLocalHost: boolean;
  connectivityVerified: boolean;
  configuredPath: string;
  storageNodeId: string;
  session: ProfileSession | null | undefined;
  t: TFn;
}): Promise<string[]> {
  const { server, payload, managementMode, isLocalHost, connectivityVerified, configuredPath, storageNodeId, session, t } = ctx;
  const warnings: string[] = [];
  let storageDirectoryReady = false;
  if (isLocalHost) {
    try {
      await mkdir(configuredPath, { recursive: true });
      storageDirectoryReady = true;
    } catch (error) {
      warnings.push(t("backend.server.onboarding.localStorageCreateFailed", {
        path: configuredPath,
        error: getErrorMessage(error),
      }));
    }
  } else if (connectivityVerified) {
    try {
      await createRemoteDirectory({
        ...(await buildSshParamsFromServer(server, server.sshKey ?? null)),
        remotePath: configuredPath,
        recursive: true,
      });
      storageDirectoryReady = true;
    } catch (error) {
      warnings.push(t("backend.server.onboarding.remoteStorageCreateFailed", {
        path: configuredPath,
        error: getErrorMessage(error),
      }));
    }
  }

  if (storageDirectoryReady && storageNodeId) {
    try {
      const health = await checkStorageNodeHealth(storageNodeId, sessionForTeamWhere(session));
      if (health.healthStatus === "UNHEALTHY") {
        warnings.push(t("backend.server.onboarding.storageHealthFailed", {
          path: configuredPath,
          details: health.lastHealthError ? `: ${health.lastHealthError}` : "",
        }));
      }
    } catch (error) {
      warnings.push(t("backend.server.onboarding.storageHealthRecordFailed", {
        path: configuredPath,
        error: getErrorMessage(error),
      }));
    }
  }

  if (payload.enableDirectGateway && !isLocalHost && connectivityVerified) {
    const directResult = await applyServerDirectGatewayState({
      serverId: server.id,
      enabled: true,
      bestEffort: true,
      publicProtocol: payload.directGatewayProtocol,
      publicDomain: payload.directGatewayDomain?.trim() || null,
      publicListen: true,
    });
    if (!directResult.enabled) {
      warnings.push(t("backend.server.onboarding.gatewayFailed", {
        details: directResult.errorMessage ? `: ${directResult.errorMessage}` : "",
      }));
    }
  }

  // TR-041: best-effort OS dialect probe during onboarding so reload/AI commands
  // can use the right service manager without a manual "Detect OS" click first.
  if (!isLocalHost && connectivityVerified) {
    try {
      const dialectSsh = await buildSshParamsFromServer(server, server.sshKey ?? null);
      const dialect = await detectOsDialect(dialectSsh);
      await prisma.server.update({
        where: { id: server.id },
        data: {
          osDialect: serializeDialect(dialect),
          osInfo: dialect.distroName,
        },
      });
    } catch (error) {
      warnings.push(t("backend.server.onboarding.osDetectFailed", {
        error: getErrorMessage(error),
      }));
    }
  }

  if (managementMode === "AGENT" && !isLocalHost && connectivityVerified) {
    try {
      await installServerAgent(server.id);
    } catch (error) {
      warnings.push(t("backend.server.agentInstallFailed", { error: getErrorMessage(error) }));
    }
  }

  return warnings;
}

/** Install or remove the agent when the management mode changes; returns warnings. */
async function syncAgentForModeChange(
  serverId: string,
  previousMode: string,
  server: ServerProfileRecord,
  t: TFn,
): Promise<string[]> {
  const warnings: string[] = [];
  if (server.managementMode !== previousMode) {
    if (server.managementMode === "AGENT" && !isLocalHostLiteral(server.host) && server.enabled) {
      try {
        await installServerAgent(serverId);
      } catch (error) {
        warnings.push(t("backend.server.agentInstallFailed", { error: getErrorMessage(error) }));
      }
    } else if (previousMode === "AGENT") {
      const cleanup = await uninstallServerAgent(serverId);
      if (!cleanup.removed) warnings.push(t("backend.server.agentCleanupPendingLinux"));
    }
  }
  return warnings;
}

/**
 * Move the bound storage root (empty storagePath keeps it) and/or recreate its
 * directory; returns warnings instead of failing the update.
 */
async function applyStoragePathChange(
  server: ServerProfileRecord,
  input: Pick<UpdateServerInput, "storagePath" | "repairStoragePath">,
  session: TeamSession | null | undefined,
  t: TFn,
): Promise<string[]> {
  const nextStoragePath = typeof input.storagePath === "string" ? input.storagePath.trim() : "";
  const repairStoragePath = input.repairStoragePath === true;
  const storageNode = server.storageNode;
  const warnings: string[] = [];
  if (storageNode && (nextStoragePath || repairStoragePath)) {
    const targetPath = nextStoragePath || storageNode.basePath;
    if (nextStoragePath && nextStoragePath !== storageNode.basePath) {
      await prisma.storageNode.update({
        where: { id: storageNode.id },
        data: { basePath: targetPath },
      });
    }
    if (storageNode.driver === "SFTP" || (!storageNode.driver && !isLocalHostLiteral(server.host))) {
      try {
        await createRemoteDirectory({
          ...(await buildSshParamsFromServer(server, server.sshKey ?? null)),
          remotePath: targetPath,
          recursive: true,
        });
        await checkStorageNodeHealth(storageNode.id, session).catch(() => null);
      } catch (error) {
        warnings.push(t("backend.server.update.remoteStorageFailed", {
          path: targetPath,
          error: getErrorMessage(error),
        }));
      }
    } else {
      try {
        await mkdir(targetPath, { recursive: true });
      } catch (error) {
        warnings.push(t("backend.server.update.localStorageFailed", {
          path: targetPath,
          error: getErrorMessage(error),
        }));
      }
    }
  }
  return warnings;
}

export async function createServerProfile(
  input: CreateServerInput,
  session?: ProfileSession | null,
) {
  const t = await serviceT();
  const payload = createServerSchema.parse(input);
  if (payload.operatingSystem === "WINDOWS") return createWindowsServerProfile(payload, session, t);
  const normalized = normalizeServerInput(payload);
  const onboardingWarnings: string[] = [];
  let draftReason: string | null = null;
  const teamData = session ? teamCreateData(session) : {};

  let validatedSshKey: PreflightSshKey | null = null;
  if (normalized.connectionType === "SSH_KEY") {
    if (!normalized.sshKeyId) throw new ValidationError(t("backend.server.sshKeyMethodRequiresKey"));
    validatedSshKey = await findSshKeyForServer(normalized.sshKeyId, session, t);
  }

  // Serialize create/update by host so concurrent onboarding cannot double-insert
  // the same VPS host between findFirst and server.create (no @@unique on host).
  const isLocalHost = isLocalHostLiteral(normalized.host);
  let connectivityVerified = false;
  let configuredPath = "";
  let createdStorageNodeId = "";
  // Assigned under host lock before mkdir/onboarding uses them.
  let server!: ServerProfileRecord;
  const releaseHostLock = await acquireAdvisoryLock("server-host", normalized.host.toLowerCase());
  try {
  await assertNoDuplicateServerHost(normalized, { session: sessionForTeamWhere(session) });

  const pendingServerForPreflight = buildPendingServer(normalized, validatedSshKey);
  const pendingSsh = await buildSshParamsFromServer(
    pendingServerForPreflight,
    pendingServerForPreflight.sshKey
      ? {
          privateKey: pendingServerForPreflight.sshKey.privateKey ?? null,
          passphrase: pendingServerForPreflight.sshKey.passphrase ?? null,
        }
      : null,
  );
  let hostKeySha256: string | null = null;
  try {
    hostKeySha256 = await requireApprovedSshHostKey({
      ssh: pendingSsh,
      approvedHostKeySha256: payload.approvedHostKeySha256 || payload.hostKeySha256,
    });
    pendingServerForPreflight.hostKeySha256 = hostKeySha256;
    await verifyServerSshConnectivity(normalized, pendingServerForPreflight);
    connectivityVerified = true;
  } catch (error) {
    if (error instanceof SshHostKeyApprovalRequiredError || !payload.saveAsDraftOnConnectionFailure) {
      throw error;
    }
    hostKeySha256 = payload.approvedHostKeySha256 || payload.hostKeySha256 || null;
    draftReason = getErrorMessage(error);
    onboardingWarnings.push(t("backend.server.onboarding.sshDraft", { reason: draftReason }));
  }

  // Precompute paths outside the transaction (read-only counts may race slightly
  // for isDefault; server+storage create must be atomic to avoid orphan Server rows).
  const defaultCount = await prisma.storageNode.count({
    where: { isDefault: true },
  });
  const provisionalName = normalized.name;
  configuredPath =
    normalized.storagePath ||
    (isLocalHost ? `/srv/storage/${provisionalName}` : "/root/drive");

  server = await prisma.$transaction(async (tx) => {
    const created = await tx.server.create({
      data: {
        name: normalized.name,
        host: normalized.host,
        port: normalized.port,
        username: normalized.username,
        description: normalized.description,
        tags: normalized.tags,
        connectionType: normalized.connectionType,
        managementMode: normalized.managementMode,
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
        enabled: connectivityVerified,
        onboardingStatus: connectivityVerified ? "READY" : "DRAFT",
        onboardingLastError: draftReason,
        directGatewayDesiredEnabled: payload.enableDirectGateway,
        directGatewayDesiredProtocol: toStoredDirectGatewayProtocol(payload.directGatewayProtocol),
        directGatewayDesiredDomain: payload.directGatewayDomain?.trim() || null,
        ...teamData,
      },
      include: SERVER_PROFILE_INCLUDE,
    });

    // Auto-create associated storage node in the same transaction
    const storageNodeName = `${created.name} storage`;
    const createdStorageNode = await tx.storageNode.create({
      data: {
        name: storageNodeName,
        driver: isLocalHost ? "LOCAL" : "SFTP",
        basePath: configuredPath,
        isDefault: connectivityVerified && defaultCount === 0,
        serverId: isLocalHost ? null : created.id,
        directAccessMode: "PROXY",
        publicBaseUrl: null,
        hostKeySha256,
        healthStatus: connectivityVerified ? "UNKNOWN" : "UNHEALTHY",
        ...(connectivityVerified
          ? {}
          : {
              lastHealthCheckAt: new Date(),
              lastHealthError: draftReason?.slice(0, 500) ?? t("backend.server.onboarding.sshNotVerified"),
            }),
        ...(teamData.teamId !== undefined ? { teamId: teamData.teamId } : {}),
      },
    });
    createdStorageNodeId = createdStorageNode?.id ?? "";
    return created;
  });
  } finally {
    await releaseHostLock();
  }

  onboardingWarnings.push(...await provisionNewServer({
    server,
    payload,
    managementMode: normalized.managementMode,
    isLocalHost,
    connectivityVerified,
    configuredPath,
    storageNodeId: createdStorageNodeId,
    session,
    t,
  }));

  if (connectivityVerified) {
    await prisma.server.update({
      where: { id: server.id },
      data: {
        onboardingStatus: onboardingWarnings.length > 0 ? "NEEDS_ATTENTION" : "READY",
        onboardingLastError: onboardingWarnings.length > 0
          ? onboardingWarnings.join(" ").slice(0, 2000)
          : null,
      },
    });
  }

  // Re-fetch to include the newly created storageNode relation (+ dialect fields)
  const refreshed = await prisma.server.findUnique({
    where: { id: server.id },
    include: SERVER_PROFILE_INCLUDE,
  });

  safeRevalidatePath("/storage");
  safeRevalidatePath("/files");

  return {
    ...enrichServer(refreshed!),
    onboardingWarnings,
    draftReason,
  };
}

export async function updateServerProfile(
  serverId: string,
  input: UpdateServerInput,
  session?: TeamSession | null,
) {
  const current = await findServerProfileForSession(serverId, session);
  const t = await serviceT();
  if (!current) throw new NotFoundError(t("backend.server.nodeNotFound"));

  if (input.operatingSystem && input.operatingSystem !== (current.operatingSystem ?? "LINUX")) {
    throw new ValidationError(t("backend.server.osImmutable"));
  }
  if (current.operatingSystem === "WINDOWS") return updateWindowsServerProfile(serverId, current, input, session, t);

  const removeSshCredential = input.removeSshCredential === true;
  const requestedManagementMode = input.managementMode ?? current.managementMode;
  if (removeSshCredential) {
    if (requestedManagementMode !== "AGENT") {
      throw new ValidationError(t("backend.server.removeCredentialsAgentOnly"));
    }
    if (!current.agentLastSeenAt || Date.now() - current.agentLastSeenAt.getTime() >= 90_000) {
      throw new ValidationError(t("backend.server.waitFreshAgentHeartbeat"));
    }
  }

  const connectionType = input.connectionType ?? current.connectionType;
  const normalized = normalizeServerInput({
    name: input.name ?? current.name,
    host: input.host ?? current.host,
    port: input.port ? Number(input.port) : current.port,
    username: input.username ?? current.username,
    connectionType,
    managementMode: input.managementMode ?? current.managementMode,
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

  let updateSshKey: PreflightSshKey | null = current.sshKey ?? null;
  if (
    normalized.connectionType === "SSH_KEY" &&
    normalized.sshKeyId &&
    normalized.sshKeyId !== current.sshKeyId
  ) {
    updateSshKey = await findSshKeyForServer(normalized.sshKeyId, session, t);
  }

  if (normalized.managementMode === "DIRECT") {
    const hasNextCredential = normalized.connectionType === "SSH_KEY"
      ? Boolean(normalized.sshKeyId && updateSshKey?.privateKey)
      : Boolean(normalized.password);
    if (!hasNextCredential) {
      throw new ValidationError(t("backend.server.directRequiresCredential"));
    }
  }

  // Assigned under host lock before post-update onboarding uses it.
  let updated!: ServerProfileRecord;
  const releaseHostLock = await acquireAdvisoryLock("server-host", normalized.host.toLowerCase());
  try {
  await assertNoDuplicateServerHost(normalized, { excludeId: serverId, session: sessionForTeamWhere(session) });

  const connectionChanged =
    normalized.host !== current.host ||
    normalized.port !== current.port ||
    normalized.username !== current.username ||
    normalized.connectionType !== current.connectionType ||
    (normalized.managementMode === "DIRECT" && current.managementMode !== "DIRECT") ||
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

  updated = await prisma.server.update({
    where: { id: serverId, teamId: current.teamId ?? null },
    data: {
      name: normalized.name,
      host: normalized.host,
      port: normalized.port,
      username: normalized.username,
      connectionType: normalized.connectionType,
      managementMode: normalized.managementMode,
      hostKeySha256,
      sshKeyId:
        removeSshCredential ? null : normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
      password:
        !removeSshCredential && normalized.connectionType === "PASSWORD" && normalized.password
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
  } finally {
    await releaseHostLock();
  }

  const onboardingWarnings = [
    ...await syncAgentForModeChange(serverId, current.managementMode, updated, t),
    ...await applyStoragePathChange(updated, input, session, t),
  ];

  const refreshed = await prisma.server.findUnique({
    where: { id: serverId },
    include: SERVER_PROFILE_INCLUDE,
  });

  if (!refreshed || (refreshed.teamId ?? null) !== (current.teamId ?? null)) {
    throw new NotFoundError(t("backend.server.nodeNotFound"));
  }

  return {
    ...enrichServer(refreshed),
    onboardingWarnings,
  };
}

export async function toggleServerEnabled(
  serverId: string,
  session?: TeamSession | null,
  approvedHostKeySha256?: string | null,
) {
  const current = await findServerProfileForSession(serverId, session);
  const t = await serviceT();
  if (!current) throw new NotFoundError(t("backend.server.nodeNotFound"));

  if (!current.enabled) {
    if (current.operatingSystem === "WINDOWS") {
      if (!current.rdpPassword) throw new ValidationError();
      const updated = await prisma.server.update({ where: { id: serverId, teamId: current.teamId }, data: { enabled: true }, include: SERVER_PROFILE_INCLUDE });
      return { ...enrichServer(updated), onboardingWarnings: [] as string[] };
    }
    const hasSshCredential = current.connectionType === "SSH_KEY"
      ? Boolean(current.sshKeyId && current.sshKey?.privateKey)
      : Boolean(current.password);
    if (
      current.managementMode === "AGENT" &&
      !hasSshCredential &&
      current.agentLastSeenAt &&
      Date.now() - current.agentLastSeenAt.getTime() < 90_000
    ) {
      const updated = await prisma.server.update({
        where: { id: serverId, teamId: current.teamId ?? null },
        data: { enabled: true, onboardingStatus: "READY", onboardingLastError: null },
      });
      return { ...updated, onboardingWarnings: [] as string[] };
    }
    const normalized = normalizeServerInput({
      name: current.name,
      host: current.host,
      port: current.port,
      username: current.username,
      connectionType: current.connectionType,
      sshKeyId: current.sshKeyId ?? undefined,
      password: current.password ?? undefined,
      tags: current.tags,
      description: current.description,
      costAutoSync: current.costAutoSync,
      costMonthlyAmount: current.costMonthlyAmount?.toFixed(2),
      costCurrency: current.costCurrency as "CNY" | "USD" | "EUR" | "JPY" | "HKD",
      costProvider: current.costProvider,
    });
    const ssh = await buildSshParamsFromServer(current, current.sshKey ?? null);
    let hostKeySha256: string | null;
    try {
      hostKeySha256 = await requireApprovedSshHostKey({
        ssh,
        pinnedHostKeySha256: current.hostKeySha256,
        approvedHostKeySha256,
      });
    } catch (error) {
      if (error instanceof SshHostKeyApprovalRequiredError) throw error;
      throw new BusinessError(t("backend.server.enable.connectionFailedDetails", {
        target: `${current.username}@${current.host}:${current.port}`,
        error: getErrorMessage(error),
      }));
    }
    await verifyServerSshConnectivity(
      normalized,
      {
        ...current,
        hostKeySha256,
      },
      {
        failureMessage: t("backend.server.enable.connectionFailed", {
          target: `${current.username}@${current.host}:${current.port}`,
        }),
      },
    );

    if (current.storageNode) {
      try {
        if (
          current.storageNode.driver === "SFTP" ||
          (!current.storageNode.driver && !isLocalHostLiteral(current.host))
        ) {
          await createRemoteDirectory({
            ...ssh,
            hostKeySha256,
            remotePath: current.storageNode.basePath,
            recursive: true,
          });
        } else {
          await mkdir(current.storageNode.basePath, { recursive: true });
        }
      } catch (error) {
        throw new BusinessError(t("backend.server.enable.storagePrepareFailed", {
          target: `${current.username}@${current.host}:${current.port}`,
          path: current.storageNode.basePath,
          error: getErrorMessage(error),
        }));
      }
    }

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.server.update({
        where: { id: serverId, teamId: current.teamId ?? null },
        data: { enabled: true, hostKeySha256 },
      });
      if (current.storageNode) {
        await tx.storageNode.update({
          where: { id: current.storageNode.id },
          data: {
            hostKeySha256,
            healthStatus: "UNKNOWN",
            lastHealthCheckAt: null,
            lastHealthError: null,
            lastHealthLatencyMs: null,
          },
        });
      }
      return updated;
    });

    const onboardingWarnings: string[] = [];
    if (current.managementMode === "AGENT" && !isLocalHostLiteral(current.host)) {
      try {
        await installServerAgent(serverId);
      } catch (error) {
        onboardingWarnings.push(t("backend.server.agentInstallFailed", { error: getErrorMessage(error) }));
      }
    }
    if (current.storageNode) {
      try {
        const health = await checkStorageNodeHealth(current.storageNode.id, session);
        if (health.healthStatus === "UNHEALTHY") {
          onboardingWarnings.push(t("backend.server.enable.storageHealthFailed", {
            details: health.lastHealthError ? `: ${health.lastHealthError}` : "",
          }));
        }
      } catch (error) {
        onboardingWarnings.push(t("backend.server.enable.storageHealthRecordFailed", {
          error: getErrorMessage(error),
        }));
      }
    }

    if (current.directGatewayDesiredEnabled && !isLocalHostLiteral(current.host)) {
      const directResult = await applyServerDirectGatewayState({
        serverId,
        enabled: true,
        bestEffort: true,
        publicProtocol: fromStoredDirectGatewayProtocol(current.directGatewayDesiredProtocol),
        publicDomain: current.directGatewayDesiredDomain ?? null,
        publicListen: true,
      });
      if (!directResult.enabled) {
        onboardingWarnings.push(t("backend.server.enable.gatewayFailed", {
          details: directResult.errorMessage ? `: ${directResult.errorMessage}` : "",
        }));
      }
    }

    if (!isLocalHostLiteral(current.host)) {
      try {
        const dialect = await detectOsDialect({ ...ssh, hostKeySha256 });
        await prisma.server.update({
          where: { id: serverId, teamId: current.teamId ?? null },
          data: {
            osDialect: serializeDialect(dialect),
            osInfo: dialect.distroName,
          },
        });
      } catch (error) {
        onboardingWarnings.push(t("backend.server.enable.osDetectFailed", {
          error: getErrorMessage(error),
        }));
      }
    }

    await prisma.server.update({
      where: { id: serverId, teamId: current.teamId ?? null },
      data: {
        onboardingStatus: onboardingWarnings.length > 0 ? "NEEDS_ATTENTION" : "READY",
        onboardingLastError: onboardingWarnings.length > 0
          ? onboardingWarnings.join(" ").slice(0, 2000)
          : null,
      },
    });

    return { ...updated, onboardingWarnings };
  }
  const updated = await prisma.server.update({
    where: { id: serverId, teamId: current.teamId ?? null },
    data: { enabled: false },
  });
  return { ...updated, onboardingWarnings: [] as string[] };
}

export async function listServerProfiles(
  sessionOrTeamId?: TeamSession | string | null,
) {
  let where: Record<string, unknown> | undefined;
  if (sessionOrTeamId && typeof sessionOrTeamId === "object") {
    where = serverTeamWhere(sessionOrTeamId);
  } else if (sessionOrTeamId !== undefined) {
    // Backward-compat: listServerProfiles(teamId) still accepted by internal callers
    where = { teamId: sessionOrTeamId ?? null };
  }

  const servers = await prisma.server.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: SERVER_PROFILE_INCLUDE,
    take: 500, // P2: server 总数有限
  });

  return servers.map((server: ServerProfileRow) => enrichServer(server));
}
