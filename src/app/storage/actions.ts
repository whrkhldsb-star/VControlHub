"use server";

import { revalidatePath } from "next/cache";

import { writeAuditLog } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { checkStorageNodeHealth, createFileEntry, createStorageNode, listStorageNodes, updateStorageNode, deleteStorageNode } from "@/lib/storage/service";
import { listServerProfiles } from "@/lib/server/service";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import {
  joinStoragePath,
  normalizeStorageEntryName,
  normalizeStorageTargetDirectory,
} from "@/lib/storage/path-utils";

export type StorageActionState = {
  error?: string;
  success?: string;
};

export async function getStorageFormOptions() {
  const [servers, nodes] = await Promise.all([listServerProfiles(), listStorageNodes()]);
  return {
    servers: servers.map((server: (typeof servers)[number]) => ({ id: server.id, name: server.name, host: server.host })),
    nodes: nodes.map((node: (typeof nodes)[number]) => ({ id: node.id, name: node.name, driver: node.driver })),
  };
}

export async function checkStorageNodeHealthAction(storageNodeId: string) {
  await requirePermission("storage:manage-node");

  try {
    const result = await checkStorageNodeHealth(storageNodeId);
    revalidatePath("/storage");
    revalidatePath("/files");
    return {
      success: `节点健康检查完成：${result.healthStatus === "HEALTHY" ? "健康" : "异常"}`,
      health: result,
    } satisfies StorageActionState & { health: Awaited<ReturnType<typeof checkStorageNodeHealth>> };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "节点健康检查失败" } satisfies StorageActionState;
  }
}

export async function createStorageNodeAction(_prev: StorageActionState | null, formData: FormData) {
  await requirePermission("storage:manage-node");

  try {
    const driver = String(formData.get("driver") ?? "LOCAL").toUpperCase() as "LOCAL" | "SFTP";
    const portRaw = String(formData.get("port") ?? "").trim();
    const serverIdRaw = String(formData.get("serverId") ?? "").trim();
    const hostRaw = String(formData.get("host") ?? "").trim();
    const usernameRaw = String(formData.get("username") ?? "").trim();

    await createStorageNode({
      name: String(formData.get("name") ?? ""),
      driver,
      isDefault: String(formData.get("isDefault") ?? "") === "on",
      basePath: String(formData.get("basePath") ?? ""),
      serverId: serverIdRaw || undefined,
      host: hostRaw || undefined,
      port: portRaw ? Number(portRaw) : undefined,
      username: usernameRaw || undefined,
    });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: "存储节点已创建。" } satisfies StorageActionState;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "创建存储节点失败" } satisfies StorageActionState;
  }
}

export async function createFolderAction(_prev: StorageActionState | null, formData: FormData) {
  await requirePermission("storage:write");

  try {
    const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();
    const currentPathResult = normalizeStorageTargetDirectory(String(formData.get("currentPath") ?? ""));
    if (!currentPathResult.ok) {
      return { error: currentPathResult.reason } satisfies StorageActionState;
    }

    const folderNameResult = normalizeStorageEntryName(String(formData.get("folderName") ?? ""));
    if (!folderNameResult.ok) {
      return { error: folderNameResult.reason } satisfies StorageActionState;
    }

    const currentPath = currentPathResult.path;
    const folderName = folderNameResult.path;

    if (!storageNodeId) {
      return { error: "缺少存储节点参数" } satisfies StorageActionState;
    }

    if (!folderName) {
      return { error: "文件夹名称不能为空" } satisfies StorageActionState;
    }

    const pathResult = joinStoragePath(currentPath, folderName);
    if (!pathResult.ok) {
      return { error: pathResult.reason } satisfies StorageActionState;
    }

    const relativePath = pathResult.path;

    const existing = await prisma.fileEntry.findFirst({
      where: {
        storageNodeId,
        relativePath,
        isDeleted: false,
      },
      select: { id: true },
    });

    if (existing) {
      return { error: `路径 /${relativePath} 已存在，请使用其他名称` } satisfies StorageActionState;
    }

  const storageNode = await prisma.storageNode.findUnique({
    where: { id: storageNodeId },
    select: {
      id: true,
      name: true,
      driver: true,
      basePath: true,
      host: true,
      port: true,
      username: true,
      serverId: true,
      server: { select: { id: true, host: true, port: true, username: true, sshKeyId: true, sshKey: { select: { privateKey: true } } } },
    },
  });

  if (!storageNode) {
    return { error: "存储节点不存在" } satisfies StorageActionState;
  }

  if (storageNode.driver === "LOCAL") {
    const { mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    const allowedRoot = path.resolve(storageNode.basePath);
    const absolutePath = path.resolve(allowedRoot, relativePath);
    const relativeToRoot = path.relative(allowedRoot, absolutePath);

    if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
      return { error: "非法路径" } satisfies StorageActionState;
    }

    await mkdir(absolutePath, { recursive: true });
  } else if (storageNode.driver === "SFTP") {
    const { createRemoteDirectory } = await import("@/lib/ssh/client");

    const host = storageNode.host ?? storageNode.server?.host;
    const port = storageNode.port ?? storageNode.server?.port ?? 22;
    const username = storageNode.username ?? storageNode.server?.username;

    if (!host) {
      return { error: "SFTP 节点缺少主机地址" } satisfies StorageActionState;
    }

    const privateKey = storageNode.server?.sshKey?.privateKey;
    if (!privateKey) {
      return { error: "SFTP 节点缺少 SSH 私钥（关联的 VPS 节点未配置私钥）" } satisfies StorageActionState;
    }

    let remotePath: string;
    try {
      remotePath = normalizeRemoteTargetPath(storageNode.basePath, relativePath);
    } catch (error) {
      return { error: error instanceof Error ? error.message : "非法路径" } satisfies StorageActionState;
    }

    await createRemoteDirectory({
      host,
      port,
      username: username ?? "root",
      privateKey,
      remotePath,
    });
  }

    await createFileEntry({
      storageNodeId,
      name: folderName,
      entryType: "DIRECTORY",
      mimeType: "inode/directory",
      relativePath,
    });

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: `文件夹 /${relativePath} 已创建` } satisfies StorageActionState;
  } catch (error) {
    return { error: error instanceof Error ? error.message : "创建文件夹失败" } satisfies StorageActionState;
  }
}

