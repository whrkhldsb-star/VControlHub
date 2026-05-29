"use server";

import { revalidatePath } from "next/cache";

import { writeAuditLog } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import {
  checkStorageNodeHealth,
  createFileEntry,
  createStorageNode,
  listStorageNodes,
  updateStorageNode,
  deleteStorageNode,
} from "@/lib/storage/service";
import { listServerProfiles } from "@/lib/server/service";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import {
  joinStoragePath,
  normalizeStorageEntryName,
  normalizeStorageTargetDirectory,
} from "@/lib/storage/path-utils";

export type StorageActionState = {
  error?: string;
  success?: string;
};

async function runSftpRemoteDelete(input: {
  storageNode: {
    driver: string;
    basePath: string;
    host?: string | null;
    port?: number | null;
    username?: string | null;
    server?: {
      host?: string | null;
      port?: number | null;
      username?: string | null;
      connectionType?: string | null;
      password?: string | null;
      sshKey?: { privateKey?: string | null } | null;
    } | null;
  };
  relativePath: string;
  isDirectory: boolean;
}) {
  if (input.storageNode.driver !== "SFTP") return;
  const { deleteRemoteFile } = await import("@/lib/ssh/client");
  const remotePath = normalizeRemoteTargetPath(
    input.storageNode.basePath,
    input.relativePath,
  );
  const credentials = resolveStorageSshCredentials(input.storageNode);
  await deleteRemoteFile({
    ...credentials,
    remotePath,
    isDirectory: input.isDirectory,
  });
}

async function rollbackCreatedFolder(input: {
  storageNode: {
    driver: string;
    basePath: string;
    host?: string | null;
    port?: number | null;
    username?: string | null;
    server?: {
      host?: string | null;
      port?: number | null;
      username?: string | null;
      connectionType?: string | null;
      password?: string | null;
      sshKey?: { privateKey?: string | null } | null;
    } | null;
  };
  relativePath: string;
}) {
  if (input.storageNode.driver === "LOCAL") {
    const { rm } = await import("node:fs/promises");
    const { absolutePath } = await resolveManagedLocalEntryPath({
      basePath: input.storageNode.basePath,
      relativePath: input.relativePath,
    });
    await rm(absolutePath, { recursive: true, force: false });
    return;
  }

  if (input.storageNode.driver === "SFTP") {
    await runSftpRemoteDelete({
      storageNode: input.storageNode,
      relativePath: input.relativePath,
      isDirectory: true,
    });
  }
}

async function runSftpRemoteRename(input: {
  storageNode: {
    driver: string;
    basePath: string;
    host?: string | null;
    port?: number | null;
    username?: string | null;
    server?: {
      host?: string | null;
      port?: number | null;
      username?: string | null;
      connectionType?: string | null;
      password?: string | null;
      sshKey?: { privateKey?: string | null } | null;
    } | null;
  };
  oldRelativePath: string;
  newRelativePath: string;
}) {
  if (input.storageNode.driver !== "SFTP") return;
  const [renameRemoteFile] = await Promise.all([
    import("@/lib/ssh/client").then((mod) => mod.renameRemoteFile),
  ]);
  const oldPath = normalizeRemoteTargetPath(
    input.storageNode.basePath,
    input.oldRelativePath,
  );
  const newPath = normalizeRemoteTargetPath(
    input.storageNode.basePath,
    input.newRelativePath,
  );
  const credentials = resolveStorageSshCredentials(input.storageNode);
  await renameRemoteFile({ ...credentials, oldPath, newPath });
}

async function resolveManagedLocalEntryPath(input: {
  basePath: string;
  relativePath: string;
}) {
  const path = await import("node:path");
  const normalizedRelativePath = input.relativePath.replace(/^\/+/, "");
  const allowedRoot = path.resolve(input.basePath);
  const absolutePath = path.resolve(allowedRoot, normalizedRelativePath);
  const relativeToRoot = path.relative(allowedRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("路径超出存储根目录");
  }

  return { path, absolutePath, allowedRoot };
}

