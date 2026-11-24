import { Prisma, type Server } from "@prisma/client";
import { mkdir } from "node:fs/promises";

import type { SessionPayload } from "@/lib/auth/session";
import { isGlobalTeamManager, serverOriginData, serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { BusinessError, ConflictError, ForbiddenError, NotFoundError, ValidationError } from "@/lib/errors";
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
import { assertSshKeyTeam, encryptServerPassword, SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";
import type { TFn } from "@/lib/i18n/core";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { localBasePathBelongsToTenant } from "@/lib/storage/path-utils";
import { revokeInheritedSftpShares, revokeNodeShares } from "@/lib/storage/node-root";
import { checkStorageNodeHealth } from "@/lib/storage/service-nodes";
import { normalizeServerInput } from "./config";
import { defaultStoragePath } from "./default-storage-path";
import { findServerProfileForSession, probeEndpointWhere, serverCommandCounts, savedProfileBinding, SERVER_PROFILE_INCLUDE, type ServerProfileRecord } from "./service-profile-includes";
import { createServerSchema, storagePathSchema, type CreateServerInput } from "./schema";
import { parseServerSyncTargetAuth } from "@/lib/sync/target-auth";
import { applyServerDirectGatewayState, applyServerDirectGatewayStateUnderLock } from "./service-direct-gateway";
import { installServerAgent, installServerAgentUnderLock, removeAgentFromHost, resetAgentForModeChange, withServerLifecycleLock } from "./agent-service";
import { createWindowsServerProfile, updateWindowsServerProfile } from "./service-profiles-windows";
import { needsLegacyGatewayStop, firstDirectGatewayKeyVersion } from "./direct-gateway-key";
import { lockForTransaction, acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import {
  assertNoDuplicateServerHost,
  enrichServer,
  enrichServerForSession,
  getErrorMessage,
  isLocalHostLiteral,
  safeRevalidatePath,
  sessionForTeamWhere,
  verifyServerSshConnectivity,
  type ProfileSession,
  type ServerWithRelations,
} from "./service-internals";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

/**
 * A "local host" node (127.0.0.1, localhost, ::1, 0.0.0.0) is the hub's own
 * filesystem. Only platform administrators may register one: a customer who
 * could would pick any hub directory as the node's root (the environment file,
 * database dumps, other customers' storage). System callers (no session) pass.
 */
function assertLocalHostAllowed(session: Pick<ProfileSession, "roles"> | null | undefined, t: TFn) {
  if (session && !isGlobalTeamManager({ roles: session.roles ?? [] } as TeamSession)) {
    throw new ForbiddenError(t("backend.server.localHostPlatformOnly"));
  }
}

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
  teamId: string | null;
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
  teamId: string | null,
): ServerWithRelations {
  return {
    id: "__pending__",
    teamId,
    name: normalized.name,
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    description: normalized.description ?? null,
    tags: normalized.tags,
    enabled: true,
    // Windows nodes are created elsewhere (createWindowsServerProfile).
    operatingSystem: "LINUX",
    connectionType: normalized.connectionType,
    managementMode: normalized.managementMode,
    sshKeyId:
      normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
    password:
      normalized.connectionType === "PASSWORD" && normalized.password
        ? encryptServerPassword(normalized.password)
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
        ...(await buildSshParamsFromServer(server, server.sshKey ?? null, server.teamId)),
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
      expectedTeamId: server.teamId,
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
      const dialectSsh = await buildSshParamsFromServer(server, server.sshKey ?? null, server.teamId);
      const dialect = await detectOsDialect(dialectSsh);
      await prisma.server.update({
        where: probeEndpointWhere(server, true),
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
      await installServerAgent(server.id, server.teamId, probeEndpointWhere(server, true));
    } catch (error) {
      warnings.push(t("backend.server.agentInstallFailed", { error: getErrorMessage(error) }));
    }
  }

  return warnings;
}

/**
 * Move the bound storage root (empty storagePath keeps it) and/or recreate its
 * directory; returns warnings instead of failing the update.
 */
async function applyStoragePathChange(
  lifecycleLockHeld: boolean,
  server: ServerProfileRecord,
  rootMoved: boolean,
  session: TeamSession | null | undefined,
  t: TFn,
): Promise<string[]> {
  const storageNode = server.storageNode;
  const warnings: string[] = [];
  if (storageNode) {
    const targetPath = storageNode.basePath;
    const remoteNode = storageNode.driver === "SFTP" || (!storageNode.driver && !isLocalHostLiteral(server.host));
    if (remoteNode) {
      try {
        await createRemoteDirectory({
          ...resolveStorageSshCredentials({ ...storageNode, server }),
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
      if (rootMoved && server.directGatewayDesiredEnabled) {
        warnings.push(...await moveDirectGatewayRoot(lifecycleLockHeld, server, storageNode.id, targetPath, session, t));
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

/**
 * The direct gateway serves the root it was installed with. After the
 * storage root moves it would keep answering direct links from the old
 * folder (a same-named file there returned old bytes with a 200, which the
 * fallback cannot notice). Reinstall it on the new root; if that fails,
 * stop handing out direct links until it is fixed.
 */
async function moveDirectGatewayRoot(
  lifecycleLockHeld: boolean,
  server: ServerProfileRecord,
  storageNodeId: string,
  targetPath: string,
  session: TeamSession | null | undefined,
  t: TFn,
): Promise<string[]> {
  try {
    const apply = lifecycleLockHeld ? applyServerDirectGatewayStateUnderLock : applyServerDirectGatewayState;
    await apply({
      serverId: server.id,
      expectedTeamId: server.teamId,
      enabled: true,
      session,
      publicProtocol: server.directGatewayDesiredProtocol === "HTTPS" ? "https" : "http",
      publicDomain: server.directGatewayDesiredDomain,
    });
    return [];
  } catch (error) {
    await prisma.storageNode.update({ where: { id: storageNodeId, serverId: server.id, teamId: server.teamId }, data: { directAccessMode: "PROXY" } }).catch(() => undefined);
    return [t("backend.server.update.directGatewayRootFailed", { path: targetPath, error: getErrorMessage(error) })];
  }
}

export async function createServerProfile(
  input: CreateServerInput,
  session?: ProfileSession | null,
) {
  const t = await serviceT();
  const payload = createServerSchema.parse(input);
  if (payload.operatingSystem === "WINDOWS") return createWindowsServerProfile(payload, session, t);
  const normalized = normalizeServerInput(payload);
  if (isLocalHostLiteral(normalized.host)) assertLocalHostAllowed(session, t);
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

  const pendingServerForPreflight = buildPendingServer(normalized, validatedSshKey, teamData.teamId ?? null);
  const pendingSsh = await buildSshParamsFromServer(
    { ...pendingServerForPreflight, operatingSystem: "LINUX", managementMode: pendingServerForPreflight.managementMode ?? "DIRECT", hostKeySha256: pendingServerForPreflight.hostKeySha256 ?? null },
    pendingServerForPreflight.sshKey,
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

  const provisionalName = normalized.name;
  configuredPath =
    normalized.storagePath ||
    (isLocalHost ? `/srv/storage/${provisionalName}` : defaultStoragePath(normalized.username));

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
            ? encryptServerPassword(normalized.password)
            : null,
        costAutoSync: normalized.costAutoSync,
        costMonthlyAmount: normalized.costMonthlyAmount ? new Prisma.Decimal(normalized.costMonthlyAmount) : null,
        costCurrency: normalized.costCurrency,
        costProvider: normalized.costProvider,
        syncTargetAuth: payload.syncTargetAuth ?? "inherit",
        enabled: connectivityVerified,
        onboardingStatus: connectivityVerified ? "READY" : "DRAFT",
        onboardingLastError: draftReason,
        directGatewayDesiredEnabled: payload.enableDirectGateway,
        directGatewayDesiredProtocol: toStoredDirectGatewayProtocol(payload.directGatewayProtocol),
        directGatewayDesiredDomain: payload.directGatewayDomain?.trim() || null,
        ...teamData,
        ...(session ? serverOriginData(session) : {}),
      },
      include: SERVER_PROFILE_INCLUDE,
    });

    // Auto-create associated storage node in the same transaction
    await lockForTransaction(tx, "storage-node-default", teamData.teamId ?? "platform");
    const defaultCount = await tx.storageNode.count({ where: { teamId: teamData.teamId ?? null, isDefault: true } });
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
      where: probeEndpointWhere(server, true),
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
    where: probeEndpointWhere(server, connectivityVerified),
    include: SERVER_PROFILE_INCLUDE,
  });

  if (!refreshed) throw new NotFoundError(t("backend.server.nodeNotFound"));
  safeRevalidatePath("/storage");
  safeRevalidatePath("/files");

  return {
    ...await enrichServerForSession(refreshed!, session),
    onboardingWarnings,
    draftReason,
  };
}

export async function updateServerProfile(
  serverId: string,
  input: UpdateServerInput,
  session?: TeamSession | null,
) {
  const t = await serviceT();
  return withServerLifecycleLock(serverId, async () => {
    const current = await findServerProfileForSession(serverId, session);
    if (!current) throw new NotFoundError(t("backend.server.nodeNotFound"));
    const modeChanged = input.managementMode !== undefined && input.managementMode !== current.managementMode;
    const hostChanged = input.host !== undefined && input.host.trim().toLowerCase() !== current.host.toLowerCase();
    const portChanged = current.operatingSystem !== "WINDOWS" && input.port !== undefined && Number(input.port) !== current.port;
    const reconfigureAgent = modeChanged || (current.managementMode === "AGENT" && (hostChanged || portChanged));
    try {
      return await saveServerProfile(serverId, current, input, session, t, reconfigureAgent);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new ConflictError(t("backend.command.connectionChanged"));
      }
      throw error;
    }
  });
}

async function saveServerProfile(serverId: string, current: ServerProfileRecord, input: UpdateServerInput, session: TeamSession | null | undefined, t: TFn, reconfigureAgent: boolean) {
  if (input.operatingSystem && input.operatingSystem !== (current.operatingSystem ?? "LINUX")) {
    throw new ValidationError(t("backend.server.osImmutable"));
  }
  if (current.operatingSystem === "WINDOWS") return updateWindowsServerProfile(serverId, current, input, session, t, reconfigureAgent);

  const storagePath = storagePathSchema.parse(input.storagePath?.trim() || undefined);
  const priorNode = current.storageNode;
  const moveRoot = Boolean(priorNode && storagePath && storagePath !== priorNode.basePath);
  const remoteNode = priorNode && (priorNode.driver === "SFTP" || (!priorNode.driver && !isLocalHostLiteral(current.host)));
  if (priorNode && (storagePath || input.repairStoragePath) && !remoteNode && session && !isGlobalTeamManager(session)
    && (!session.currentTeamId || !localBasePathBelongsToTenant(storagePath || priorNode.basePath, session.currentTeamId))) {
    throw new ForbiddenError(t("backend.server.localHostPlatformOnly"));
  }

  const removeSshCredential = input.removeSshCredential === true;
  const requestedManagementMode = input.managementMode ?? current.managementMode;
  if (removeSshCredential) {
    if (requestedManagementMode !== "AGENT") {
      throw new ValidationError(t("backend.server.removeCredentialsAgentOnly"));
    }
    if (reconfigureAgent || !current.agentTokenHash || !current.agentLastSeenAt || Date.now() - current.agentLastSeenAt.getTime() >= 90_000) {
      throw new ValidationError(t("backend.server.waitFreshAgentHeartbeat"));
    }
  }

  const connectionType = input.connectionType ?? current.connectionType;
  if (reconfigureAgent && !(connectionType === "SSH_KEY" ? input.sshKeyId?.trim() : input.password?.trim())) {
    throw new ValidationError(t("backend.server.switchNeedsSsh"));
  }
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
  if (isLocalHostLiteral(normalized.host)) assertLocalHostAllowed(session, t);

  let updateSshKey: PreflightSshKey | null = current.sshKey ?? null;
  if (
    normalized.connectionType === "SSH_KEY" &&
    normalized.sshKeyId &&
    normalized.sshKeyId !== current.sshKeyId
  ) {
    updateSshKey = await findSshKeyForServer(normalized.sshKeyId, session, t);
  }

  if (!removeSshCredential && normalized.connectionType === "SSH_KEY" && updateSshKey) {
    assertSshKeyTeam(updateSshKey, current.teamId);
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
  let updated: Server;
  const onboardingWarnings: string[] = [];
  const releaseHostLock = await acquireAdvisoryLock("server-host", normalized.host.toLowerCase());
  try {
  await assertNoDuplicateServerHost(normalized, { excludeId: serverId, session: sessionForTeamWhere(session) });

  // The preflight below logs in to the new endpoint. With the stored password that hands it to whatever now
  // answers there: someone allowed to edit a server, but never told its root password, could point it at their
  // own sshd and read the password from its log. A new endpoint therefore needs the password typed again.
  // (A key is safe to keep: the server only ever sees a signature.)
  const endpointChanged =
    normalized.host !== current.host || normalized.port !== current.port || normalized.username !== current.username;
  if (endpointChanged && (needsLegacyGatewayStop(current) || current.fileProxyPort > 0 || current.publicUrl ||
    current.directGatewayDesiredEnabled || (priorNode?.publicBaseUrl && priorNode.directAccessMode !== "PROXY"))) {
    throw new BusinessError(t("backend.server.transfer.disableGateway"));
  }
  if (normalized.connectionType === "PASSWORD" && endpointChanged && !input.password) {
    throw new ValidationError(t("backend.server.endpointChangeNeedsPassword"));
  }

  const connectionChanged =
    normalized.host !== current.host ||
    normalized.port !== current.port ||
    normalized.username !== current.username ||
    normalized.connectionType !== current.connectionType ||
    reconfigureAgent ||
    normalized.sshKeyId !== current.sshKeyId ||
    (normalized.connectionType === "PASSWORD" && !!input.password);

  const nextServerForPreflight: ServerWithRelations = {
    ...current,
    managementMode: "DIRECT",
    host: normalized.host,
    port: normalized.port,
    username: normalized.username,
    connectionType: normalized.connectionType,
    sshKeyId:
      normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
    password:
      normalized.connectionType === "PASSWORD" && input.password
        ? encryptServerPassword(input.password)
        : current.password,
    sshKey: normalized.connectionType === "SSH_KEY" ? updateSshKey : null,
  };
  let hostKeySha256 = current.hostKeySha256 ?? null;
  if (connectionChanged) {
    const nextSsh = await buildSshParamsFromServer(
      { ...nextServerForPreflight, operatingSystem: "LINUX", managementMode: nextServerForPreflight.managementMode ?? "DIRECT", hostKeySha256: nextServerForPreflight.hostKeySha256 ?? null },
      nextServerForPreflight.sshKey,
    );
    hostKeySha256 = await requireApprovedSshHostKey({
      ssh: nextSsh,
      pinnedHostKeySha256:
        normalized.host === current.host && normalized.port === current.port ? current.hostKeySha256 : null,
      approvedHostKeySha256: input.approvedHostKeySha256 || input.hostKeySha256,
    });
    nextServerForPreflight.hostKeySha256 = hostKeySha256;
    await verifyServerSshConnectivity(normalized, nextServerForPreflight);
    if (reconfigureAgent && current.managementMode === "AGENT") {
      const originalEndpoint = normalized.host === current.host && normalized.port === current.port;
      const cleanup = await removeAgentFromHost(serverId, originalEndpoint ? { ...nextSsh, hostKeySha256 } : undefined);
      if (!cleanup.removed) onboardingWarnings.push(t(cleanup.requested ? "backend.server.agentCleanupRequested" : "backend.server.agentCleanupPendingLinux"));
    }
  }

  const update = {
    where: { ...probeEndpointWhere(current, current.enabled), directGatewayKeyVersion: current.directGatewayKeyVersion, directGatewayDesiredEnabled: current.directGatewayDesiredEnabled },
    data: {
      ...(reconfigureAgent ? resetAgentForModeChange() : {}),
      name: normalized.name,
      host: normalized.host,
      port: normalized.port,
      username: normalized.username,
      connectionType: normalized.connectionType,
      managementMode: normalized.managementMode,
      hostKeySha256,
      sshKeyId:
        removeSshCredential ? null : normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId! : null,
      ...(removeSshCredential || normalized.connectionType !== "PASSWORD" ? { password: null }
        : input.password ? { password: encryptServerPassword(input.password) } : {}),
      ...(endpointChanged && { publicUrl: null, directGatewayDesiredDomain: null,
        directGatewayKeyVersion: Math.max(firstDirectGatewayKeyVersion(current.operatingSystem), current.directGatewayKeyVersion) + 1 }),
      description: normalized.description,
      tags: normalized.tags,
      costAutoSync: normalized.costAutoSync,
      costMonthlyAmount: normalized.costMonthlyAmount ? new Prisma.Decimal(normalized.costMonthlyAmount) : null,
      costCurrency: normalized.costCurrency,
      costProvider: normalized.costProvider,
      // Only an explicit choice changes it: a caller that does not send it keeps the server's own.
      ...(input.syncTargetAuth ? { syncTargetAuth: parseServerSyncTargetAuth(input.syncTargetAuth) } : {}),
      ...(input.enabled !== undefined && { enabled: input.enabled }),
    },
  } satisfies Prisma.ServerUpdateArgs;
  updated = endpointChanged || moveRoot ? await prisma.$transaction(async (tx) => {
    const saved = await tx.server.update(update);
    if (endpointChanged) {
      await revokeInheritedSftpShares(tx, current, normalized);
      await tx.storageNode.updateMany({ where: { serverId, driver: "SFTP", teamId: current.teamId }, data: { directAccessMode: "PROXY", publicBaseUrl: null } });
    }
    if (moveRoot && priorNode) {
      await tx.storageNode.update({
        where: { id: priorNode.id, serverId, teamId: current.teamId, driver: priorNode.driver, basePath: priorNode.basePath, host: priorNode.host, port: priorNode.port, username: priorNode.username },
        data: { basePath: storagePath, ...revokeNodeShares() },
      });
    }
    return saved;
  }) : await prisma.server.update(update);
  } finally {
    await releaseHostLock();
  }

  const binding = savedProfileBinding(updated);
  if (reconfigureAgent && updated.managementMode === "AGENT" && updated.enabled && !isLocalHostLiteral(updated.host)) {
    try { await installServerAgentUnderLock(serverId, updated.teamId, binding); }
    catch (error) { onboardingWarnings.push(t("backend.server.agentInstallFailed", { error: getErrorMessage(error) })); }
  }
  if (current.storageNode && (input.storagePath?.trim() || input.repairStoragePath)) {
    const profile = await findServerProfileForSession(serverId, session, binding);
    const node = profile?.storageNode;
    const prior = current.storageNode;
    if (!profile || !node || prior.id !== node.id || prior.teamId !== node.teamId || prior.driver !== node.driver ||
      (storagePath || prior.basePath) !== node.basePath || prior.host !== node.host || prior.port !== node.port || prior.username !== node.username) {
      throw new NotFoundError(t("backend.server.nodeNotFound"));
    }
    onboardingWarnings.push(...await applyStoragePathChange(reconfigureAgent, profile, moveRoot, session, t));
  }

  const refreshed = await findServerProfileForSession(serverId, session, binding);
  if (!refreshed) throw new NotFoundError(t("backend.server.nodeNotFound"));

  return {
    ...await enrichServerForSession(refreshed, session),
    onboardingWarnings,
  };
}

export async function toggleServerEnabled(
  serverId: string,
  session?: TeamSession | null,
  approvedHostKeySha256?: string | null,
) {
  return withServerLifecycleLock(serverId, () => toggleServerEnabledUnderLock(serverId, session, approvedHostKeySha256));
}

async function toggleServerEnabledUnderLock(
  serverId: string, session?: TeamSession | null, approvedHostKeySha256?: string | null,
) {
  const current = await findServerProfileForSession(serverId, session);
  const t = await serviceT();
  if (!current) throw new NotFoundError(t("backend.server.nodeNotFound"));

  if (!current.enabled) {
    const changedEndpoint = (error: unknown): never => {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025") {
        throw new ConflictError(t("backend.command.connectionChanged"));
      }
      throw error;
    };
    if (current.operatingSystem === "WINDOWS") {
      if (!current.rdpPassword) throw new ValidationError(t("backend.server.windowsPasswordRequiredToEnable"));
      const updated = await prisma.server.update({ where: { ...probeEndpointWhere(current, false), rdpPassword: current.rdpPassword }, data: { enabled: true }, include: SERVER_PROFILE_INCLUDE }).catch(changedEndpoint);
      return { ...await enrichServerForSession(updated, session), onboardingWarnings: [] as string[] };
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
        where: { ...probeEndpointWhere(current, false), agentTokenHash: current.agentTokenHash },
        data: { enabled: true, onboardingStatus: "READY", onboardingLastError: null },
      }).catch(changedEndpoint);
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
    const ssh = await buildSshParamsFromServer(current, current.sshKey ?? null, current.teamId);
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
            ...resolveStorageSshCredentials({ ...current.storageNode, server: { ...current, hostKeySha256 } }),
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
        where: probeEndpointWhere(current, false),
        data: { enabled: true, hostKeySha256 },
      });
      if (current.storageNode) {
        await tx.storageNode.update({
          where: {
            id: current.storageNode.id, serverId, teamId: current.teamId,
            host: current.storageNode.host, port: current.storageNode.port, username: current.storageNode.username,
            hostKeySha256: current.storageNode.hostKeySha256, driver: current.storageNode.driver, basePath: current.storageNode.basePath,
          },
          data: {
            ...(current.storageNode.host == null && (current.storageNode.port ?? current.port) === current.port ? { hostKeySha256 } : {}),
            healthStatus: "UNKNOWN",
            lastHealthCheckAt: null,
            lastHealthError: null,
            lastHealthLatencyMs: null,
          },
        });
      }
      return updated;
    }).catch(changedEndpoint);

    const onboardingWarnings: string[] = [];
    if (current.managementMode === "AGENT" && !isLocalHostLiteral(current.host)) {
      try {
        await installServerAgent(serverId, current.teamId, probeEndpointWhere(updated, true));
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
        expectedTeamId: current.teamId,
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
          where: probeEndpointWhere(updated, true),
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
      where: probeEndpointWhere(updated, true),
      data: {
        onboardingStatus: onboardingWarnings.length > 0 ? "NEEDS_ATTENTION" : "READY",
        onboardingLastError: onboardingWarnings.length > 0
          ? onboardingWarnings.join(" ").slice(0, 2000)
          : null,
      },
    }).catch(changedEndpoint);

    return { ...updated, onboardingWarnings };
  }
  const updated = await prisma.server.update({
    where: { id: serverId, teamId: current.teamId ?? null },
    data: { enabled: false },
  });
  return { ...updated, onboardingWarnings: [] as string[] };
}