export async function deleteFileEntryAction(_prev: StorageActionState | null, formData: FormData) {
	await requirePermission("storage:delete");

	try {
		const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

		if (!fileEntryId) {
			return { error: "缺少文件条目参数" } satisfies StorageActionState;
		}

		const entry = await prisma.fileEntry.findUnique({
			where: { id: fileEntryId },
			select: { id: true, name: true, entryType: true, relativePath: true, storageNodeId: true, storageNode: { select: { driver: true, basePath: true } } },
		});

		if (!entry) {
			return { error: "文件条目不存在" } satisfies StorageActionState;
		}

		if (entry.entryType === "DIRECTORY") {
			const prefix = entry.relativePath + "/";
			await prisma.fileEntry.updateMany({
				where: {
					storageNodeId: entry.storageNodeId,
					relativePath: { startsWith: prefix },
				},
				data: { isDeleted: true },
			});
		}

		if (entry.storageNode.driver === "LOCAL" && entry.entryType === "FILE") {
			try {
				const { unlink } = await import("node:fs/promises");
				const path = await import("node:path");
				const normalizedRelativePath = entry.relativePath.replace(/^\/+/, "");
				const absolutePath = path.resolve(entry.storageNode.basePath, normalizedRelativePath);
				const allowedRoot = path.resolve(entry.storageNode.basePath);
				const relativeToRoot = path.relative(allowedRoot, absolutePath);

				if (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot)) {
					await unlink(absolutePath);
				}
			} catch {
				// Silently ignore fs errors — DB soft-delete proceeds regardless
			}
		}

		await prisma.fileEntry.update({
			where: { id: fileEntryId },
			data: { isDeleted: true },
		});

		writeAuditLog({
			actorType: "USER",
			action: "storage.file_delete",
			severity: "WARNING",
			detail: { entryId: entry.id, entryName: entry.name },
		}).catch(() => {}); // audit failure must not block or pollute production logs

		revalidatePath("/");
		revalidatePath("/storage");
		revalidatePath("/files");

		return { success: `已将 ${entry.name} 移至回收站` } satisfies StorageActionState;
	} catch (error) {
		return { error: error instanceof Error ? error.message : "删除文件条目失败" } satisfies StorageActionState;
	}
}

