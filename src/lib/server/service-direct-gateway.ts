import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";
import { BusinessError, NotFoundError, ValidationError } from "@/lib/errors";
import { serverT } from "@/lib/i18n/server-locale";
import {
  buildSshParamsFromServer,
  execRemoteCommand,
} from "@/lib/ssh/client";
import {
  buildDirectGatewayPublicBaseUrl,
  buildInstallDirectGatewayCommand,
  buildUninstallDirectGatewayCommand,
  DIRECT_GATEWAY_DEFAULT_PORT,
  DIRECT_GATEWAY_HTTPS_PUBLIC_PORT,
} from "./direct-gateway";
import { getErrorMessage, safeRevalidatePath } from "./service-internals";

const PUBLIC_HEALTH_TIMEOUT_MS = process.env.VITEST ? 400 : 8_000;
const PUBLIC_HEALTH_ATTEMPTS = process.env.VITEST ? 1 : 4;
const PUBLIC_HEALTH_RETRY_MS = process.env.VITEST ? 0 : 1_200;

export function getConfiguredDirectAccessSecret() {
  const secret = config.auth.storageGatewaySecret ?? "";
  if (!secret) {
    throw new ValidationError(
      "STORAGE_DIRECT_ACCESS_SECRET is not configured; cannot enable target server direct connection. Please configure the same direct connection signing key in the runtime environment first.",
    );
  }
  return secret;
}

/**
 * Resolve bind for remote install.
 * - explicit bindAddress wins
 * - publicListen=true → 0.0.0.0 (browser can reach publicUrl)
 * - publicListen=false → loopback (needs reverse proxy / VPN)
 * - default when enabling: publicListen true so AUTO direct actually works
 */
export function resolveDirectGatewayBindAddress(input: {
  bindAddress?: string;
  publicListen?: boolean;
}): string {
  if (input.bindAddress?.trim()) return input.bindAddress.trim();
  if (input.publicListen === false) return "127.0.0.1";
  return "0.0.0.0";
}

/** Probe the *public* entry used by browsers (not only remote loopback health). */
export async function probePublicDirectGatewayHealth(
  publicBaseUrl: string,
  options: { timeoutMs?: number; attempts?: number } = {},
): Promise<{ ok: boolean; error?: string; status?: number }> {
  const timeoutMs = options.timeoutMs ?? PUBLIC_HEALTH_TIMEOUT_MS;
  const attempts = options.attempts ?? PUBLIC_HEALTH_ATTEMPTS;
  let lastError = "unreachable";
  let lastStatus: number | undefined;

  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const healthUrl = new URL(
        "/__vch_health",
        publicBaseUrl.endsWith("/") ? publicBaseUrl : `${publicBaseUrl}/`,
      );
      const init: RequestInit & { dispatcher?: unknown } = {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
      };
      if (healthUrl.protocol === "https:") {
        try {
          // Dynamic import keeps edge/browser bundles clean; Node control-plane only.
          const { Agent } = await import("undici");
          init.dispatcher = new Agent({
            connect: { rejectUnauthorized: false },
          });
        } catch {
          // If undici Agent is unavailable, still attempt the fetch (may fail on self-signed).
        }
      }
      const response = await fetch(healthUrl, init as RequestInit);
      lastStatus = response.status;
      if (response.status === 200) {
        const body = (await response.text()).trim();
        if (body === "ok" || body === "") {
          return { ok: true, status: 200 };
        }
        lastError = `unexpected body ${JSON.stringify(body.slice(0, 80))}`;
      } else {
        lastError = `HTTP ${response.status}`;
      }
    } catch (error) {
      lastError = getErrorMessage(error);
    } finally {
      clearTimeout(timer);
    }
    if (i < attempts - 1) {
      await new Promise((r) => setTimeout(r, PUBLIC_HEALTH_RETRY_MS));
    }
  }

  return { ok: false, error: lastError, status: lastStatus };
}

