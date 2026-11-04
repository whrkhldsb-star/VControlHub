/**
 * Unified "load a Server and build its SSH connection params" step.
 *
 * Three modules previously each inlined this lookup and threw three
 * different error types for the same condition (BusinessError /
 * ValidationError / raw Error → 500). Linux operations share one connection
 * builder; SFTP also supports Windows' separately configured OpenSSH endpoint.
 */
import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

import { buildSshParamsFromServer, resolveRemoteHomeDirectory, type SshConnectionParams } from "./client";
import { createLogger } from "@/lib/logging";

const logger = createLogger("ssh-server-target");

/** The prisma projection every SSH-target consumer needs. */
const SSH_SERVER_SELECT = {
  id: true,
  name: true,
  host: true,
  port: true,
  username: true,
  enabled: true,
  operatingSystem: true,
  connectionType: true,
  password: true,
  managementMode: true,
  hostKeySha256: true,
  sshKeyId: true,
  sshKey: { select: { privateKey: true, passphrase: true } },
} as const;

export type SshServerRow = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  enabled: boolean;
  operatingSystem: string;
  connectionType: string;
  password: string | null;
  managementMode: string;
  hostKeySha256: string | null;
  sshKeyId: string | null;
  sshKey: { privateKey: string | null; passphrase: string | null } | null;
};

export type SshServerTarget = {
  server: SshServerRow;
  ssh: SshConnectionParams;
};

/**
 * Resolve the credential presence a direct (non-agent) connection needs.
 * Agent-managed servers have no local credential by design and skip both
 * checks; consumers that only route agent traffic stay agnostic.
 */
export function assertDirectCredentialsConfigured(server: SshServerRow): void {
  const agentManaged = server.managementMode === "AGENT";
  if (!agentManaged) {
    if (server.connectionType === "SSH_KEY" && !server.sshKey?.privateKey) {
      throw new BusinessError(t("backend.ssh.keyNotConfigured"));
    }
    if (server.connectionType === "PASSWORD" && !server.password) {
      throw new BusinessError(t("backend.ssh.passwordNotConfigured"));
    }
  }
}

/**
 * Load one server by id, require it to exist and be enabled, and build the
 * decrypted SSH connection params. Throws typed BusinessErrors so API routes
 * surface 4xx with actionable copy instead of a generic 500.
 */
export async function loadEnabledServerForSsh(serverId: string): Promise<SshServerTarget> {
  const { server } = await loadEnabledServerRef(serverId);
  return buildServerSshTarget(server);
}

async function buildServerSshTarget(server: SshServerRow): Promise<SshServerTarget> {
  const ssh = await buildSshParamsFromServer(
    {
      operatingSystem: server.operatingSystem,
      host: server.host,
      port: server.port,
      username: server.username,
      connectionType: server.connectionType,
      sshKeyId: server.sshKeyId,
      password: server.password,
      hostKeySha256: server.hostKeySha256,
      id: server.id,
      managementMode: server.managementMode,
    },
    server.sshKey,
  );
  return { server, ssh };
}

/**
 * The real home of the SSH account, asked of the host once per ten minutes
 * (A3-10). The old `/home/<user>` guess remains the fallback when the host
 * cannot answer, so a transient failure degrades to the previous behaviour.
 */
const HOME_CACHE_MS = 10 * 60_000;
const HOME_CACHE_MAX = 500;
const homeCache = new Map<string, { home: string; at: number }>();

async function resolveLinuxHomeRoot(serverId: string, ssh: SshServerTarget["ssh"], fallback: string): Promise<string> {
  const key = `${serverId}:${ssh.username}`;
  const cached = homeCache.get(key);
  if (cached && Date.now() - cached.at < HOME_CACHE_MS) return cached.home;
  try {
    const home = await resolveRemoteHomeDirectory(ssh);
    if (homeCache.size >= HOME_CACHE_MAX) homeCache.delete(homeCache.keys().next().value!);
    homeCache.set(key, { home, at: Date.now() });
    return home;
  } catch (error) {
    logger.warn("sftp home directory lookup failed; using the conventional path", error, { serverId });
    return fallback;
  }
}

/** Windows file access uses OpenSSH credentials, never the RDP endpoint. */
export async function loadEnabledServerForSftp(serverId: string): Promise<SshServerTarget & { rootPath: string }> {
  const { server } = await loadEnabledServerRef(serverId);
  if (server.operatingSystem !== "WINDOWS") {
    assertDirectCredentialsConfigured(server);
    const target = await buildServerSshTarget(server);
    return {
      ...target,
      rootPath: await resolveLinuxHomeRoot(server.id, target.ssh, server.username === "root" ? "/root" : `/home/${server.username}`),
    };
  }

  const node = await prisma.storageNode.findUnique({
    where: { serverId },
    select: { driver: true, basePath: true, host: true, port: true, username: true, hostKeySha256: true },
  });
  if (!node || node.driver !== "SFTP") {
    throw new BusinessError(t("backend.server.windowsStorageRequiresSftp"));
  }
  const ssh = resolveStorageSshCredentials({ ...node, server });
  return { server, ssh, rootPath: node.basePath };
}

/**
 * Credential-free variant for consumers that only need the server row
 * (scope descriptors, display metadata): same typed existence/enabled
 * errors, no decryption work.
 */
export async function loadEnabledServerRef(
  serverId: string,
): Promise<{ server: SshServerRow }> {
  const server = (await prisma.server.findUnique({
    where: { id: serverId },
    select: SSH_SERVER_SELECT,
  })) as SshServerRow | null;
  if (!server) {
    throw new BusinessError(t("backend.ssh.serverNotFound", { serverId }));
  }
  if (!server.enabled) {
    throw new BusinessError(t("backend.ssh.serverDisabled", { name: server.name }));
  }
  return { server };
}
