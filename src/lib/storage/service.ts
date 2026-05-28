import { constants as fsConstants } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { normalizeRemotePath } from "@/lib/storage/remote-path";

import {
	createFileEntrySchema,
	createStorageNodeSchema,
	fileEntryMutationSchema,
	updateFileEntrySchema,
	updateStorageNodeSchema,
	type CreateFileEntryInput,
	type CreateStorageNodeInput,
	type FileEntryMutationInput,
	type UpdateFileEntryInput,
	type UpdateStorageNodeInput,
} from "./schema";
import {
	EDITABLE_TEXT_MIME_PREFIXES,
	EDITABLE_TEXT_MIME_TYPES,
	EDITABLE_TEXT_EXTENSIONS,
	MAX_EDITABLE_FILE_SIZE_BYTES,
	isPreviewableMime,
} from "./mime-constants";

type StorageNodeListRow = Prisma.StorageNodeGetPayload<{
  include: {
    server: { select: { id: true; name: true; host: true; port: true; username: true } };
    fileEntries: { select: { id: true } };
  };
}>;
type FileEntryListRow = Prisma.FileEntryGetPayload<{
  include: {
    storageNode: {
      select: {
        id: true;
        name: true;
        driver: true;
        basePath: true;
        host: true;
        port: true;
        username: true;
        directAccessMode: true;
        publicBaseUrl: true;
        directAccessExpiresSeconds: true;
        server: { select: { id: true; name: true; host: true; port: true } };
      };
    };
  };
}>;
type DeletedFileEntryRow = Prisma.FileEntryGetPayload<{
  include: {
    storageNode: { select: { id: true; name: true; driver: true; host: true; port: true; server: { select: { host: true; port: true } } } };
  };
}>;

function buildStorageConnectionSummary(input: {
  driver: "LOCAL" | "SFTP";
  basePath: string;
  host?: string | null;
  port?: number | null;
  username?: string | null;
  serverName?: string | null;
}) {
  if (input.driver === "LOCAL") {
    return `本机存储：${input.basePath}`;
  }

  const remote = `${input.username ?? "root"}@${input.host ?? "unknown"}:${input.port ?? 22}`;
  const serverHint = input.serverName ? `（绑定节点 ${input.serverName}）` : "";
  return `SFTP 存储：${remote}${serverHint}，根目录 ${input.basePath}`;
}

function buildDirectAccessStrategy(input: {
  driver: "LOCAL" | "SFTP";
  nodeId: string;
  host?: string | null;
  port?: number | null;
  relativePath?: string | null;
  directAccessMode?: "PROXY" | "DIRECT" | "AUTO" | null;
  publicBaseUrl?: string | null;
  directAccessExpiresSeconds?: number | null;
}) {
  if (input.driver === "LOCAL") {
    return {
      mode: "managed-download" as const,
      description: "本机文件由管理端直接提供受控下载与预览。",
      href: input.relativePath ? `/api/storage/local?path=${encodeURIComponent(input.relativePath)}` : null,
    };
  }

  const host = input.host ?? "unknown";
  const port = input.port ?? 22;
  const params = new URLSearchParams({ nodeId: input.nodeId, path: input.relativePath ?? "" });
  const fallbackHref = `/api/storage/sftp-download?${params.toString()}`;
  const directParams = new URLSearchParams({ nodeId: input.nodeId, path: input.relativePath ?? "" });
  const directHref = `/api/storage/direct-access?${directParams.toString()}`;
  const mode = input.directAccessMode ?? "PROXY";

  if ((mode === "DIRECT" || mode === "AUTO") && input.publicBaseUrl) {
    return {
      mode: "direct-url" as const,
      description: `远端文件可切换为存储服务器直连（${mode === "AUTO" ? "自动优先直连" : "直连模式"}），不可用时回退到管理端 SFTP 中转（来自 ${host}:${port}）。`,
      href: directHref,
      fallbackHref,
      publicBaseUrl: input.publicBaseUrl,
      expiresSeconds: input.directAccessExpiresSeconds ?? 300,
    };
  }

  return {
    mode: "managed-download" as const,
    description: `远端文件经管理端 SFTP 代理中转下载（来自 ${host}:${port}）。`,
    href: fallbackHref,
  };
}

