import { Prisma } from "@prisma/client";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { BusinessError, ConflictError } from "@/lib/errors";
import {
  buildSshParamsFromServer,
  execRemoteCommand,
} from "@/lib/ssh/client";
import { getServerConnectionSummary } from "./config";
import { config } from "@/lib/config/env";
import { getDirectGatewayStatusLabel, getResolvedDirectGatewayProtocol } from "./direct-gateway";

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
  } | null;
  commandTargets?: ServerCommandTarget[];
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

export function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
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
          `SSH pre-check exit code ${result.exitCode ?? "unknown"}`,
      );
    }
  } catch (error) {
    throw new BusinessError(
      `Cannot connect to target server ${normalized.username}@${normalized.host}:${normalized.port}; node was not added/saved. Please check IP, port, username, and authentication credentials and retry. Details: ${getErrorMessage(error)}`,
    );
  }
}

export function enrichServer(server: ServerWithRelations) {
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
    connectionTypeLabel: buildServerConnectionTypeLabel(server.connectionType),
    connectionSummary: getServerConnectionSummary({
      host: server.host,
      port: server.port,
      username: server.username,
      connectionType: server.connectionType,
      sshKeyName: server.sshKey?.name ?? null,
    }),
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
    // TR-041: OS dialect info for UI display + dialect-aware command generation
    osDialect: server.osDialect ?? null,
    osInfo: server.osInfo ?? null,
    costAutoSync: server.costAutoSync ?? false,
    costMonthlyAmount: server.costMonthlyAmount?.toFixed(2) ?? null,
    costCurrency: normalizeServerCostCurrency(server.costCurrency),
    costProvider: server.costProvider ?? null,
    costLastSyncedAt: server.costLastSyncedAt ? serializeDate(server.costLastSyncedAt) : null,
    // TR-030: multi-tenancy resource scoping
    teamId: server.teamId ?? null,
  };
}
