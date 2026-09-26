import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

export type StorageSshCredentialNode = {
  host?: string | null;
  port?: number | null;
  username?: string | null;
  hostKeySha256?: string | null;
  server?: {
    id?: string | null;
    managementMode?: string | null;
    operatingSystem?: string | null;
    host?: string | null;
    port?: number | null;
    username?: string | null;
    connectionType?: "SSH_KEY" | "PASSWORD" | string | null;
    password?: string | null;
    sshKey?: { privateKey?: string | null } | null;
    hostKeySha256?: string | null;
  } | null;
};

export type ResolvedStorageSshCredentials = {
  host: string;
  port: number;
  username: string;
  connectionType: "SSH_KEY" | "PASSWORD";
  privateKey?: string;
  password?: string;
  hostKeySha256?: string | null;
  agentServerId?: string;
};

export function resolveStorageSshPort(node: Pick<StorageSshCredentialNode, "port" | "server">) {
  return node.port ?? (node.server?.operatingSystem === "WINDOWS" ? 22 : node.server?.port) ?? 22;
}

export function resolveStorageSshCredentials(node: StorageSshCredentialNode): ResolvedStorageSshCredentials {
  const host = node.host ?? node.server?.host;
  const port = resolveStorageSshPort(node);
  const username = (node.username ?? node.server?.username)?.trim() || "";
  const rawConnectionType = node.server?.connectionType ?? (node.server?.password ? "PASSWORD" : "SSH_KEY");
  const connectionType = rawConnectionType === "PASSWORD" ? "PASSWORD" : "SSH_KEY";
  const privateKey = connectionType === "SSH_KEY" && node.server?.sshKey?.privateKey
    ? decryptSshPrivateKey(node.server.sshKey.privateKey)
    : undefined;
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

  return { host, port, username, connectionType, privateKey, password, hostKeySha256: node.hostKeySha256 ?? node.server?.hostKeySha256 ?? null, ...(agentServerId ? { agentServerId } : {}) };
}
