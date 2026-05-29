export type ServerInput = {
 name: string;
 host: string;
 port?: number;
 username: string;
 connectionType: "SSH_KEY" | "PASSWORD";
 sshKeyId?: string;
 password?: string;
 tags?: string[];
 description?: string | null;
 storagePath?: string;
 };

export type NormalizedServerInput = {
 name: string;
 host: string;
 port: number;
 username: string;
 connectionType: "SSH_KEY" | "PASSWORD";
 sshKeyId: string | null;
 password: string | null;
 tags: string[];
 description: string | null;
 storagePath: string;
 };

export function normalizeServerInput(input: ServerInput): NormalizedServerInput {
 return {
  name: input.name.trim(),
  host: input.host.trim(),
  port: input.port ?? 22,
  username: input.username.trim(),
  connectionType: input.connectionType ?? "SSH_KEY",
  sshKeyId: input.sshKeyId?.trim() || null,
  password: input.password?.trim() || null,
  tags: Array.from(new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))),
  description: input.description?.trim() || null,
  storagePath: input.storagePath?.trim() || "/root/drive",
 };
}

export function getServerConnectionSummary(input: {
 host: string;
 port: number;
 username: string;
 connectionType: "SSH_KEY" | "PASSWORD";
 sshKeyName?: string | null;
}) {
 if (input.connectionType === "PASSWORD") {
  return `${input.username}@${input.host}:${input.port}，使用密码连接`;
 }
 return `${input.username}@${input.host}:${input.port}，使用 SSH 密钥 ${input.sshKeyName ?? "未知"} 连接`;
}
