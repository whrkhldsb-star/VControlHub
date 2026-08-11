import { Prisma } from "@prisma/client";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { BusinessError, ConflictError } from "@/lib/errors";
import { getErrorMessage as getErrorMessageShared } from "@/lib/http/error-message";
import {
  buildSshParamsFromServer,
  execRemoteCommand,
} from "@/lib/ssh/client";
import { getServerConnectionSummary } from "./config";
import { config } from "@/lib/config/env";
import { getDirectGatewayStatusLabel, getResolvedDirectGatewayProtocol } from "./direct-gateway";
import { t } from "@/lib/i18n/service-translations";

type ServerCommandTarget = {
  id: string;
  status: string;
  commandRequest: {
    id: string;
    title: string;
    initiatedByType: string;
    status: string;
    createdAt: Date | string;
  };
};

export type ServerWithRelations = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  sshKeyId: string | null;
  password: string | null;
  description?: string | null;
  tags: string[];
  enabled: boolean;
  connectionType: "SSH_KEY" | "PASSWORD";
  managementMode?: "DIRECT" | "AGENT";
  agentLastSeenAt?: Date | string | null;
  agentMetricsAt?: Date | string | null;
  agentVersion?: string | null;
  agentCapabilities?: string[];
  agentLastError?: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
  sshKey?: {
    id: string;
    name: string;
    fingerprint?: string | null;
    publicKey?: string | null;
    privateKey?: string | null;
    passphrase?: string | null;
    createdAt?: Date | string;
  } | null;
  storageNode?: {
    id: string;
    name: string;
    driver: string;
    isDefault: boolean;
    basePath: string;
    directAccessMode?: string;
    publicBaseUrl?: string | null;
    healthStatus?: "UNKNOWN" | "HEALTHY" | "UNHEALTHY";
  } | null;
  commandTargets?: ServerCommandTarget[];
  metricSnapshots?: Array<{ isOnline: boolean; createdAt: Date | string }>;
  publicUrl?: string | null;
  fileProxyPort?: number | null;
  // TR-041: OS dialect adaptation layer
  osDialect?: string | null;
  osInfo?: string | null;
  hostKeySha256?: string | null;
  // TR-031: monthly VPS cost auto-sync settings
  costAutoSync?: boolean;
  costMonthlyAmount?: Prisma.Decimal | null;
  costCurrency?: string;
  costProvider?: string | null;
  costLastSyncedAt?: Date | string | null;
  // TR-030: multi-tenancy resource scoping
  teamId?: string | null;
  onboardingStatus?: "READY" | "DRAFT" | "NEEDS_ATTENTION";
  onboardingLastError?: string | null;
  directGatewayDesiredEnabled?: boolean;
  directGatewayDesiredProtocol?: "HTTP" | "HTTPS" | "http" | "https";
  directGatewayDesiredDomain?: string | null;
};

export type ServerCommandTargetRow = ServerCommandTarget;

export type NormalizedServerInput = ReturnType<
  typeof import("./config").normalizeServerInput
>;

export type ExistingServerForDuplicateCheck = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  enabled: boolean;
};

export type ServerProfileRow = Prisma.ServerGetPayload<{
  include: {
    sshKey: {
      select: {
        id: true;
        name: true;
        fingerprint: true;
        publicKey: true;
        privateKey: true;
        passphrase: true;
        createdAt: true;
      };
    };
    storageNode: {
      select: {
        id: true;
        name: true;
        driver: true;
        isDefault: true;
        basePath: true;
        directAccessMode: true;
        publicBaseUrl: true;
      };
    };
    commandTargets: {
      select: {
        id: true;
        status: true;
        commandRequest: {
          select: {
            id: true;
            title: true;
            initiatedByType: true;
            status: true;
            createdAt: true;
          };
        };
      };
    };
  };
}>;

export function serializeDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

export function buildServerStatusLabel(enabled: boolean) {
  return enabled ? "Enabled" : "Disabled";
}

export function buildServerConnectionTypeLabel(
  connectionType: "SSH_KEY" | "PASSWORD",
) {
  return connectionType === "SSH_KEY" ? "SSH key" : "Password";
}

