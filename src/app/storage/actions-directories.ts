"use server";

import { revalidatePath } from "next/cache";

import { auditUserAction } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { serverT } from "@/lib/i18n/server-locale";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { createFileEntry } from "@/lib/storage/service";
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

import type { StorageActionState } from "./actions-helpers";

export async function createFolderAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("storage:write");

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

    const storageNode = await prisma.storageNode.findFirst({
      where: { id: storageNodeId, ...teamWhere(session) },
      select: {
        id: true,
        name: true,
        driver: true,
        basePath: true,
        host: true,
        port: true,
        username: true,
        hostKeySha256: true,
        serverId: true,
        server: {
          select: {
            id: true,
            host: true,
            port: true,
            username: true,
            connectionType: true,
            password: true,
            hostKeySha256: true,
            sshKey: { select: { privateKey: true } },
          },
        },
      },
    });

    if (!storageNode) {
      return { error: t("storagePage.action.nodeNotFound") } satisfies StorageActionState;
    }

    // Grant-level path ACL (teamWhere alone is insufficient for restricted prefixes).
    // Same model as renameFileEntryAction / sftp-ops: storage:write + path-prefix grant.
    const folderAccess = await assertStorageAccess({
      session,
      storageNodeId,
      relativePath,
      operation: "write",
    });
    if (!folderAccess.allowed) {
      return {
        error: folderAccess.reason ?? t("storagePage.action.nodeNotFound"),
      } satisfies StorageActionState;
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

    await auditUserAction(session.userId, "storage.folder.create", {
      storageNodeId,
      relativePath,
      folderName,
    });

    return {
      success: t("storagePage.action.folderCreated").replace("{path}", relativePath),
    } satisfies StorageActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.folderCreateFailed"),
    } satisfies StorageActionState;
  }
}

export async function renameFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("storage:write");

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

    const entry = await prisma.fileEntry.findFirst({
      where: {
        id: fileEntryId,
        isDeleted: false,
        storageNode: {
          ...teamWhere(session),
        },
      },
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
            hostKeySha256: true,
            server: {
              select: {
                host: true,
                port: true,
                username: true,
                connectionType: true,
                password: true,
                hostKeySha256: true,
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

    // Grant-level path ACL (teamWhere alone is insufficient for restricted prefixes).
    // Require write on BOTH source and destination — same model as moveFileAction /
    // sftp-ops rename — so a grant on one prefix cannot rename out of another.
    const sourceAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: entry.relativePath,
      operation: "write",
    });
    if (!sourceAccess.allowed) {
      return {
        error: sourceAccess.reason ?? t("storagePage.action.fileEntryNotFound"),
      } satisfies StorageActionState;
    }

    const destinationAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: newRelativePath,
      operation: "write",
    });
    if (!destinationAccess.allowed) {
      return {
        error: destinationAccess.reason ?? t("storagePage.action.fileEntryNotFound"),
      } satisfies StorageActionState;
    }

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

    // Preload directory children and fail closed before physical rename so we
    // never leave a renamed remote tree with partial index rewrites.
    const DIRECTORY_CHILD_REWRITE_LIMIT = 10_000;
    let directoryChildren: Array<{ id: string; relativePath: string }> = [];
    if (entry.entryType === "DIRECTORY") {
      const oldPrefix = entry.relativePath + "/";
      // Soft-deleted descendants stay under the old prefix in recycle-bin state.
      // Moving them here would either resurrect trash or corrupt recycle paths.
      directoryChildren = await prisma.fileEntry.findMany({
        where: {
          storageNodeId: entry.storageNodeId,
          relativePath: { startsWith: oldPrefix },
          isDeleted: false,
        },
        select: { id: true, relativePath: true },
        take: DIRECTORY_CHILD_REWRITE_LIMIT + 1,
      });
      if (directoryChildren.length > DIRECTORY_CHILD_REWRITE_LIMIT) {
        return {
          error: t("storagePage.action.directoryTooLargeToRename").replace(
            "{limit}",
            String(DIRECTORY_CHILD_REWRITE_LIMIT),
          ),
        } satisfies StorageActionState;
      }
    }

    await renameBackingObject({
      storageNode: entry.storageNode,
      oldRelativePath: entry.relativePath,
      newRelativePath,
    });

    if (entry.entryType === "DIRECTORY") {
      const oldPrefix = entry.relativePath + "/";
      const newPrefix = newRelativePath + "/";
      // N+1 acceptable: non-uniform per-item writes (each row gets a computed relativePath)
      for (const child of directoryChildren) {
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

    await auditUserAction(session.userId, "storage.file_rename", {
      entryId: entry.id,
      oldName: entry.name,
      newName,
      oldPath: entry.relativePath,
      newPath: newRelativePath,
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