function resolveLocalAbsolutePath(basePath: string, relativePath: string) {
  const normalizedRelativePath = relativePath.replace(/^\/+/, "");
  const allowedRoot = path.resolve(basePath);
  const absolutePath = path.resolve(allowedRoot, normalizedRelativePath);
  const relativeToRoot = path.relative(allowedRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("非法路径");
  }

  return absolutePath;
}

function isEditableTextFile(input: { entryType: "FILE" | "DIRECTORY"; name: string; mimeType?: string | null }) {
  if (input.entryType !== "FILE") {
    return false;
  }

  if (input.mimeType) {
    const normalizedMimeType = input.mimeType.toLowerCase();
    if (EDITABLE_TEXT_MIME_PREFIXES.some((prefix) => normalizedMimeType.startsWith(prefix))) {
      return true;
    }

    if (EDITABLE_TEXT_MIME_TYPES.has(normalizedMimeType)) {
      return true;
    }
  }

  return EDITABLE_TEXT_EXTENSIONS.has(path.extname(input.name).toLowerCase());
}

async function resolveLocalEditableFileEntry(fileEntryId: string) {
  const entry = await prisma.fileEntry.findUnique({
    where: { id: fileEntryId },
    include: {
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          basePath: true,
        },
      },
    },
  });

  if (!entry || entry.isDeleted) {
    throw new Error("文件条目不存在或已删除");
  }

  if (entry.storageNode.driver !== "LOCAL") {
    throw new Error("仅支持编辑已上传到当前服务器本机存储节点的文件");
  }

  if (!isEditableTextFile({ entryType: entry.entryType, name: entry.name, mimeType: entry.mimeType })) {
    throw new Error("当前仅支持编辑文本类文件");
  }

  const absolutePath = resolveLocalAbsolutePath(entry.storageNode.basePath, entry.relativePath);
  await access(absolutePath);
  const fileStat = await stat(absolutePath);

  if (!fileStat.isFile()) {
    throw new Error("目标不是可编辑文件");
  }

  if (fileStat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
    throw new Error("文件超过 512 KB，暂不支持在线编辑");
  }

  return { entry, absolutePath, fileStat };
}