export async function loadServerForDirectGateway(serverId: string) {
  return prisma.server.findUnique({
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
}

async function clearDirectGatewayDbState(serverId: string) {
  await prisma.server.update({
    where: { id: serverId },
    data: { fileProxyPort: 0, publicUrl: null },
  });
  await prisma.storageNode.updateMany({
    where: { serverId },
    data: { directAccessMode: "PROXY", publicBaseUrl: null },
  });
}

async function markDirectGatewayEnabledDb(input: {
  serverId: string;
  publicBaseUrl: string;
}) {
  await prisma.server.update({
    where: { id: input.serverId },
    data: {
      fileProxyPort: DIRECT_GATEWAY_DEFAULT_PORT,
      publicUrl: input.publicBaseUrl,
    },
  });
  await prisma.storageNode.updateMany({
    where: {
      serverId: input.serverId,
      driver: "SFTP",
    },
    data: {
      directAccessMode: "AUTO",
      publicBaseUrl: input.publicBaseUrl,
      directAccessExpiresSeconds: 300,
    },
  });
}

export async function applyServerDirectGatewayState(input: {
  serverId: string;
  enabled: boolean;
  bestEffort?: boolean;
  publicProtocol?: "http" | "https";
  /**
   * Listen address on the remote node.
   * Prefer publicListen for product path; bindAddress is the low-level override.
   */
  bindAddress?: string;
  /**
   * When enabling: if true (default), bind 0.0.0.0 so publicUrl is reachable.
   * If false, bind 127.0.0.1 (requires reverse proxy / VPN).
   */
  publicListen?: boolean;
  /** Skip control-plane public health probe (tests only). */
  skipPublicHealthProbe?: boolean;
  /**
   * When publicProtocol=https, install Caddy reverse-proxy automatically
   * (default true). Set false only for advanced manual TLS setups.
   */
  autoReverseProxy?: boolean;
}) {
  const t = await serverT();
  const server = await loadServerForDirectGateway(input.serverId);
  if (!server) {
    if (input.bestEffort)
      return {
        enabled: false,
        publicBaseUrl: null,
        cleanupSkipped: true,
      };
    throw new NotFoundError(t("backend.server.nodeNotFound"));
  }
  const isLocalHost = /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i.test(
    server.host.trim(),
  );
  if (input.enabled && isLocalHost) {
    const errorMessage =
      "The local node does not need a direct gateway to the target server. Continue using website relay or local storage access.";
    if (input.bestEffort) {
      return {
        enabled: false,
        publicBaseUrl: null,
        cleanupSkipped: true,
        errorMessage,
      };
    }
    throw new BusinessError(errorMessage);
  }
  if (
    input.enabled &&
    (!server.storageNode || server.storageNode.driver !== "SFTP")
  ) {
    const errorMessage =
      "Target server direct connection can only be enabled for VPS instances bound to an SFTP storage node. Please create or repair the remote storage node for this VPS first.";
    if (input.bestEffort) {
      return {
        enabled: false,
        publicBaseUrl: null,
        cleanupSkipped: true,
        errorMessage,
      };
    }
    throw new BusinessError(errorMessage);
  }
  const basePath = server.storageNode?.basePath || "/root";
  const publicProtocol = input.publicProtocol ?? "http";
  // HTTPS product path: auto reverse-proxy on 443 + loopback gateway (no manual Caddy).
  const autoReverseProxy =
    input.enabled &&
    publicProtocol === "https" &&
    input.autoReverseProxy !== false;
  const publicBaseUrl = buildDirectGatewayPublicBaseUrl({
    host: server.host,
    port: DIRECT_GATEWAY_DEFAULT_PORT,
    protocol: publicProtocol,
    autoReverseProxy,
    publicPort: autoReverseProxy ? DIRECT_GATEWAY_HTTPS_PUBLIC_PORT : undefined,
  });
  const bindAddress = autoReverseProxy
    ? "127.0.0.1"
    : resolveDirectGatewayBindAddress({
        bindAddress: input.bindAddress,
        // HTTP path: public listen so browser can hit :31888.
        publicListen: input.enabled ? (input.publicListen ?? true) : false,
      });
  let cleanupSkipped = false;
  let errorMessage: string | null = null;
  let ssh: Awaited<ReturnType<typeof buildSshParamsFromServer>>;
  let command: string;
  try {
    ssh = await buildSshParamsFromServer(server, server.sshKey);
    command = input.enabled
      ? buildInstallDirectGatewayCommand({
          rootPath: basePath,
          secret: getConfiguredDirectAccessSecret(),
          port: DIRECT_GATEWAY_DEFAULT_PORT,
          bindAddress,
          autoReverseProxy,
          publicPort: autoReverseProxy ? DIRECT_GATEWAY_HTTPS_PUBLIC_PORT : undefined,
          tlsHost: server.host,
        })
      : buildUninstallDirectGatewayCommand();
  } catch (error) {
    if (!input.bestEffort) throw error;
    return {
      enabled: false,
      publicBaseUrl: null,
      cleanupSkipped: true,
      errorMessage: getErrorMessage(error),
    };
  }
  if (!isLocalHost) {
    try {
      const result = await execRemoteCommand({
        ...ssh,
        command,
        timeout: 180_000,
      });
      if (result.exitCode && result.exitCode !== 0)
        throw new BusinessError(
          result.stderr || result.stdout || "Target server direct connection service operation failed",
        );
    } catch (error) {
      if (!input.bestEffort) throw error;
      errorMessage = getErrorMessage(error);
      cleanupSkipped = true;
    }
  }
  if (input.enabled && cleanupSkipped) {
    // Never leave a false-positive "enabled" row when install failed.
    try {
      await clearDirectGatewayDbState(input.serverId);
    } catch {
      /* ignore */
    }
    return {
      enabled: false,
      publicBaseUrl: null,
      cleanupSkipped,
      errorMessage,
    };
  }

  if (input.enabled) {
    // Install succeeded on-node (loopback health in install script). Now require
    // the *public* entry used by browsers to be reachable from the control plane.
    if (!input.skipPublicHealthProbe && !isLocalHost) {
      const probe = await probePublicDirectGatewayHealth(publicBaseUrl);
      if (!probe.ok) {
        // Roll back remote service + keep DB on relay so AUTO won't pretend.
        try {
          await execRemoteCommand({
            ...ssh,
            command: buildUninstallDirectGatewayCommand(),
            timeout: 120_000,
          });
        } catch {
          /* best-effort uninstall */
        }
        try {
          await clearDirectGatewayDbState(input.serverId);
        } catch {
          /* ignore */
        }
        const failMsg =
          `Direct gateway installed on the VPS but public health check failed for ${publicBaseUrl}/__vch_health (${probe.error ?? "unreachable"}). ` +
          `Open firewall/security-group/NAT for port ${autoReverseProxy ? DIRECT_GATEWAY_HTTPS_PUBLIC_PORT : DIRECT_GATEWAY_DEFAULT_PORT}` +
          (autoReverseProxy
            ? " (HTTPS auto reverse-proxy). Database stays on website relay."
            : ", or use a reverse proxy. Database stays on website relay.");
        if (input.bestEffort) {
          return {
            enabled: false,
            publicBaseUrl: null,
            cleanupSkipped: true,
            errorMessage: failMsg,
            bindAddress,
            publicReachable: false,
          };
        }
        throw new BusinessError(failMsg);
      }
    }

    await markDirectGatewayEnabledDb({
      serverId: input.serverId,
      publicBaseUrl,
    });
  } else {
    await clearDirectGatewayDbState(input.serverId);
  }

  safeRevalidatePath("/servers");
  safeRevalidatePath("/storage");
  safeRevalidatePath("/files");
  return {
    enabled: input.enabled,
    publicBaseUrl: input.enabled ? publicBaseUrl : null,
    cleanupSkipped,
    errorMessage,
    bindAddress: input.enabled ? bindAddress : undefined,
    publicReachable: input.enabled ? true : undefined,
    autoReverseProxy: input.enabled ? autoReverseProxy : undefined,
    publicProtocol: input.enabled ? publicProtocol : undefined,
  };
}

export async function setServerDirectGatewayEnabled(
  serverId: string,
  enabled: boolean,
  options: {
    publicProtocol?: "http" | "https";
    publicListen?: boolean;
    bindAddress?: string;
    skipPublicHealthProbe?: boolean;
    /** HTTPS: auto install Caddy reverse-proxy (default true when protocol=https). */
    autoReverseProxy?: boolean;
  } = {},
) {
  return applyServerDirectGatewayState({
    serverId,
    enabled,
    publicProtocol: options.publicProtocol,
    publicListen: options.publicListen,
    bindAddress: options.bindAddress,
    skipPublicHealthProbe: options.skipPublicHealthProbe,
    autoReverseProxy: options.autoReverseProxy,
  });
}