const SERVER_COST_CURRENCIES = ["CNY", "USD", "EUR", "JPY", "HKD"] as const;
type ServerCostCurrency = (typeof SERVER_COST_CURRENCIES)[number];

function normalizeServerCostCurrency(value: string | null | undefined): ServerCostCurrency {
  return SERVER_COST_CURRENCIES.includes(value as ServerCostCurrency)
    ? (value as ServerCostCurrency)
    : "CNY";
}

/**
 * Re-export of the shared {@link getErrorMessage} from `@/lib/http/error-message`
 * with a sensible default fallback. Kept for backward compatibility with the
 * two server-domain callers that import from this module; new code should
 * import the shared helper directly.
 */
export function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
  return getErrorMessageShared(error, fallback);
}

export function safeRevalidatePath(path: string) {
  try {
    revalidatePath(path);
  } catch (error) {
    // Service functions are also used by maintenance scripts/tests outside a
    // Next.js request/static-generation context. Cache revalidation is a best
    // effort UI refresh and must not make an already-applied VPS/storage change
    // look failed.
    if (!/static generation store missing/i.test(getErrorMessage(error))) {
      throw error;
    }
  }
}

export function isLocalHostLiteral(host: string) {
  return /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i.test(host.trim());
}

export function formatServerEndpoint(
  server: Pick<ExistingServerForDuplicateCheck, "host" | "port" | "username">,
) {
  return `${server.username}@${server.host}:${server.port}`;
}

export function buildDuplicateServerError(existing: ExistingServerForDuplicateCheck) {
  return `A VPS node with the same IP/host already exists: ${existing.name} (${formatServerEndpoint(existing)}). To avoid duplicate management of the same server or incorrect port entry, please edit the existing node or delete the old node before adding a new one.`;
}

export async function assertNoDuplicateServerHost(
  normalized: NormalizedServerInput,
  options: { excludeId?: string } = {},
) {
  const duplicate = await prisma.server.findFirst({
    where: {
      host: normalized.host,
      ...(options.excludeId ? { id: { not: options.excludeId } } : {}),
    },
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      username: true,
      enabled: true,
    },
  });
  if (duplicate) {
    throw new ConflictError(buildDuplicateServerError(duplicate));
  }
}

export async function verifyServerSshConnectivity(
  normalized: NormalizedServerInput,
  serverLike: Pick<
    ServerWithRelations,
    "host" | "port" | "username" | "password" | "connectionType" | "sshKeyId" | "hostKeySha256"
  > & {
    sshKey?: { privateKey?: string | null; passphrase?: string | null } | null;
  },
  options?: { failureMessage?: string },
) {
  if (isLocalHostLiteral(normalized.host)) return;

  try {
    const ssh = await buildSshParamsFromServer(
      serverLike as ServerWithRelations,
      serverLike.sshKey
        ? { privateKey: serverLike.sshKey.privateKey ?? null, passphrase: serverLike.sshKey.passphrase ?? null }
        : null,
    );
    const result = await execRemoteCommand({
      ...ssh,
      command: "printf vcontrolhub-ssh-ready",
      timeout: 15_000,
    });
    if (result.exitCode !== 0) {
      throw new BusinessError(
        result.stderr ||
          result.stdout ||
          t("backend.server.sshPrecheckExitCode", {
            code: result.exitCode ?? t("backend.ai.unknownError"),
          }),
      );
    }
  } catch (error) {
    const failureMessage =
      options?.failureMessage ??
      t("backend.server.cannotConnectTarget", {
        target: `${normalized.username}@${normalized.host}:${normalized.port}`,
      });
    throw new BusinessError(t("backend.server.connectionFailureDetails", {
      message: failureMessage,
      details: getErrorMessage(error),
    }));
  }
}

