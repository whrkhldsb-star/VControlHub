"use server";

import { revalidatePath } from "next/cache";

import { writeAuditLog } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { serverT } from "@/lib/i18n/server-locale";
import { restoreFileEntry } from "@/lib/storage/service";
import { deleteBackingObject } from "@/lib/storage/fs-backend";

import type { StorageActionState } from "./actions-helpers";

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
