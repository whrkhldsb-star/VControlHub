/**
 * Unified "load a Server and build its SSH connection params" step.
 *
 * Three modules previously each inlined this lookup and threw three
 * different error types for the same condition (BusinessError /
 * ValidationError / raw Error → 500). Every SSH-targeted operation now
 * resolves through here: typed errors, canonical copy, one decryption path
 * (buildSshParamsFromServer), one prisma projection.
 */
import { prisma } from "@/lib/db";
import { BusinessError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

import { buildSshParamsFromServer, type SshConnectionParams } from "./client";

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

/** True when the only usable transport for this server is the agent relay. */
export function isAgentOnlyServer(server: SshServerRow): boolean {
  return server.managementMode === "AGENT" && !server.sshKey?.privateKey && !server.password;
}

/**
 * Load one server by id, require it to exist and be enabled, and build the
 * decrypted SSH connection params. Throws typed BusinessErrors so API routes
 * surface 4xx with actionable copy instead of a generic 500.
 */
export async function loadEnabledServerForSsh(serverId: string): Promise<SshServerTarget> {
  const { server } = await loadEnabledServerRef(serverId);
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
