import { decryptServerPassword, decryptStoredSshKey, SSH_KEY_CREDENTIAL_SELECT, type StoredSshKey } from "@/lib/ssh/ssh-key-crypto";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

/** The server fields a storage node's connection is resolved from (use with the node's own host/port/username/hostKeySha256). */
export const STORAGE_SSH_SERVER_SELECT = {
  id: true,
  teamId: true,
  host: true,
  port: true,
  username: true,
  connectionType: true,
  managementMode: true,
  operatingSystem: true,
  password: true,
  hostKeySha256: true,
  sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
} as const;

/**
 * Every field is required (nullable where the column is): with optional
 * fields, a projection that left out the node's own endpoint or the server's
 * id / management mode / OS still compiled and reached the wrong host, user,
 * port or transport (media playback, the health probe, content search).
 */
export type StorageSshCredentialNode = {
  teamId?: string | null;
  host: string | null;
  port: number | null;
  username: string | null;
  hostKeySha256: string | null;
  server: {
    id: string;
    teamId?: string | null;
    managementMode: string;
    operatingSystem: string;
    host: string;
    port: number;
    username: string;
    connectionType: "SSH_KEY" | "PASSWORD" | string;
    password: string | null;
    sshKey: StoredSshKey | null;
    hostKeySha256: string | null;
  } | null;
};

export type ResolvedStorageSshCredentials = {
  /** The selected host is the registered Windows server's OpenSSH endpoint. */
  windowsOpenSsh?: boolean;
  enforceHostKeyPin?: boolean;
  host: string;
  port: number;
  username: string;
  connectionType: "SSH_KEY" | "PASSWORD";
  privateKey?: string;
  /** Only when a legacy key format could not be unlocked in-process. */
  passphrase?: string;
  password?: string;
  hostKeySha256?: string | null;
  agentServerId?: string;
};

export function resolveStorageSshPort(node: { port: number | null; server: { operatingSystem: string; port: number } | null }) {
  return node.port ?? (node.server?.operatingSystem === "WINDOWS" ? 22 : node.server?.port) ?? 22;
}

export function resolveStorageSshCredentials(node: StorageSshCredentialNode): ResolvedStorageSshCredentials {
  if (node.server && (node.teamId === undefined || node.teamId !== node.server.teamId)) {
    throw new ValidationError(t("backend.storage.serverOwnerMismatch"));
  }
  const host = node.host ?? node.server?.host;
  const port = resolveStorageSshPort(node);
  const username = (node.username ?? node.server?.username)?.trim() || "";
  const rawConnectionType = node.server?.connectionType ?? (node.server?.password ? "PASSWORD" : "SSH_KEY");
  const connectionType = rawConnectionType === "PASSWORD" ? "PASSWORD" : "SSH_KEY";
  const key = connectionType === "SSH_KEY" ? decryptStoredSshKey(node.server?.sshKey, node.server?.teamId) : null;
  const privateKey = key?.privateKey;
  const password = connectionType === "PASSWORD" && node.server?.password
    ? decryptServerPassword(node.server.password)
    : undefined;

  if (!host) {
    throw new ValidationError(t("backend.storage.missingRemoteHost"));
  }
  if (!username) {
    throw new ValidationError(t("backend.storage.missingUsername"));
  }
  // The Windows agent handles monitoring and commands, but has no file stream
  // transport. Windows cloud storage must use its verified OpenSSH connection.
  const sameLinuxEndpoint = node.server?.operatingSystem === "LINUX"
    && host.toLowerCase() === node.server.host.toLowerCase() && port === node.server.port;
  const agentServerId = node.server?.managementMode === "AGENT" && sameLinuxEndpoint && username === node.server.username
    ? node.server.id ?? undefined : undefined;
  if (connectionType === "SSH_KEY" && !privateKey && !agentServerId) {
    throw new ValidationError(t("backend.storage.missingSshKey"));
  }
  if (connectionType === "PASSWORD" && !password && !agentServerId) {
    throw new ValidationError(t("backend.storage.missingPassword"));
  }

  // A node that takes its host from a Linux server talks to that server's own SSH endpoint, so the server's pin
  // is the one that counts: the copy the node got when it was created went stale when the server's key was
  // approved again (reinstall, new machine) and every SFTP operation was then refused as a changed key.
  const followsServerEndpoint = node.host == null && sameLinuxEndpoint;
  const hostKeySha256 = followsServerEndpoint
    ? node.server?.hostKeySha256 ?? node.hostKeySha256 ?? null
    : node.hostKeySha256 ?? node.server?.hostKeySha256 ?? null;

  // Windows profiles register the SSH key independently of their RDP port.
  // A node can override the endpoint even on the same hostname.
  const windowsOpenSsh = node.server?.operatingSystem === "WINDOWS"
    && host.toLowerCase() === node.server.host.toLowerCase()
    && Boolean(hostKeySha256) && hostKeySha256 === node.server.hostKeySha256;
  return {
    host, port, username, connectionType, privateKey, password, hostKeySha256,
    enforceHostKeyPin: true,
    ...(key?.passphrase ? { passphrase: key.passphrase } : {}),
    ...(agentServerId ? { agentServerId } : {}),
    ...(windowsOpenSsh ? { windowsOpenSsh } : {}),
  };
}
