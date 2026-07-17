"use server";

import { revalidatePath } from "next/cache";

import { auditUserAction, writeAuditLog } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { serverT } from "@/lib/i18n/server-locale";
import { restoreFileEntry } from "@/lib/storage/service";
import { deleteBackingObject } from "@/lib/storage/fs-backend";

import type { StorageActionState, StorageDeleteActionState } from "./actions-helpers";

const logger = createLogger("storage-file-entries");

export async function deleteFileEntryAction(
  _prev: StorageDeleteActionState | null,
  formData: FormData,
): Promise<StorageDeleteActionState> {
  const session = await requirePermission("storage:delete");

  const t = await serverT();
  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

    if (!fileEntryId) {
      return { error: t("storagePage.action.missingFileEntryParam") } satisfies StorageDeleteActionState;
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
      return { error: t("storagePage.action.fileEntryNotFound") } satisfies StorageDeleteActionState;
    }

    const deleteAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: entry.relativePath,
      operation: "delete",
    });
    if (!deleteAccess.allowed) {
      return { error: deleteAccess.reason ?? t("storagePage.action.fileEntryNotFound") } satisfies StorageDeleteActionState;
    }

    // Index soft-delete first (transactional), then best-effort physical delete.
    // This avoids "file gone but UI still shows entry" when FS succeeds and DB fails.
    if (entry.entryType === "DIRECTORY") {
      const prefix = entry.relativePath + "/";
      await prisma.$transaction([
        prisma.fileEntry.updateMany({
          where: {
            storageNodeId: entry.storageNodeId,
            relativePath: { startsWith: prefix },
            isDeleted: false,
          },
          data: { isDeleted: true },
        }),
        prisma.fileEntry.update({
          where: { id: fileEntryId },
          data: { isDeleted: true },
        }),
      ]);
    } else {
      await prisma.fileEntry.update({
        where: { id: fileEntryId },
        data: { isDeleted: true },
      });
    }

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
      }).catch((err) => {
        logger.warn("audit write failed after backing delete failure", {
          entryId: entry.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    await auditUserAction(session.userId, "storage.file_delete", {
      entryId: entry.id,
      entryName: entry.name,
      relativePath: entry.relativePath,
      physicalDeleted: !backingDeleteWarning,
      warning: backingDeleteWarning,
    }, backingDeleteWarning ? "WARNING" : "INFO");

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");

    // Structured partial-success: index deleted, physical may still need reconcile.
    return {
      success: backingDeleteWarning
        ? t("storagePage.action.fileMovedToRecycleWithWarning")
            .replace("{name}", entry.name)
            .replace("{warning}", backingDeleteWarning)
        : t("storagePage.action.fileMovedToRecycle").replace("{name}", entry.name),
      physicalDeleted: !backingDeleteWarning,
      needsReconcile: Boolean(backingDeleteWarning),
    } satisfies StorageDeleteActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : t("storagePage.action.fileDeleteFailed"),
    } satisfies StorageDeleteActionState;
  }
}

export async function restoreFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("storage:delete");

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

    const restoreAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: entry.relativePath,
      operation: "delete",
    });
    if (!restoreAccess.allowed) {
      return { error: restoreAccess.reason ?? t("storagePage.action.fileEntryNotFound") } satisfies StorageActionState;
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

    await auditUserAction(session.userId, "storage.file_restore", {
      entryId: entry.id,
      entryName: entry.name,
      relativePath: entry.relativePath,
    });

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
  const session = await requirePermission("storage:delete");

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

    const permDeleteAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: entry.relativePath,
      operation: "delete",
    });
    if (!permDeleteAccess.allowed) {
      return { error: permDeleteAccess.reason ?? t("storagePage.action.fileEntryNotFound") } satisfies StorageActionState;
    }

    // Tombstone / remove index first so UI cannot keep a live entry if FS delete later fails.
    // Physical delete is best-effort with tolerateMissing.
    if (entry.entryType === "DIRECTORY") {
      const prefix = entry.relativePath + "/";
      await prisma.$transaction([
        prisma.fileEntry.deleteMany({
          where: {
            storageNodeId: entry.storageNodeId,
            relativePath: { startsWith: prefix },
          },
        }),
        prisma.fileEntry.delete({
          where: { id: fileEntryId },
        }),
      ]);
    } else {
      await prisma.fileEntry.delete({
        where: { id: fileEntryId },
      });
    }

    try {
      await deleteBackingObject({
        storageNode: entry.storageNode,
        relativePath: entry.relativePath,
        isDirectory: entry.entryType === "DIRECTORY",
        tolerateMissing: true,
      });
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.warn("permanent delete: backing object cleanup failed after index removal", {
        entryId: entry.id,
        relativePath: entry.relativePath,
        reason,
      });
      writeAuditLog({
        actorType: "SYSTEM",
        action: "storage.file_permanent_delete_backing_failed",
        severity: "WARNING",
        detail: {
          entryId: entry.id,
          entryName: entry.name,
          relativePath: entry.relativePath,
          reason,
        },
      }).catch((err) => {
        logger.warn("audit write failed after permanent backing delete failure", {
          entryId: entry.id,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    await auditUserAction(session.userId, "storage.file_permanent_delete", {
      entryId: entry.id,
      entryName: entry.name,
      relativePath: entry.relativePath,
    }, "WARNING");

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