async function ensureDefaultNodeState(isDefault?: boolean) {
  if (isDefault) {
    await prisma.storageNode.updateMany({ where: {}, data: { isDefault: false } });
  }
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export type StorageNodeHealthStatus = "UNKNOWN" | "HEALTHY" | "UNHEALTHY";

function sanitizeHealthError(error: unknown) {
  const rawMessage = error instanceof Error ? error.message : String(error || "健康检查失败");
  return rawMessage
    .replace(/-----BEGIN[\s\S]*?-----END[^\n]+-----/g, "[REDACTED]")
    .replace(/SECRET/gi, "[REDACTED]")
    .slice(0, 500);
}

function serializeHealthFields(node: {
  healthStatus?: string | null;
  lastHealthCheckAt?: Date | string | null;
  lastHealthError?: string | null;
  lastHealthLatencyMs?: number | null;
}) {
  return {
    healthStatus: (node.healthStatus ?? "UNKNOWN") as StorageNodeHealthStatus,
    lastHealthCheckAt: node.lastHealthCheckAt
      ? (typeof node.lastHealthCheckAt === "string" ? node.lastHealthCheckAt : node.lastHealthCheckAt.toISOString())
      : null,
    lastHealthError: node.lastHealthError ?? null,
    lastHealthLatencyMs: node.lastHealthLatencyMs ?? null,
  };
}

export async function checkStorageNodeHealth(storageNodeId: string) {
  const node = await prisma.storageNode.findUnique({
    where: { id: storageNodeId },
    include: {
      server: {
        select: {
          host: true,
          port: true,
          username: true,
          password: true,
          sshKeyId: true,
          sshKey: { select: { privateKey: true } },
        },
      },
    },
  });

  if (!node) {
    throw new Error("存储节点不存在或已删除");
  }

  const startedAt = Date.now();
  let healthStatus: StorageNodeHealthStatus = "HEALTHY";
  let lastHealthError: string | null = null;

  try {
    if (node.driver === "LOCAL") {
      const baseStat = await stat(node.basePath);
      if (!baseStat.isDirectory()) {
        throw new Error("本机存储根路径不是目录");
      }
      await access(node.basePath, fsConstants.R_OK | fsConstants.W_OK);
    } else if (node.driver === "SFTP") {
      const host = node.host ?? node.server?.host;
      const port = node.port ?? node.server?.port ?? 22;
      const username = node.username ?? node.server?.username ?? "root";
      const privateKey = node.server?.sshKey?.privateKey ? decryptSshPrivateKey(node.server.sshKey.privateKey) : undefined;
      const password = node.server?.password ? decryptServerPassword(node.server.password) : undefined;

      if (!host) {
        throw new Error("SFTP 节点缺少主机地址");
      }
      if (!privateKey && !password) {
        throw new Error("SFTP 节点缺少 SSH 凭据");
      }

      await listRemoteDirectory({
        host,
        port,
        username,
        privateKey,
        password,
        remotePath: normalizeRemotePath(node.basePath, ""),
      });
    }
  } catch (error) {
    healthStatus = "UNHEALTHY";
    lastHealthError = sanitizeHealthError(error);
  }

  const lastHealthLatencyMs = Math.max(0, Date.now() - startedAt);
  const updated = await prisma.storageNode.update({
    where: { id: storageNodeId },
    data: {
      healthStatus,
      lastHealthCheckAt: new Date(),
      lastHealthError,
      lastHealthLatencyMs,
    },
  });

  return {
    id: updated.id,
    ...serializeHealthFields(updated),
  };
}

export async function createStorageNode(input: CreateStorageNodeInput) {
  const payload = createStorageNodeSchema.parse(input);

  if (payload.driver === "SFTP" && !payload.serverId && !payload.host) {
    throw new Error("SFTP 存储节点必须绑定 VPS 节点或指定远端主机");
  }

  await ensureDefaultNodeState(payload.isDefault);

  const storageNode = await prisma.storageNode.create({
    data: {
      name: payload.name,
      driver: payload.driver,
      basePath: payload.basePath,
      isDefault: payload.isDefault,
      host: payload.host,
      port: payload.port,
      username: payload.username,
      serverId: payload.serverId,
      directAccessMode: payload.directAccessMode,
      publicBaseUrl: payload.publicBaseUrl || null,
      directAccessExpiresSeconds: payload.directAccessExpiresSeconds,
    },
    include: {
      server: {
        select: { id: true, name: true, host: true, port: true, username: true },
      },
    },
  });

  return {
    ...storageNode,
    connectionSummary: buildStorageConnectionSummary({
      driver: storageNode.driver,
      basePath: storageNode.basePath,
      host: storageNode.host ?? storageNode.server?.host,
      port: storageNode.port ?? storageNode.server?.port,
      username: storageNode.username ?? storageNode.server?.username,
      serverName: storageNode.server?.name,
    }),
 directAccess: buildDirectAccessStrategy({
 driver: storageNode.driver,
 nodeId: storageNode.id,
 host: storageNode.host ?? storageNode.server?.host,
 port: storageNode.port ?? storageNode.server?.port,
 directAccessMode: storageNode.directAccessMode,
 publicBaseUrl: storageNode.publicBaseUrl,
 directAccessExpiresSeconds: storageNode.directAccessExpiresSeconds,
 }),
  };
}

export async function updateStorageNode(input: UpdateStorageNodeInput) {
  const payload = updateStorageNodeSchema.parse(input);
  const current = await prisma.storageNode.findUnique({
    where: { id: payload.storageNodeId },
    include: { server: { select: { id: true, name: true, host: true, port: true, username: true } } },
  });

  if (!current) {
    throw new Error("存储节点不存在或已删除");
  }

  const nextDriver = payload.driver ?? current.driver;
  const nextServerId = payload.serverId ?? current.serverId ?? undefined;
  const nextHost = payload.host ?? current.host ?? undefined;

  if (nextDriver === "SFTP" && !nextServerId && !nextHost) {
    throw new Error("SFTP 存储节点必须绑定 VPS 节点或指定远端主机");
  }

  await ensureDefaultNodeState(payload.isDefault);

  return prisma.storageNode.update({
    where: { id: payload.storageNodeId },
    data: {
      name: payload.name ?? current.name,
      driver: nextDriver,
      basePath: payload.basePath ?? current.basePath,
      isDefault: payload.isDefault ?? current.isDefault,
      host: payload.host ?? current.host,
      port: payload.port ?? current.port,
      username: payload.username ?? current.username,
      serverId: payload.serverId ?? current.serverId,
      directAccessMode: payload.directAccessMode ?? current.directAccessMode,
      publicBaseUrl: payload.publicBaseUrl === undefined ? current.publicBaseUrl : (payload.publicBaseUrl || null),
      directAccessExpiresSeconds: payload.directAccessExpiresSeconds ?? current.directAccessExpiresSeconds,
    },
  });
}

export async function deleteStorageNode(storageNodeId: string) {
  const node = await prisma.storageNode.findUnique({
    where: { id: storageNodeId },
    include: { fileEntries: { select: { id: true, isDeleted: true } } },
  });

  if (!node) {
    throw new Error("存储节点不存在或已删除");
  }

  const activeEntryCount = node.fileEntries.filter((entry: { isDeleted: boolean }) => !entry.isDeleted).length;
  if (activeEntryCount > 0) {
    throw new Error("该存储节点下仍有文件条目，请先删除或迁移文件后再移除节点");
  }

  await prisma.storageNode.delete({ where: { id: storageNodeId } });
  return { deleted: true };
}

export async function listStorageNodes() {
 const nodes = await prisma.storageNode.findMany({
      orderBy: [{ isDefault: "desc" }, { createdAt: "desc" }],
      include: {
        server: { select: { id: true, name: true, host: true, port: true, username: true } },
        fileEntries: { where: { isDeleted: false }, select: { id: true } },
      },
    });

	return nodes.map((node: StorageNodeListRow) => ({
		id: node.id,
		name: node.name,
		driver: node.driver,
		isDefault: node.isDefault,
		basePath: node.basePath,
		host: node.host,
		port: node.port,
		username: node.username,
		serverId: node.serverId,
		directAccessMode: node.directAccessMode,
		publicBaseUrl: node.publicBaseUrl,
		directAccessExpiresSeconds: node.directAccessExpiresSeconds,
		createdAt: node.createdAt?.toISOString?.() ?? node.createdAt,
		updatedAt: node.updatedAt?.toISOString?.() ?? node.updatedAt,
		...serializeHealthFields(node),
		server: node.server,
		fileCount: node.fileEntries.length,
      connectionSummary: buildStorageConnectionSummary({
        driver: node.driver,
        basePath: node.basePath,
        host: node.host ?? node.server?.host,
        port: node.port ?? node.server?.port,
        username: node.username ?? node.server?.username,
        serverName: node.server?.name,
      }),
 directAccess: buildDirectAccessStrategy({
 driver: node.driver,
 nodeId: node.id,
 host: node.host ?? node.server?.host,
 port: node.port ?? node.server?.port,
 directAccessMode: node.directAccessMode,
 publicBaseUrl: node.publicBaseUrl,
 directAccessExpiresSeconds: node.directAccessExpiresSeconds,
 }),
 }));
}

export async function createFileEntry(input: CreateFileEntryInput) {
 const payload = createFileEntrySchema.parse(input);

 // Check for duplicate entry (same node + same relativePath)
 const existing = await prisma.fileEntry.findFirst({
 where: {
 storageNodeId: payload.storageNodeId,
 relativePath: payload.relativePath,
 isDeleted: false,
 },
 select: { id: true },
 });
 if (existing) {
 throw new Error(`路径已存在: ${payload.relativePath}`);
 }

 return prisma.fileEntry.create({
 data: {
 storageNodeId: payload.storageNodeId,
 name: payload.name,
 entryType: payload.entryType,
 mimeType: payload.mimeType,
 size: payload.size == null ? undefined : BigInt(payload.size),
 checksumSha256: payload.checksumSha256,
 relativePath: payload.relativePath,
 parentId: payload.parentId,
 },
 });
}

export async function updateFileEntry(input: UpdateFileEntryInput) {
  const payload = updateFileEntrySchema.parse(input);
  const current = await prisma.fileEntry.findUnique({ where: { id: payload.fileEntryId } });

  if (!current) {
    throw new Error("文件条目不存在或已删除");
  }

  return prisma.fileEntry.update({
    where: { id: payload.fileEntryId },
    data: {
      storageNodeId: payload.storageNodeId ?? current.storageNodeId,
      name: payload.name ?? current.name,
      mimeType: payload.mimeType ?? current.mimeType,
      size: payload.size == null ? current.size : BigInt(payload.size),
      checksumSha256: payload.checksumSha256 ?? current.checksumSha256,
      relativePath: payload.relativePath ?? current.relativePath,
      parentId: payload.parentId ?? current.parentId,
    },
  });
}

export async function softDeleteFileEntry(input: FileEntryMutationInput) {
  const payload = fileEntryMutationSchema.parse(input);
  const current = await prisma.fileEntry.findUnique({ where: { id: payload.fileEntryId } });

  if (!current) {
    throw new Error("文件条目不存在或已删除");
  }

  return prisma.fileEntry.update({
    where: { id: payload.fileEntryId },
    data: { isDeleted: true },
  });
}

export async function restoreFileEntry(input: FileEntryMutationInput) {
  const payload = fileEntryMutationSchema.parse(input);
  const current = await prisma.fileEntry.findUnique({ where: { id: payload.fileEntryId } });

  if (!current) {
    throw new Error("文件条目不存在或已删除");
  }

  return prisma.fileEntry.update({
    where: { id: payload.fileEntryId },
    data: { isDeleted: false },
  });
}

export async function listFileEntries(storageNodeId?: string) {
 const where = {
      isDeleted: false,
      ...(storageNodeId ? { storageNodeId } : {}),
    };

    const entries = await prisma.fileEntry.findMany({
      where,
      orderBy: [{ entryType: "asc" }, { relativePath: "asc" }],
      include: {
        storageNode: {
          select: {
            id: true,
            name: true,
            driver: true,
            basePath: true,
            host: true,
            port: true,
            username: true,
            directAccessMode: true,
            publicBaseUrl: true,
            directAccessExpiresSeconds: true,
            server: { select: { id: true, name: true, host: true, port: true } },
          },
        },
      },
    });

	return entries.map((entry: FileEntryListRow) => {
			const directAccess = buildDirectAccessStrategy({
				driver: entry.storageNode.driver,
				nodeId: entry.storageNode.id,
				host: entry.storageNode.host ?? entry.storageNode.server?.host,
				port: entry.storageNode.port ?? entry.storageNode.server?.port,
				relativePath: entry.relativePath,
				directAccessMode: entry.storageNode.directAccessMode,
				publicBaseUrl: entry.storageNode.publicBaseUrl,
				directAccessExpiresSeconds: entry.storageNode.directAccessExpiresSeconds,
			});

			return {
				id: entry.id,
				storageNodeId: entry.storageNodeId,
				name: entry.name,
				entryType: entry.entryType,
				mimeType: entry.mimeType,
				size: entry.size,
				checksumSha256: entry.checksumSha256,
				relativePath: entry.relativePath,
				parentId: entry.parentId,
				isDeleted: entry.isDeleted,
				createdAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
				updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
				storageNode: entry.storageNode,
				sizeLabel: entry.size == null ? "-" : formatFileSize(Number(entry.size)),
				directAccess,
				localEditable: entry.storageNode.driver === "LOCAL" && isEditableTextFile({ entryType: entry.entryType, name: entry.name, mimeType: entry.mimeType }),
				previewable: isPreviewableMime(entry.mimeType),
			};
 });
}

export async function listDeletedFileEntries(storageNodeId?: string) {
  const where = {
    isDeleted: true,
    ...(storageNodeId ? { storageNodeId } : {}),
  };

  const entries = await prisma.fileEntry.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: {
      storageNode: { select: { id: true, name: true, driver: true, host: true, port: true, server: { select: { host: true, port: true } } } },
    },
  });

	return entries.map((entry: DeletedFileEntryRow) => ({
		id: entry.id,
		storageNodeId: entry.storageNodeId,
		name: entry.name,
		entryType: entry.entryType,
		mimeType: entry.mimeType,
		size: entry.size,
		checksumSha256: entry.checksumSha256,
		relativePath: entry.relativePath,
		parentId: entry.parentId,
		isDeleted: entry.isDeleted,
		createdAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
		updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
		storageNode: entry.storageNode,
		sizeLabel: entry.size == null ? "-" : formatFileSize(Number(entry.size)),
	}));
}

