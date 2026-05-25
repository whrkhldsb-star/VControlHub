import { createHash, randomBytes } from "node:crypto";
import { mkdir } from "node:fs/promises";

import { PPKError, parseFromString } from "ppk-to-openssh";

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { buildSshParamsFromServer, execRemoteCommand } from "@/lib/ssh/client";
import { encryptServerPasswordIfPlain, encryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { getServerConnectionSummary, normalizeServerInput } from "./config";
import { buildDirectGatewayPublicBaseUrl, buildInstallDirectGatewayCommand, buildUninstallDirectGatewayCommand, DIRECT_GATEWAY_DEFAULT_PORT, getDirectGatewayStatusLabel } from "./direct-gateway";
import { createServerSchema, type CreateServerInput } from "./schema";

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

type ServerWithRelations = {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  sshKeyId?: string | null;
  password?: string | null;
  description?: string | null;
  tags: string[];
  enabled: boolean;
  connectionType: "SSH_KEY" | "PASSWORD";
  createdAt: Date | string;
  updatedAt: Date | string;
  sshKey?: { id: string; name: string; fingerprint?: string | null; publicKey?: string | null; privateKey?: string | null; createdAt?: Date | string } | null;
  storageNode?: { id: string; name: string; driver: string; isDefault: boolean; basePath: string; directAccessMode?: string; publicBaseUrl?: string | null } | null;
  commandTargets?: ServerCommandTarget[];
  publicUrl?: string | null;
  fileProxyPort?: number | null;
};

function serializeDate(value: Date | string) {
  return value instanceof Date ? value.toISOString() : value;
}

function buildServerStatusLabel(enabled: boolean) {
  return enabled ? "已启用" : "已停用";
}

function buildServerConnectionTypeLabel(connectionType: "SSH_KEY" | "PASSWORD") {
  return connectionType === "SSH_KEY" ? "SSH 密钥" : "密码";
}

function enrichServer(server: ServerWithRelations) {
	return {
		id: server.id,
		name: server.name,
		host: server.host,
		port: server.port,
		username: server.username,
		sshKeyId: server.sshKeyId,
 password: server.password ? "••••••••" : null,
		description: server.description,
		tags: server.tags,
		enabled: server.enabled,
		connectionType: server.connectionType,
		createdAt: serializeDate(server.createdAt),
		updatedAt: serializeDate(server.updatedAt),
 sshKey: server.sshKey ? {
 id: server.sshKey.id,
 name: server.sshKey.name,
 fingerprint: server.sshKey.fingerprint,
 publicKey: server.sshKey.publicKey,
 hasPrivateKey: !!server.sshKey.privateKey,
 createdAt: server.sshKey.createdAt,
 } : null,
		storageNode: server.storageNode,
		directGateway: {
			enabled: !!(server.fileProxyPort && server.fileProxyPort > 0 && server.publicUrl),
			publicUrl: server.publicUrl ?? null,
			port: server.fileProxyPort ?? 0,
			statusLabel: getDirectGatewayStatusLabel({ fileProxyPort: server.fileProxyPort, publicUrl: server.publicUrl }),
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
		pendingCommandCount: (server.commandTargets ?? []).filter((target) => target.status === "PENDING_APPROVAL").length,
		latestCommands: (server.commandTargets ?? []).map((target) => ({
			id: target.commandRequest.id,
			title: target.commandRequest.title,
			initiatedByType: target.commandRequest.initiatedByType,
			requestStatus: target.commandRequest.status,
			targetStatus: target.status,
			createdAt: serializeDate(target.commandRequest.createdAt),
		})),
	};
}

export async function listSshKeys() {
 return prisma.sshKey.findMany({ orderBy: { createdAt: "desc" }, select: { id: true, name: true, fingerprint: true, description: true } });
}

function normalizeAuthorizedKey(input: string) {
  return input.trim().replace(/\r\n/g, "\n");
}

function toBase64UrlSafe(value: string) {
  return value.replace(/-/g, "+").replace(/_/g, "/");
}

function computeSshPublicKeyFingerprint(publicKey: string) {
  const normalized = normalizeAuthorizedKey(publicKey);
  const parts = normalized.split(/\s+/);

  if (parts.length < 2) {
    throw new Error("SSH 公钥格式无效，请粘贴完整的 authorized_keys 公钥内容。");
  }

  const decoded = Buffer.from(toBase64UrlSafe(parts[1]), "base64");
  if (decoded.length === 0) {
    throw new Error("SSH 公钥内容无法解析，请检查公钥是否完整。");
  }

  return `SHA256:${createHash("sha256").update(decoded).digest("base64").replace(/=+$/g, "")}`;
}

type SshPrivateKeyEncryptionMode = "none" | "same-as-ppk" | "custom";

async function normalizeImportedSshKey(input: {
  publicKey?: string;
  privateKey?: string | null;
  ppkContent?: string | null;
  ppkPassphrase?: string | null;
  privateKeyEncryptionMode?: SshPrivateKeyEncryptionMode;
  privateKeyOutputPassphrase?: string | null;
}) {
  const ppkContent = input.ppkContent?.trim();
  const manualPrivateKey = input.privateKey?.trim() || null;

  if (!ppkContent) {
    const publicKey = normalizeAuthorizedKey(input.publicKey ?? "");
    if (!publicKey) {
      throw new Error("SSH 公钥不能为空，或请上传 .ppk 私钥文件自动提取。 ");
    }

    return {
      publicKey,
      privateKey: manualPrivateKey,
      fingerprint: computeSshPublicKeyFingerprint(publicKey),
    };
  }

  const inputPassphrase = input.ppkPassphrase?.trim() ?? "";
  const encryptionMode = input.privateKeyEncryptionMode ?? "none";
  const outputPassphrase = input.privateKeyOutputPassphrase?.trim() ?? "";

  if (encryptionMode === "same-as-ppk" && !inputPassphrase) {
    throw new Error("选择沿用 PPK 口令时，必须填写 PPK 口令。");
  }

  if (encryptionMode === "custom" && !outputPassphrase) {
    throw new Error("选择自定义加密格式时，必须填写新的私钥口令。");
  }

  try {
    const parsed =
      encryptionMode === "none"
        ? await parseFromString(ppkContent, inputPassphrase)
        : await parseFromString(ppkContent, inputPassphrase, {
            encrypt: true,
            outputPassphrase: encryptionMode === "same-as-ppk" ? inputPassphrase : outputPassphrase,
          });

    return {
      publicKey: normalizeAuthorizedKey(parsed.publicKey),
      privateKey: parsed.privateKey.trim(),
      fingerprint: parsed.fingerprint || computeSshPublicKeyFingerprint(parsed.publicKey),
    };
  } catch (error) {
    if (error instanceof PPKError) {
      if (error.code === "PASSPHRASE_REQUIRED") {
        throw new Error("该 PPK 文件已加密，请填写正确的 PPK 口令后再导入。");
      }

      if (error.code === "INVALID_MAC") {
        throw new Error("PPK 口令错误或文件已损坏，请检查后重试。");
      }

      if (error.code === "WRONG_FORMAT") {
        throw new Error("上传文件不是有效的 PPK 私钥，请选择 .ppk 文件。 ");
      }

      throw new Error(error.message);
    }

    throw error;
  }
}

export async function createSshKey(input: {
  name: string;
  publicKey?: string;
  privateKey?: string | null;
  ppkContent?: string | null;
  ppkPassphrase?: string | null;
  privateKeyEncryptionMode?: SshPrivateKeyEncryptionMode;
  privateKeyOutputPassphrase?: string | null;
  description?: string | null;
  createdById?: string | null;
}) {
  const name = input.name.trim();
  const description = input.description?.trim() || null;

  if (!name) throw new Error("SSH 密钥名称不能为空");

  const normalizedKey = await normalizeImportedSshKey(input);

  return prisma.sshKey.create({
    data: {
      name,
      fingerprint: normalizedKey.fingerprint,
      publicKey: normalizedKey.publicKey,
      privateKey: normalizedKey.privateKey ? encryptSshPrivateKey(normalizedKey.privateKey) : null,
      description,
      createdById: input.createdById ?? null,
    },
    select: {
      id: true,
      name: true,
      fingerprint: true,
      description: true,
    },
  });
}


async function loadServerForDirectGateway(serverId: string) {
 return prisma.server.findUnique({
  where: { id: serverId },
  include: {
   sshKey: { select: { privateKey: true } },
   storageNode: { select: { basePath: true, driver: true } },
  },
 });
}

async function applyServerDirectGatewayState(input: { serverId: string; enabled: boolean; bestEffort?: boolean }) {
 const server = await loadServerForDirectGateway(input.serverId);
 if (!server) {
  if (input.bestEffort) return { enabled: input.enabled, publicBaseUrl: null, cleanupSkipped: true };
  throw new Error("VPS 节点不存在或已删除");
 }
 const isLocalHost = /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i.test(server.host.trim());
 const basePath = server.storageNode?.basePath || "/root";
 const publicBaseUrl = buildDirectGatewayPublicBaseUrl({ host: server.host, port: DIRECT_GATEWAY_DEFAULT_PORT });
 const ssh = await buildSshParamsFromServer(server, server.sshKey);
 const command = input.enabled
  ? buildInstallDirectGatewayCommand({ rootPath: basePath, secret: process.env.STORAGE_DIRECT_ACCESS_SECRET || process.env.AUTH_SECRET || process.env.NEXTAUTH_SECRET || randomBytes(32).toString("hex"), port: DIRECT_GATEWAY_DEFAULT_PORT })
  : buildUninstallDirectGatewayCommand();
 let cleanupSkipped = false;
 if (!isLocalHost) {
  try {
   const result = await execRemoteCommand({ ...ssh, command, timeout: 180_000 });
   if (result.exitCode && result.exitCode !== 0) throw new Error(result.stderr || result.stdout || "目标服务器直连服务操作失败");
  } catch (error) {
   if (!input.bestEffort) throw error;
   cleanupSkipped = true;
  }
 }
 await prisma.server.update({
  where: { id: input.serverId },
  data: input.enabled ? { fileProxyPort: DIRECT_GATEWAY_DEFAULT_PORT, publicUrl: publicBaseUrl } : { fileProxyPort: 0, publicUrl: null },
 });
 await prisma.storageNode.updateMany({
  where: { serverId: input.serverId, ...(input.enabled ? { driver: "SFTP" as const } : {}) },
  data: input.enabled
   ? { directAccessMode: "AUTO", publicBaseUrl, directAccessExpiresSeconds: 300 }
   : { directAccessMode: "PROXY", publicBaseUrl: null },
 });
 revalidatePath("/servers");
 revalidatePath("/storage");
 revalidatePath("/files");
 return { enabled: input.enabled, publicBaseUrl: input.enabled ? publicBaseUrl : null, cleanupSkipped };
}

export async function setServerDirectGatewayEnabled(serverId: string, enabled: boolean) {
 return applyServerDirectGatewayState({ serverId, enabled });
}

export async function createServerProfile(input: CreateServerInput) {
 const payload = createServerSchema.parse(input);
 const normalized = normalizeServerInput(payload);

 if (normalized.connectionType === "SSH_KEY") {
  if (!normalized.sshKeyId) throw new Error("SSH 密钥连接方式需选择密钥");
  const sshKey = await prisma.sshKey.findUnique({ where: { id: normalized.sshKeyId }, select: { id: true, name: true, fingerprint: true } });
  if (!sshKey) throw new Error("所选 SSH 密钥不存在或已被删除");
 }

 const server = await prisma.server.create({
  data: {
   name: normalized.name,
   host: normalized.host,
   port: normalized.port,
   username: normalized.username,
   description: normalized.description,
   tags: normalized.tags,
   connectionType: normalized.connectionType,
   sshKeyId: normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId : null,
   password: normalized.connectionType === "PASSWORD" && normalized.password ? encryptServerPasswordIfPlain(normalized.password) : null,
   enabled: true,
  },
  include: { sshKey: { select: { id: true, name: true, fingerprint: true, publicKey: true, privateKey: true, createdAt: true } }, storageNode: { select: { id: true, name: true, driver: true, isDefault: true, basePath: true, directAccessMode: true, publicBaseUrl: true } }, commandTargets: { select: { id: true, status: true, commandRequest: { select: { id: true, title: true, initiatedByType: true, status: true, createdAt: true } } }, orderBy: { commandRequest: { createdAt: "desc" } }, take: 3 } },
 });

 // Auto-create associated storage node
 const storageNodeName = `${server.name} 存储`;
 const isLocalHost = /^(127\.0\.0\.1|localhost|::1|0\.0\.0\.0)$/i.test(normalized.host.trim());
 const existingNode = await prisma.storageNode.findFirst({ where: { name: storageNodeName } });
 if (!existingNode) {
 const defaultCount = await prisma.storageNode.count({ where: { isDefault: true } });
 await prisma.storageNode.create({
 data: {
 name: storageNodeName,
 driver: isLocalHost ? "LOCAL" : "SFTP",
 basePath: isLocalHost ? `/srv/storage/${server.name}` : "/root",
 isDefault: defaultCount === 0,
 serverId: isLocalHost ? null : server.id,
 },
 });

 // Ensure basePath exists on disk for LOCAL nodes
 if (isLocalHost) {
 try {
 await mkdir(`/srv/storage/${server.name}`, { recursive: true });
 } catch {
 // Directory may already exist or FS unavailable — DB record proceeds regardless
 }
 }
 }

 if (payload.enableDirectGateway && !isLocalHost) {
  await applyServerDirectGatewayState({ serverId: server.id, enabled: true });
 }

 // Re-fetch to include the newly created storageNode relation
 const refreshed = await prisma.server.findUnique({
 where: { id: server.id },
 include: { sshKey: { select: { id: true, name: true, fingerprint: true, publicKey: true, privateKey: true, createdAt: true } }, storageNode: { select: { id: true, name: true, driver: true, isDefault: true, basePath: true, directAccessMode: true, publicBaseUrl: true } }, commandTargets: { select: { id: true, status: true, commandRequest: { select: { id: true, title: true, initiatedByType: true, status: true, createdAt: true } } }, orderBy: { commandRequest: { createdAt: "desc" } }, take: 3 } },
 });

 revalidatePath("/storage");
 revalidatePath("/files");

 return enrichServer(refreshed!);
}

export async function updateServerProfile(serverId: string, input: Partial<CreateServerInput> & { enabled?: boolean }) {
 const current = await prisma.server.findUnique({ where: { id: serverId }, include: { sshKey: { select: { name: true } }, commandTargets: { select: { id: true, status: true, commandRequest: { select: { id: true, title: true, initiatedByType: true, status: true, createdAt: true } } }, orderBy: { commandRequest: { createdAt: "desc" } }, take: 3 }, storageNode: { select: { id: true, name: true, driver: true, isDefault: true, basePath: true, directAccessMode: true, publicBaseUrl: true } } } });
 if (!current) throw new Error("VPS 节点不存在或已删除");

 const connectionType = input.connectionType ?? current.connectionType;
 const normalized = normalizeServerInput({
  name: input.name ?? current.name,
  host: input.host ?? current.host,
  port: input.port ? Number(input.port) : current.port,
  username: input.username ?? current.username,
  connectionType,
  sshKeyId: input.sshKeyId ?? current.sshKeyId ?? undefined,
  password: input.password ?? current.password ?? undefined,
  tags: input.tags ?? current.tags,
  description: input.description ?? current.description,
 });

 if (normalized.connectionType === "SSH_KEY" && normalized.sshKeyId && normalized.sshKeyId !== current.sshKeyId) {
  const sshKey = await prisma.sshKey.findUnique({ where: { id: normalized.sshKeyId }, select: { id: true } });
  if (!sshKey) throw new Error("所选 SSH 密钥不存在或已被删除");
 }

 const updated = await prisma.server.update({
  where: { id: serverId },
  data: {
   name: normalized.name,
   host: normalized.host,
   port: normalized.port,
   username: normalized.username,
   connectionType: normalized.connectionType,
   sshKeyId: normalized.connectionType === "SSH_KEY" ? normalized.sshKeyId : null,
   password: normalized.connectionType === "PASSWORD" && normalized.password ? encryptServerPasswordIfPlain(normalized.password) : null,
   description: normalized.description,
   tags: normalized.tags,
   enabled: typeof input.enabled === "boolean" ? input.enabled : current.enabled,
  },
  include: { sshKey: { select: { id: true, name: true, fingerprint: true, publicKey: true, privateKey: true, createdAt: true } }, storageNode: { select: { id: true, name: true, driver: true, isDefault: true, basePath: true, directAccessMode: true, publicBaseUrl: true } }, commandTargets: { select: { id: true, status: true, commandRequest: { select: { id: true, title: true, initiatedByType: true, status: true, createdAt: true } } }, orderBy: { commandRequest: { createdAt: "desc" } }, take: 3 } },
 });

 return enrichServer(updated);
}

export async function toggleServerEnabled(serverId: string) {
  const current = await prisma.server.findUnique({ where: { id: serverId }, select: { enabled: true } });
  if (!current) throw new Error("VPS 节点不存在或已删除");
  return prisma.server.update({ where: { id: serverId }, data: { enabled: !current.enabled } });
}

export async function deleteServerProfile(serverId: string) {
  const current = await prisma.server.findUnique({ where: { id: serverId }, include: { sshKey: { select: { privateKey: true } }, storageNode: { select: { basePath: true, driver: true } } } });
  if (!current) throw new Error("VPS 节点不存在或已删除");
  let cleanupSkipped = false;
  if (current.fileProxyPort && current.fileProxyPort > 0) {
    const result = await applyServerDirectGatewayState({ serverId, enabled: false, bestEffort: true });
    cleanupSkipped = result.cleanupSkipped;
  }
  await prisma.server.delete({ where: { id: serverId } });
  return cleanupSkipped ? { deleted: true, cleanupSkipped: true } : { deleted: true };
}

export async function listServerProfiles() {
 const servers = await prisma.server.findMany({
   orderBy: { createdAt: "desc" },
   include: {
    sshKey: { select: { id: true, name: true, fingerprint: true, publicKey: true, privateKey: true, createdAt: true } },
    storageNode: { select: { id: true, name: true, driver: true, isDefault: true, basePath: true, directAccessMode: true, publicBaseUrl: true } },
    commandTargets: {
     select: { id: true, status: true, commandRequest: { select: { id: true, title: true, initiatedByType: true, status: true, createdAt: true } } },
     orderBy: { commandRequest: { createdAt: "desc" } },
     take: 3,
    },
   },
  });

 return servers.map((server) => enrichServer(server));
}
