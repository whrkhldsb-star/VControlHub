import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { ValidationError } from "@/lib/errors";

export type StorageSshCredentialNode = {
  host?: string | null;
  port?: number | null;
  username?: string | null;
  hostKeySha256?: string | null;
  server?: {
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
};

export function resolveStorageSshCredentials(node: StorageSshCredentialNode): ResolvedStorageSshCredentials {
  const host = node.host ?? node.server?.host;
  const port = node.port ?? node.server?.port ?? 22;
  const username = node.username ?? node.server?.username ?? "root";
  const rawConnectionType = node.server?.connectionType ?? (node.server?.password ? "PASSWORD" : "SSH_KEY");
  const connectionType = rawConnectionType === "PASSWORD" ? "PASSWORD" : "SSH_KEY";
  const privateKey = connectionType === "SSH_KEY" && node.server?.sshKey?.privateKey
    ? decryptSshPrivateKey(node.server.sshKey.privateKey)
    : undefined;
  const password = connectionType === "PASSWORD" && node.server?.password
    ? decryptServerPassword(node.server.password)
    : undefined;

  if (!host) {
    throw new ValidationError("缺少远端主机地址，无法连接");
  }
  if (connectionType === "SSH_KEY" && !privateKey) {
    throw new ValidationError("缺少 SSH 私钥，无法连接");
  }
  if (connectionType === "PASSWORD" && !password) {
    throw new ValidationError("缺少登录密码，无法连接");
  }

  return { host, port, username, connectionType, privateKey, password, hostKeySha256: node.hostKeySha256 ?? node.server?.hostKeySha256 ?? null };
}