type DirectorySummary = {
  storageNodeId: string;
  storageNodeName: string;
  storageNodeDriver: "LOCAL" | "SFTP";
  path: string;
  name: string;
  itemCount: number;
};

function buildDirectorySummaries(entries: Awaited<ReturnType<typeof listFileEntries>>) {
  const directories = new Map<string, DirectorySummary>();

  const registerDirectory = (input: { storageNodeId: string; storageNodeName: string; storageNodeDriver: "LOCAL" | "SFTP"; path: string }) => {
    const normalizedPath = input.path.replace(/^\/+|\/+$/g, "");
    if (!normalizedPath) {
      return;
    }

    const existing = directories.get(normalizedPath);
    if (existing) {
      existing.itemCount += 1;
      return;
    }

    const segments = normalizedPath.split("/").filter(Boolean);
    directories.set(normalizedPath, {
      storageNodeId: input.storageNodeId,
      storageNodeName: input.storageNodeName,
      storageNodeDriver: input.storageNodeDriver,
      path: normalizedPath,
      name: segments.at(-1) ?? normalizedPath,
      itemCount: 1,
    });
  };

  for (const entry of entries) {
    const segments = entry.relativePath.split("/").filter(Boolean);
    if (segments.length === 0) {
      continue;
    }

    const limit = entry.entryType === "DIRECTORY" ? segments.length : segments.length - 1;
    for (let index = 0; index < limit; index += 1) {
      registerDirectory({
        storageNodeId: entry.storageNode.id,
        storageNodeName: entry.storageNode.name,
        storageNodeDriver: entry.storageNode.driver as "LOCAL" | "SFTP",
        path: segments.slice(0, index + 1).join("/"),
      });
    }
  }

  return [...directories.values()].sort((left, right) => left.path.localeCompare(right.path, "zh-CN"));
}