async function runLocalFilesystemDelete(input: {
  storageNode: { driver: string; basePath: string };
  relativePath: string;
  isDirectory: boolean;
}) {
  if (input.storageNode.driver !== "LOCAL") return;
  const { unlink, rm } = await import("node:fs/promises");
  const { absolutePath } = await resolveManagedLocalEntryPath({
    basePath: input.storageNode.basePath,
    relativePath: input.relativePath,
  });

  if (input.isDirectory) {
    await rm(absolutePath, { recursive: true, force: false });
  } else {
    await unlink(absolutePath);
  }
}

async function runLocalFilesystemRename(input: {
  storageNode: { driver: string; basePath: string };
  oldRelativePath: string;
  newRelativePath: string;
}) {
  if (input.storageNode.driver !== "LOCAL") return;
  const { rename, mkdir } = await import("node:fs/promises");
  const oldPath = await resolveManagedLocalEntryPath({
    basePath: input.storageNode.basePath,
    relativePath: input.oldRelativePath,
  });
  const newPath = await resolveManagedLocalEntryPath({
    basePath: input.storageNode.basePath,
    relativePath: input.newRelativePath,
  });
  await mkdir(newPath.path.dirname(newPath.absolutePath), { recursive: true });
  await rename(oldPath.absolutePath, newPath.absolutePath);
}

export async function getStorageFormOptions() {
  const [servers, nodes] = await Promise.all([
    listServerProfiles(),
    listStorageNodes(),
  ]);
  return {
    servers: servers.map((server: (typeof servers)[number]) => ({
      id: server.id,
      name: server.name,
      host: server.host,
    })),
    nodes: nodes.map((node: (typeof nodes)[number]) => ({
      id: node.id,
      name: node.name,
      driver: node.driver,
    })),
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
    } satisfies StorageActionState & {
      health: Awaited<ReturnType<typeof checkStorageNodeHealth>>;
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "节点健康检查失败",
    } satisfies StorageActionState;
  }
}

export async function createStorageNodeAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:manage-node");

  try {
    const driver = String(formData.get("driver") ?? "LOCAL").toUpperCase() as
      | "LOCAL"
      | "SFTP";
    const portRaw = String(formData.get("port") ?? "").trim();
    const serverIdRaw = String(formData.get("serverId") ?? "").trim();
    const hostRaw = String(formData.get("host") ?? "").trim();
    const usernameRaw = String(formData.get("username") ?? "").trim();

    await createStorageNode({
      name: String(formData.get("name") ?? ""),
      driver,
      isDefault: String(formData.get("isDefault") ?? "") === "on",
      basePath: String(formData.get("basePath") ?? ""),
      directAccessMode: String(formData.get("directAccessMode") ?? "PROXY") as
        | "PROXY"
        | "DIRECT"
        | "AUTO",
      publicBaseUrl:
        String(formData.get("publicBaseUrl") ?? "").trim() || undefined,
      directAccessExpiresSeconds: Number(
        String(formData.get("directAccessExpiresSeconds") ?? "300").trim() ||
          300,
      ),
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
    return {
      error: error instanceof Error ? error.message : "创建存储节点失败",
    } satisfies StorageActionState;
  }
}

export async function createFolderAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:write");

  try {
    const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();
    const currentPathResult = normalizeStorageTargetDirectory(
      String(formData.get("currentPath") ?? ""),
    );
    if (!currentPathResult.ok) {
      return { error: currentPathResult.reason } satisfies StorageActionState;
    }

    const folderNameResult = normalizeStorageEntryName(
      String(formData.get("folderName") ?? ""),
    );
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
      return {
        error: `路径 /${relativePath} 已存在，请使用其他名称`,
      } satisfies StorageActionState;
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
        server: {
          select: {
            id: true,
            host: true,
            port: true,
            username: true,
            connectionType: true,
            password: true,
            sshKey: { select: { privateKey: true } },
          },
        },
      },
    });

    if (!storageNode) {
      return { error: "存储节点不存在" } satisfies StorageActionState;
    }

    let folderCreated = false;
    if (storageNode.driver === "LOCAL") {
      const { mkdir } = await import("node:fs/promises");
      const path = await import("node:path");
      const allowedRoot = path.resolve(storageNode.basePath);
      const absolutePath = path.resolve(allowedRoot, relativePath);
      const relativeToRoot = path.relative(allowedRoot, absolutePath);

      if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
        return { error: "非法路径" } satisfies StorageActionState;
      }

      await mkdir(absolutePath, { recursive: false });
      folderCreated = true;
    } else if (storageNode.driver === "SFTP") {
      const { createRemoteDirectory } = await import("@/lib/ssh/client");

      let remotePath: string;
      try {
        remotePath = normalizeRemoteTargetPath(
          storageNode.basePath,
          relativePath,
        );
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "非法路径",
        } satisfies StorageActionState;
      }

      let credentials: ReturnType<typeof resolveStorageSshCredentials>;
      try {
        credentials = resolveStorageSshCredentials(storageNode);
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "连接凭据不可用",
        } satisfies StorageActionState;
      }

      await createRemoteDirectory({
        ...credentials,
        remotePath,
        recursive: false,
      });
      folderCreated = true;
    }

    try {
      await createFileEntry({
        storageNodeId,
        name: folderName,
        entryType: "DIRECTORY",
        mimeType: "inode/directory",
        relativePath,
      });
    } catch (error) {
      if (folderCreated) {
        try {
          await rollbackCreatedFolder({ storageNode, relativePath });
        } catch {
          // Best-effort compensation: preserve the original indexing failure for the UI.
        }
      }
      throw error;
    }

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");

    return {
      success: `文件夹 /${relativePath} 已创建`,
    } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "创建文件夹失败",
    } satisfies StorageActionState;
  }
}