export function enrichServer(server: ServerWithRelations) {
  const hasSshCredential = Boolean(
    server.connectionType === "SSH_KEY" ? server.sshKeyId && server.sshKey : server.password,
  );
  return {
    id: server.id,
    name: server.name,
    host: server.host,
    port: server.port,
    username: server.username,
    hostKeySha256: server.hostKeySha256 ?? null,
    sshKeyId: server.sshKeyId,
    password: server.password ? "••••••••" : null,
    description: server.description,
    tags: server.tags,
    enabled: server.enabled,
    connectionType: server.connectionType,
    hasSshCredential,
    managementMode: server.managementMode ?? "DIRECT",
    agent: {
      online: Boolean(server.agentLastSeenAt && Date.now() - new Date(server.agentLastSeenAt).getTime() < 90_000),
      lastSeenAt: server.agentLastSeenAt ? serializeDate(server.agentLastSeenAt) : null,
      metricsAt: server.agentMetricsAt ? serializeDate(server.agentMetricsAt) : null,
      version: server.agentVersion ?? null,
      capabilities: server.agentCapabilities ?? [],
      lastError: server.agentLastError ?? null,
    },
    createdAt: serializeDate(server.createdAt),
    updatedAt: serializeDate(server.updatedAt),
    sshKey: server.sshKey
      ? {
          id: server.sshKey.id,
          name: server.sshKey.name,
          fingerprint: server.sshKey.fingerprint,
          publicKey: server.sshKey.publicKey,
          hasPrivateKey: !!server.sshKey.privateKey,
          createdAt: server.sshKey.createdAt,
        }
      : null,
    storageNode: server.storageNode,
    directGateway: {
      enabled: !!(
        server.fileProxyPort &&
        server.fileProxyPort > 0 &&
        server.publicUrl
      ),
      publicUrl: server.publicUrl ?? null,
      port: server.fileProxyPort ?? 0,
      statusLabel: getDirectGatewayStatusLabel({
        fileProxyPort: server.fileProxyPort,
        publicUrl: server.publicUrl,
      }),
      // TR-002 R3: bind + protocol come from the runtime env (single source
      // of truth shared with the on-node systemd unit) and the publicUrl
      // scheme. They're added to the projection so the UI risk banner has
      // the two inputs it needs to call `getDirectGatewayRiskAssessment`.
      bindAddress: config.deployment.directBindAddress,
      publicProtocol: getResolvedDirectGatewayProtocol({
        publicUrl: server.publicUrl ?? null,
      }),
    },
    statusLabel: buildServerStatusLabel(server.enabled),
    connectionTypeLabel: hasSshCredential ? buildServerConnectionTypeLabel(server.connectionType) : "Agent only",
    connectionSummary: hasSshCredential ? getServerConnectionSummary({
      host: server.host,
      port: server.port,
      username: server.username,
      connectionType: server.connectionType,
      sshKeyName: server.sshKey?.name ?? null,
    }) : `Agent-only management for ${server.host}; no SSH fallback credential is stored.`,
    targetCount: server.commandTargets?.length ?? 0,
    pendingCommandCount: (server.commandTargets ?? []).filter(
      (target) => target.status === "PENDING_APPROVAL",
    ).length,
    latestCommands: (server.commandTargets ?? []).map((target) => ({
      id: target.commandRequest.id,
      title: target.commandRequest.title,
      initiatedByType: target.commandRequest.initiatedByType,
      requestStatus: target.commandRequest.status,
      targetStatus: target.status,
      createdAt: serializeDate(target.commandRequest.createdAt),
    })),
    latestMetric: server.metricSnapshots?.[0]
      ? {
          isOnline: server.metricSnapshots[0].isOnline,
          createdAt: serializeDate(server.metricSnapshots[0].createdAt),
        }
      : null,
    // TR-041: OS dialect info for UI display + dialect-aware command generation
    osDialect: server.osDialect ?? null,
    osInfo: server.osInfo ?? null,
    onboardingStatus: server.onboardingStatus ?? "READY",
    onboardingLastError: server.onboardingLastError ?? null,
    costAutoSync: server.costAutoSync ?? false,
    costMonthlyAmount: server.costMonthlyAmount?.toFixed(2) ?? null,
    costCurrency: normalizeServerCostCurrency(server.costCurrency),
    costProvider: server.costProvider ?? null,
    costLastSyncedAt: server.costLastSyncedAt ? serializeDate(server.costLastSyncedAt) : null,
    // TR-030: multi-tenancy resource scoping
    teamId: server.teamId ?? null,
  };
}
