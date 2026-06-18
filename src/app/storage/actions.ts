"use server";

import { revalidatePath } from "next/cache";

import { writeAuditLog } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { serverT } from "@/lib/i18n/server-locale";
import {
  checkStorageNodeHealth,
  createFileEntry,
  createStorageNode,
  listStorageNodes,
  updateStorageNode,
  deleteStorageNode,
  restoreFileEntry,
} from "@/lib/storage/service";
import { listServerProfiles } from "@/lib/server/service";
import {
  createManagedFolder,
  deleteBackingObject,
  renameBackingObject,
} from "@/lib/storage/fs-backend";
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

  const t = await serverT();
  try {
    const result = await checkStorageNodeHealth(storageNodeId);
    revalidatePath("/storage");
    revalidatePath("/files");
    const statusLabel = result.healthStatus === "HEALTHY"
      ? t("storagePage.action.healthCheckCompletedHealthy")
      : t("storagePage.action.healthCheckCompletedError");
    return {
      success: t("storagePage.action.healthCheckCompleted").replace("{status}", statusLabel),
      health: result,
    } satisfies StorageActionState & {
      health: Awaited<ReturnType<typeof checkStorageNodeHealth>>;
    };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.healthCheckFailed"),
    } satisfies StorageActionState;
  }
}

export async function createStorageNodeAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:manage-node");

  const t = await serverT();
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

    return { success: t("storagePage.action.createNodeSuccess") } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.createNodeFailed"),
    } satisfies StorageActionState;
  }
}

export async function createFolderAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:write");

  const t = await serverT();
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
      return { error: t("storagePage.action.missingNodeParam") } satisfies StorageActionState;
    }

    if (!folderName) {
      return { error: t("storagePage.action.missingFolderName") } satisfies StorageActionState;
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
        error: t("storagePage.action.folderAlreadyExists").replace("{path}", relativePath),
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
      return { error: t("storagePage.action.nodeNotFound") } satisfies StorageActionState;
    }

    let folderCreated = false;
    try {
      await createManagedFolder({
        storageNode,
        relativePath,
      });
      folderCreated = true;
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : t("storagePage.action.folderCreateFailed"),
      } satisfies StorageActionState;
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
          await deleteBackingObject({
            storageNode,
            relativePath,
            isDirectory: true,
            tolerateMissing: true,
          });
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
      success: t("storagePage.action.folderCreated").replace("{path}", relativePath),
    } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.folderCreateFailed"),
    } satisfies StorageActionState;
  }
}

export async function deleteFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:delete");

  const t = await serverT();
  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

    if (!fileEntryId) {
      return { error: t("storagePage.action.missingFileEntryParam") } satisfies StorageActionState;
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
      return { error: t("storagePage.action.fileEntryNotFound") } satisfies StorageActionState;
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

    await prisma.fileEntry.update({
      where: { id: fileEntryId },
      data: { isDeleted: true },
    });

    let backingDeleteWarning: string | null = null;
    try {
      await deleteBackingObject({
        storageNode: entry.storageNode,
        relativePath: entry.relativePath,
        isDirectory: entry.entryType === "DIRECTORY",
        tolerateMissing: false,
      });
    } catch (error) {
      backingDeleteWarning =
        error instanceof Error ? error.message : t("storagePage.action.physicalFileDeleteFailed");
      writeAuditLog({
        actorType: "SYSTEM",
        action: "storage.file_delete_backing_failed",
        severity: "WARNING",
        detail: {
          entryId: entry.id,
          entryName: entry.name,
          relativePath: entry.relativePath,
          reason: backingDeleteWarning,
        },
      }).catch(() => {});
    }

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
      success: backingDeleteWarning
        ? t("storagePage.action.fileMovedToRecycleWithWarning")
            .replace("{name}", entry.name)
            .replace("{warning}", backingDeleteWarning)
        : t("storagePage.action.fileMovedToRecycle").replace("{name}", entry.name),
    } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.fileDeleteFailed"),
    } satisfies StorageActionState;
  }
}

export async function restoreFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:delete");

  const t = await serverT();
  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

    if (!fileEntryId) {
      return { error: t("storagePage.action.missingFileEntryParam") } satisfies StorageActionState;
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
      return { error: t("storagePage.action.fileEntryNotFound") } satisfies StorageActionState;
    }

    await restoreFileEntry({ fileEntryId });

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

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: t("storagePage.action.fileRestored").replace("{name}", entry.name) } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.fileRestoreFailed"),
    } satisfies StorageActionState;
  }
}

export async function permanentDeleteFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:delete");

  const t = await serverT();
  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

    if (!fileEntryId) {
      return { error: t("storagePage.action.missingFileEntryParam") } satisfies StorageActionState;
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
      return { error: t("storagePage.action.fileEntryNotFound") } satisfies StorageActionState;
    }

    await deleteBackingObject({
      storageNode: entry.storageNode,
      relativePath: entry.relativePath,
      isDirectory: entry.entryType === "DIRECTORY",
      tolerateMissing: true,
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

    return { success: t("storagePage.action.filePermanentlyDeleted").replace("{name}", entry.name) } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.filePermanentlyDeleteFailed"),
    } satisfies StorageActionState;
  }
}

export async function renameFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:write");

  const t = await serverT();
  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();
    const newName = String(formData.get("newName") ?? "").trim();

    if (!fileEntryId) {
      return { error: t("storagePage.action.missingFileEntryParam") } satisfies StorageActionState;
    }

    if (!newName) {
      return { error: t("storagePage.action.missingEntryName") } satisfies StorageActionState;
    }

    if (/[\\/:*?"<>|]/.test(newName)) {
      return { error: t("storagePage.action.invalidEntryName") } satisfies StorageActionState;
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
      return { error: t("storagePage.action.fileEntryNotFound") } satisfies StorageActionState;
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
        error: t("storagePage.action.pathAlreadyExists").replace("{path}", newRelativePath),
      } satisfies StorageActionState;
    }

    await renameBackingObject({
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

    return { success: t("storagePage.action.fileRenamed").replace("{name}", newName) } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.fileRenameFailed"),
    } satisfies StorageActionState;
  }
}

export async function updateStorageNodeAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:manage-node");

  const t = await serverT();
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
      return { error: t("storagePage.action.missingNodeParam") } satisfies StorageActionState;
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

    return { success: t("storagePage.action.updateNodeSuccess") } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.updateNodeFailed"),
    } satisfies StorageActionState;
  }
}

export async function deleteStorageNodeAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  await requirePermission("storage:manage-node");

  const t = await serverT();
  try {
    const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();

    if (!storageNodeId) {
      return { error: t("storagePage.action.missingNodeParam") } satisfies StorageActionState;
    }

    await deleteStorageNode(storageNodeId);

    revalidatePath("/");
    revalidatePath("/servers");
    revalidatePath("/storage");
    revalidatePath("/files");

    return { success: t("storagePage.action.deleteNodeSuccess") } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.deleteNodeFailed"),
    } satisfies StorageActionState;
  }
}
