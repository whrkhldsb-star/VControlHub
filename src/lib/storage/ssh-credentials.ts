import { decryptServerPassword, decryptStoredSshKey, SSH_KEY_CREDENTIAL_SELECT, type StoredSshKey } from "@/lib/ssh/ssh-key-crypto";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

/** The server fields a storage node's connection is resolved from (use with the node's own host/port/username/hostKeySha256). */
export const STORAGE_SSH_SERVER_SELECT = {
  id: true,
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
  host: string | null;
  port: number | null;
  username: string | null;
  hostKeySha256: string | null;
  server: {
    id: string;
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
  const host = node.host ?? node.server?.host;
  const port = resolveStorageSshPort(node);
  const username = (node.username ?? node.server?.username)?.trim() || "";
  const rawConnectionType = node.server?.connectionType ?? (node.server?.password ? "PASSWORD" : "SSH_KEY");
  const connectionType = rawConnectionType === "PASSWORD" ? "PASSWORD" : "SSH_KEY";
  const key = connectionType === "SSH_KEY" ? decryptStoredSshKey(node.server?.sshKey) : null;
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
  const agentServerId = node.server?.managementMode === "AGENT" && node.server?.operatingSystem !== "WINDOWS"
    ? node.server.id ?? undefined : undefined;
  if (connectionType === "SSH_KEY" && !privateKey && !agentServerId) {
    throw new ValidationError(t("backend.storage.missingSshKey"));
  }
  if (connectionType === "PASSWORD" && !password && !agentServerId) {
    throw new ValidationError(t("backend.storage.missingPassword"));
  }

  return { host, port, username, connectionType, privateKey, ...(key?.passphrase ? { passphrase: key.passphrase } : {}), password, hostKeySha256: node.hostKeySha256 ?? node.server?.hostKeySha256 ?? null, ...(agentServerId ? { agentServerId } : {}) };
}