export async function restoreFileEntryAction(_prev: StorageActionState | null, formData: FormData) {
	await requirePermission("storage:delete");

	try {
		const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

		if (!fileEntryId) {
			return { error: "缺少文件条目参数" } satisfies StorageActionState;
		}

		const entry = await prisma.fileEntry.findUnique({
			where: { id: fileEntryId },
			select: { id: true, name: true, entryType: true, relativePath: true, storageNodeId: true },
		});

		if (!entry) {
			return { error: "文件条目不存在" } satisfies StorageActionState;
		}

		if (entry.entryType === "DIRECTORY") {
			const prefix = entry.relativePath + "/";
			await prisma.fileEntry.updateMany({
				where: {
					storageNodeId: entry.storageNodeId,
					relativePath: { startsWith: prefix },
				},
				data: { isDeleted: false },
			});
		}

		await prisma.fileEntry.update({
			where: { id: fileEntryId },
			data: { isDeleted: false },
		});

		revalidatePath("/");
		revalidatePath("/storage");
		revalidatePath("/files");

		return { success: `已恢复 ${entry.name}` } satisfies StorageActionState;
	} catch (error) {
		return { error: error instanceof Error ? error.message : "恢复文件条目失败" } satisfies StorageActionState;
	}
}

export async function permanentDeleteFileEntryAction(_prev: StorageActionState | null, formData: FormData) {
	await requirePermission("storage:delete");

	try {
		const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

		if (!fileEntryId) {
			return { error: "缺少文件条目参数" } satisfies StorageActionState;
		}

		const entry = await prisma.fileEntry.findUnique({
			where: { id: fileEntryId },
			select: { id: true, name: true, entryType: true, relativePath: true, storageNodeId: true, storageNode: { select: { driver: true, basePath: true } } },
		});

		if (!entry) {
			return { error: "文件条目不存在" } satisfies StorageActionState;
		}

 if (entry.entryType === "DIRECTORY") {
 const prefix = entry.relativePath + "/";
 await prisma.fileEntry.deleteMany({
 where: {
 storageNodeId: entry.storageNodeId,
 relativePath: { startsWith: prefix },
 },
 });
 }

 if (entry.storageNode.driver === "LOCAL") {
 try {
 const { unlink, rm } = await import("node:fs/promises");
 const path = await import("node:path");
 const normalizedRelativePath = entry.relativePath.replace(/^\/+/, "");
 const absolutePath = path.resolve(entry.storageNode.basePath, normalizedRelativePath);
 const allowedRoot = path.resolve(entry.storageNode.basePath);
 const relativeToRoot = path.relative(allowedRoot, absolutePath);

 if (!relativeToRoot.startsWith("..") && !path.isAbsolute(relativeToRoot)) {
 if (entry.entryType === "FILE") {
 await unlink(absolutePath);
 } else if (entry.entryType === "DIRECTORY") {
 await rm(absolutePath, { recursive: true, force: true });
 }
 }
 } catch {
 // Silently ignore fs errors — DB delete proceeds regardless
 }
 }

		await prisma.fileEntry.delete({
			where: { id: fileEntryId },
		});

		revalidatePath("/");
		revalidatePath("/storage");
		revalidatePath("/files");

		return { success: `已永久删除 ${entry.name}` } satisfies StorageActionState;
	} catch (error) {
		return { error: error instanceof Error ? error.message : "永久删除文件条目失败" } satisfies StorageActionState;
	}
}

