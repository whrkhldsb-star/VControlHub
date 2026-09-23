"use server";

import { auditUserAction } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { teamWhere } from "@/lib/auth/team-scope";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { prisma } from "@/lib/db";
import { serverT } from "@/lib/i18n/server-locale";
import { restoreFileEntry } from "@/lib/storage/service";
import { deleteBackingObject } from "@/lib/storage/fs-backend";
import { purgeAllFileVersionBlobs } from "@/lib/storage/file-versions";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { apiCopy } from "@/lib/i18n/api-copy";

import type { StorageActionState, StorageDeleteActionState } from "./actions-helpers";
import { getErrorMessage } from "@/lib/http/error-message";
import { executeDeleteFile, findAffectedShareIds } from "@/lib/files/delete-operation";

export async function deleteFileEntryAction(_prev: StorageDeleteActionState | null, formData: FormData): Promise<StorageDeleteActionState> {
  return executeDeleteFile(await requirePermission("storage:delete"), formData);
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

    const entry = await prisma.fileEntry.findFirst({
      where: {
        id: fileEntryId,
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
        deleteBatchId: true,
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
      return { error: storageAccessDeniedCopy(restoreAccess.reason) } satisfies StorageActionState;
    }

    // Serialize against move/copy/delete/rename on the same node: restore
    // flips index rows back to live while those operations may be rewriting
    // the same prefixes.
    const release = await tryAcquireAdvisoryLock("storage-file-operation", entry.storageNodeId);
    if (!release) {
      return { error: apiCopy("apiCopy.files.op.busy") } satisfies StorageActionState;
    }
    try {
      await restoreFileEntry({ fileEntryId }, session);

      if (entry.entryType === "DIRECTORY" && entry.deleteBatchId) {
        // Revive only the descendants soft-deleted by the same batch as the
        // directory itself. Rows deleted in earlier, separate operations keep
        // their recycle-bin state instead of being resurrected wholesale.
        await prisma.fileEntry.updateMany({
          where: {
            storageNodeId: entry.storageNodeId,
            deleteBatchId: entry.deleteBatchId,
            isDeleted: true,
            id: { not: fileEntryId },
          },
          data: { isDeleted: false, deleteBatchId: null },
        });
      }
    } finally {
      void release();
    }

    await auditUserAction(
      session.userId,
      "storage.file_restore",
      { entryId: entry.id, entryName: entry.name, relativePath: entry.relativePath },
      undefined,
      session.currentTeamId,
    );

    return { success: t("storagePage.action.fileRestored", { name: entry.name }) } satisfies StorageActionState;
  } catch (error) {
    return {
      error: getErrorMessage(error, t("storagePage.action.fileRestoreFailed")),
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

    const entry = await prisma.fileEntry.findFirst({
      where: {
        id: fileEntryId,
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

    const permDeleteAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: entry.relativePath,
      operation: "delete",
    });
    if (!permDeleteAccess.allowed) {
      return { error: storageAccessDeniedCopy(permDeleteAccess.reason) } satisfies StorageActionState;
    }

    // Serialize against move/copy/delete/rename/restore on the same node:
    // permanent delete removes backing bytes AND index rows; interleaving
    // with a tree rewrite would corrupt the other operation's assumptions.
    const permRelease = await tryAcquireAdvisoryLock("storage-file-operation", entry.storageNodeId);
    if (!permRelease) {
      return { error: apiCopy("apiCopy.files.op.busy") } satisfies StorageActionState;
    }
    try {
    const affectedShareIds = await findAffectedShareIds({
	  storageNodeId: entry.storageNodeId,
	  relativePath: entry.relativePath,
	  isDirectory: entry.entryType === "DIRECTORY",
	});

	// Delete backing first. If this fails, keep the tombstone and share records
	// intact so the user can retry and the operation cannot report false success.
	await deleteBackingObject({
	  storageNode: entry.storageNode,
	  relativePath: entry.relativePath,
	  isDirectory: entry.entryType === "DIRECTORY",
	  tolerateMissing: true,
	});

	const revokeShares = prisma.shareLink.updateMany({
	  where: { id: { in: affectedShareIds }, revokedAt: null },
	  data: { revokedAt: new Date() },
	});
    if (entry.entryType === "DIRECTORY") {
      const prefix = entry.relativePath + "/";
      // Purge version blobs for the directory's own entry AND every descendant
      // before the cascade drops their FileVersion rows — otherwise the blob
      // files leak on disk and deleted content stays readable on the control plane.
      const descendants = await prisma.fileEntry.findMany({
        where: {
          storageNodeId: entry.storageNodeId,
          relativePath: { startsWith: prefix },
        },
        select: { id: true },
      });
      for (const child of descendants) {
        await purgeAllFileVersionBlobs(child.id);
      }
      await purgeAllFileVersionBlobs(fileEntryId);
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
		revokeShares,
      ]);
    } else {
	  // Purge version blobs before the cascade removes their rows (see above).
	  await purgeAllFileVersionBlobs(fileEntryId);
	  await prisma.$transaction([
		prisma.fileEntry.delete({ where: { id: fileEntryId } }),
		revokeShares,
	  ]);
    }

    await auditUserAction(
      session.userId,
      "storage.file_permanent_delete",
      { entryId: entry.id, entryName: entry.name, relativePath: entry.relativePath },
      "WARNING",
      session.currentTeamId,
    );

    return { success: t("storagePage.action.filePermanentlyDeleted", { name: entry.name }) } satisfies StorageActionState;
    } finally {
      void permRelease();
    }
  } catch (error) {
    return {
      error: getErrorMessage(error, t("storagePage.action.filePermanentlyDeleteFailed")),
    } satisfies StorageActionState;
  }
}