export async function deleteFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:delete");

  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

    if (!fileEntryId) {
      return { error: "缺少文件条目参数" } satisfies StorageActionState;
    }

    const entry = await prisma.fileEntry.findUnique({
      where: { id: fileEntryId },
      select: {
        id: true,
        name: true,
        entryType: true,
        relativePath: true,
        storageNodeId: true,
        storageNode: {
          select: {
            driver: true,
            basePath: true,
            host: true,
            port: true,
            username: true,
            server: {
              select: {
                host: true,
                port: true,
                username: true,
                connectionType: true,
                password: true,
                sshKey: { select: { privateKey: true } },
              },
            },
          },
        },
      },
    });

    if (!entry) {
      return { error: "文件条目不存在" } satisfies StorageActionState;
    }

    await runSftpRemoteDelete({
      storageNode: entry.storageNode,
      relativePath: entry.relativePath,
      isDirectory: entry.entryType === "DIRECTORY",
    });
    await runLocalFilesystemDelete({
      storageNode: entry.storageNode,
      relativePath: entry.relativePath,
      isDirectory: entry.entryType === "DIRECTORY",
    });

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

    return {
      success: `已将 ${entry.name} 移至回收站`,
    } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "删除文件条目失败",
    } satisfies StorageActionState;
  }
}

export async function restoreFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:delete");

  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

    if (!fileEntryId) {
      return { error: "缺少文件条目参数" } satisfies StorageActionState;
    }

    const entry = await prisma.fileEntry.findUnique({
      where: { id: fileEntryId },
      select: {
        id: true,
        name: true,
        entryType: true,
        relativePath: true,
        storageNodeId: true,
      },
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
    return {
      error: error instanceof Error ? error.message : "恢复文件条目失败",
    } satisfies StorageActionState;
  }
}