export async function renameFileEntryAction(_prev: StorageActionState | null, formData: FormData) {
	await requirePermission("storage:write");

	try {
		const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();
		const newName = String(formData.get("newName") ?? "").trim();

		if (!fileEntryId) {
			return { error: "缺少文件条目参数" } satisfies StorageActionState;
		}

		if (!newName) {
			return { error: "名称不能为空" } satisfies StorageActionState;
		}

		if (/[\\/:*?"<>|]/.test(newName)) {
			return { error: "名称包含非法字符" } satisfies StorageActionState;
		}

		const entry = await prisma.fileEntry.findUnique({
			where: { id: fileEntryId },
			select: { id: true, name: true, entryType: true, relativePath: true, storageNodeId: true, storageNode: { select: { driver: true, basePath: true } } },
		});

		if (!entry) {
			return { error: "文件条目不存在" } satisfies StorageActionState;
		}

		const lastSlashIndex = entry.relativePath.lastIndexOf("/");
		const newRelativePath = lastSlashIndex >= 0
			? entry.relativePath.substring(0, lastSlashIndex + 1) + newName
			: newName;

		const existing = await prisma.fileEntry.findFirst({
			where: {
				storageNodeId: entry.storageNodeId,
				relativePath: newRelativePath,
				isDeleted: false,
				id: { not: fileEntryId },
			},
			select: { id: true },
		});

		if (existing) {
			return { error: `路径 /${newRelativePath} 已存在，请使用其他名称` } satisfies StorageActionState;
		}

		if (entry.entryType === "DIRECTORY") {
			const oldPrefix = entry.relativePath + "/";
			const newPrefix = newRelativePath + "/";
			const children = await prisma.fileEntry.findMany({
				where: {
					storageNodeId: entry.storageNodeId,
					relativePath: { startsWith: oldPrefix },
				},
				select: { id: true, relativePath: true },
			});

 for (const child of children) {
 await prisma.fileEntry.update({
 where: { id: child.id },
 data: { relativePath: newPrefix + child.relativePath.slice(oldPrefix.length) },
 });
 }
		}

		await prisma.fileEntry.update({
			where: { id: fileEntryId },
			data: { name: newName, relativePath: newRelativePath },
		});

		if (entry.storageNode.driver === "LOCAL") {
			try {
				const { rename } = await import("node:fs/promises");
				const path = await import("node:path");
				const normalizedOldRelativePath = entry.relativePath.replace(/^\/+/, "");
				const normalizedNewRelativePath = newRelativePath.replace(/^\/+/, "");
				const oldAbsolutePath = path.resolve(entry.storageNode.basePath, normalizedOldRelativePath);
				const newAbsolutePath = path.resolve(entry.storageNode.basePath, normalizedNewRelativePath);
				const allowedRoot = path.resolve(entry.storageNode.basePath);
				const oldRelativeToRoot = path.relative(allowedRoot, oldAbsolutePath);
				const newRelativeToRoot = path.relative(allowedRoot, newAbsolutePath);

				if (
					!oldRelativeToRoot.startsWith("..") && !path.isAbsolute(oldRelativeToRoot) &&
					!newRelativeToRoot.startsWith("..") && !path.isAbsolute(newRelativeToRoot)
				) {
					await rename(oldAbsolutePath, newAbsolutePath);
				}
			} catch {
				// Silently ignore fs errors — DB rename proceeds regardless
			}
		}

		revalidatePath("/");
		revalidatePath("/storage");
		revalidatePath("/files");

		return { success: `已重命名为 ${newName}` } satisfies StorageActionState;
	} catch (error) {
		return { error: error instanceof Error ? error.message : "重命名文件条目失败" } satisfies StorageActionState;
	}
}

export async function updateStorageNodeAction(_prev: StorageActionState | null, formData: FormData) {
	await requirePermission("storage:manage-node");

	try {
		const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();
		const driver = String(formData.get("driver") ?? "").trim().toUpperCase() as "LOCAL" | "SFTP" | "";
		const portRaw = String(formData.get("port") ?? "").trim();
		const serverIdRaw = String(formData.get("serverId") ?? "").trim();
		const hostRaw = String(formData.get("host") ?? "").trim();
		const usernameRaw = String(formData.get("username") ?? "").trim();
		const isDefaultRaw = String(formData.get("isDefault") ?? "").trim();

		if (!storageNodeId) {
			return { error: "缺少存储节点参数" } satisfies StorageActionState;
		}

		await updateStorageNode({
			storageNodeId,
			name: String(formData.get("name") ?? "").trim() || undefined,
			driver: driver === "LOCAL" || driver === "SFTP" ? driver : undefined,
			basePath: String(formData.get("basePath") ?? "").trim() || undefined,
			isDefault: isDefaultRaw === "on" ? true : isDefaultRaw === "off" ? false : undefined,
			serverId: serverIdRaw || undefined,
			host: hostRaw || undefined,
			port: portRaw ? Number(portRaw) : undefined,
			username: usernameRaw || undefined,
		});

		revalidatePath("/");
		revalidatePath("/servers");
		revalidatePath("/storage");
		revalidatePath("/files");

		return { success: "存储节点已更新。" } satisfies StorageActionState;
	} catch (error) {
		return { error: error instanceof Error ? error.message : "更新存储节点失败" } satisfies StorageActionState;
	}
}

export async function deleteStorageNodeAction(_prev: StorageActionState | null, formData: FormData) {
	await requirePermission("storage:manage-node");

	try {
		const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();

		if (!storageNodeId) {
			return { error: "缺少存储节点参数" } satisfies StorageActionState;
		}

		await deleteStorageNode(storageNodeId);

		revalidatePath("/");
		revalidatePath("/servers");
		revalidatePath("/storage");
		revalidatePath("/files");

		return { success: "存储节点已删除。" } satisfies StorageActionState;
	} catch (error) {
		return { error: error instanceof Error ? error.message : "删除存储节点失败" } satisfies StorageActionState;
	}
}