function serverProfileListWhere(sessionOrTeamId?: TeamSession | string | null) {
  let where: Record<string, unknown> | undefined;
  if (sessionOrTeamId && typeof sessionOrTeamId === "object") {
    where = serverTeamWhere(sessionOrTeamId);
  } else if (sessionOrTeamId !== undefined) {
    // Backward-compat: listServerProfiles(teamId) still accepted by internal callers
    where = { teamId: sessionOrTeamId ?? null };
  }
  return where;
}

/**
 * Every visible profile, for the pickers that list them all (Docker,
 * tickets, schedules, templates…). It used to stop at the newest 500, with
 * nothing saying so: a page that then kept only enabled ones could show none
 * while an older enabled node existed. Read in pages; `enabledOnly` filters
 * in the database rather than after a cut.
 */
export async function listServerProfiles(
  sessionOrTeamId?: TeamSession | string | null,
  options: { enabledOnly?: boolean } = {},
) {
  const where = { ...serverProfileListWhere(sessionOrTeamId), ...(options.enabledOnly ? { enabled: true } : {}) };
  const PAGE = 500;
  const session = typeof sessionOrTeamId === "object" ? sessionOrTeamId : null;
  const servers: ReturnType<typeof enrichServer>[] = [];
  let cursor: { id: string } | undefined;
  do {
    const page = await prisma.server.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: SERVER_PROFILE_INCLUDE,
      take: PAGE,
      ...(cursor ? { cursor, skip: 1 } : {}),
    });
    const counts = await serverCommandCounts(page, session);
    servers.push(...page.map(server => enrichServer(server, counts.get(server.id))));
    cursor = page.length === PAGE ? { id: page[page.length - 1]!.id } : undefined;
  } while (cursor);

  return servers;
}

/** Count visible profiles without hydrating credential-bearing relations. */
export async function countServerProfiles(
  sessionOrTeamId?: TeamSession | string | null,
) {
  return prisma.server.count({ where: serverProfileListWhere(sessionOrTeamId) });
}