export async function getStorageOverview() {
 const [nodes, entries, deletedEntries] = await Promise.all([listStorageNodes(), listFileEntries(), listDeletedFileEntries()]);
    const remoteDirectories = buildDirectorySummaries(entries);

    return {
      nodes,
      entries,
      deletedEntries,
      remoteDirectories,
      stats: {
        totalNodes: nodes.length,
        defaultNodeName: nodes.find((node: ReturnType<typeof listStorageNodes> extends Promise<Array<infer Row>> ? Row : never) => node.isDefault)?.name ?? "未配置",
        localNodeCount: nodes.filter((node: ReturnType<typeof listStorageNodes> extends Promise<Array<infer Row>> ? Row : never) => node.driver === "LOCAL").length,
        sftpNodeCount: nodes.filter((node: ReturnType<typeof listStorageNodes> extends Promise<Array<infer Row>> ? Row : never) => node.driver === "SFTP").length,
        totalEntries: entries.length,
        previewableEntries: entries.filter((entry: ReturnType<typeof listFileEntries> extends Promise<Array<infer Row>> ? Row : never) => entry.previewable).length,
        deletedEntries: deletedEntries.length,
        remoteDirectoryCount: remoteDirectories.length,
      },
 };
}

export async function getLocalEditableFileDraft(fileEntryId: string) {
  const { entry, fileStat, absolutePath } = await resolveLocalEditableFileEntry(fileEntryId);
  const content = await readFile(absolutePath, "utf8");

  return {
    fileEntryId: entry.id,
    name: entry.name,
    relativePath: entry.relativePath,
    content,
    byteSize: fileStat.size,
	updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
  };
}