export async function permanentDeleteFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:delete");

  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

    if (!fileEntryId) {
      return { error: "缺少文件条目参数" } satisfies StorageActionState;
    }

    const entry = await prisma.fileEntry.findUnique({
      where: { id: fileEntryId },
      select: {
        id: true,
        name: true,
        entryType: true,
        relativePath: true,
        storageNodeId: true,
        storageNode: {
          select: {
            driver: true,
            basePath: true,
            host: true,
            port: true,
            username: true,
            server: {
              select: {
                host: true,
                port: true,
                username: true,
                connectionType: true,
                password: true,
                sshKey: { select: { privateKey: true } },
              },
            },
          },
        },
      },
    });

    if (!entry) {
      return { error: "文件条目不存在" } satisfies StorageActionState;
    }

    await runSftpRemoteDelete({
      storageNode: entry.storageNode,
      relativePath: entry.relativePath,
      isDirectory: entry.entryType === "DIRECTORY",
    });
    await runLocalFilesystemDelete({
      storageNode: entry.storageNode,
      relativePath: entry.relativePath,
      isDirectory: entry.entryType === "DIRECTORY",
    });

    if (entry.entryType === "DIRECTORY") {
      const prefix = entry.relativePath + "/";
      await prisma.fileEntry.deleteMany({
        where: {
          storageNodeId: entry.storageNodeId,
          relativePath: { startsWith: prefix },
        },
      });
    }

    await prisma.fileEntry.delete({
      where: { id: fileEntryId },
    });

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: `已永久删除 ${entry.name}` } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "永久删除文件条目失败",
    } satisfies StorageActionState;
  }
}

export async function renameFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
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
      select: {
        id: true,
        name: true,
        entryType: true,
        relativePath: true,
        storageNodeId: true,
        storageNode: {
          select: {
            driver: true,
            basePath: true,
            host: true,
            port: true,
            username: true,
            server: {
              select: {
                host: true,
                port: true,
                username: true,
                connectionType: true,
                password: true,
                sshKey: { select: { privateKey: true } },
              },
            },
          },
        },
      },
    });

    if (!entry) {
      return { error: "文件条目不存在" } satisfies StorageActionState;
    }

    const lastSlashIndex = entry.relativePath.lastIndexOf("/");
    const newRelativePath =
      lastSlashIndex >= 0
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
      return {
        error: `路径 /${newRelativePath} 已存在，请使用其他名称`,
      } satisfies StorageActionState;
    }

    await runSftpRemoteRename({
      storageNode: entry.storageNode,
      oldRelativePath: entry.relativePath,
      newRelativePath,
    });
    await runLocalFilesystemRename({
      storageNode: entry.storageNode,
      oldRelativePath: entry.relativePath,
      newRelativePath,
    });

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
          data: {
            relativePath:
              newPrefix + child.relativePath.slice(oldPrefix.length),
          },
        });
      }
    }

    await prisma.fileEntry.update({
      where: { id: fileEntryId },
      data: { name: newName, relativePath: newRelativePath },
    });

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: `已重命名为 ${newName}` } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "重命名文件条目失败",
    } satisfies StorageActionState;
  }
}

export async function updateStorageNodeAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:manage-node");

  try {
    const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();
    const driver = String(formData.get("driver") ?? "")
      .trim()
      .toUpperCase() as "LOCAL" | "SFTP" | "";
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
      directAccessMode: ["PROXY", "DIRECT", "AUTO"].includes(
        String(formData.get("directAccessMode") ?? ""),
      )
        ? (String(formData.get("directAccessMode")) as
            | "PROXY"
            | "DIRECT"
            | "AUTO")
        : undefined,
      publicBaseUrl: String(formData.get("publicBaseUrl") ?? "").trim(),
      directAccessExpiresSeconds: Number(
        String(formData.get("directAccessExpiresSeconds") ?? "").trim() || 300,
      ),
      isDefault:
        isDefaultRaw === "on"
          ? true
          : isDefaultRaw === "off"
            ? false
            : undefined,
      serverId: serverIdRaw || null,
      host: hostRaw || null,
      port: portRaw ? Number(portRaw) : undefined,
      username: usernameRaw || null,
    });

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: "存储节点已更新。" } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "更新存储节点失败",
    } satisfies StorageActionState;
  }
}

export async function deleteStorageNodeAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
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
    return {
      error: error instanceof Error ? error.message : "删除存储节点失败",
    } satisfies StorageActionState;
  }
}
