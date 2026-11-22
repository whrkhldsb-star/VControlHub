"use server";

import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { auditUserAction } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { teamWhere } from "@/lib/auth/team-scope";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { prisma } from "@/lib/db";
import { serverT, withServerActionLocale } from "@/lib/i18n/server-locale";
import { restoreFileEntry } from "@/lib/storage/service";
import { deleteRecycledBackingObjects } from "@/lib/storage/recycled-backing";
import { outsideDeleteBatchWhere } from "@/lib/files/recycle-bin";
import { purgeFileEntryVersionDirectories } from "@/lib/storage/file-versions";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { apiCopy } from "@/lib/i18n/api-copy";

import type { StorageActionState, StorageDeleteActionState } from "./actions-helpers";
import { getErrorMessage } from "@/lib/http/error-message";
import { executeDeleteFile, findAffectedShareIds } from "@/lib/files/delete-operation";
import { STORAGE_SSH_SERVER_SELECT } from "@/lib/storage/ssh-credentials";

export async function deleteFileEntryAction(_prev: StorageDeleteActionState | null, formData: FormData): Promise<StorageDeleteActionState> {
  return withServerActionLocale(() => deleteFileEntryActionImpl(_prev, formData));
}

async function deleteFileEntryActionImpl(_prev: StorageDeleteActionState | null, formData: FormData): Promise<StorageDeleteActionState> {
  return executeDeleteFile(await requirePermission("storage:delete"), formData);
}

export async function restoreFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  return withServerActionLocale(() => restoreFileEntryActionImpl(_prev, formData));
}

async function restoreFileEntryActionImpl(
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

    const deleteBatchId = String(formData.get("deleteBatchId") ?? "") || null;
    const deletedAt = new Date(String(formData.get("deletedAt") ?? ""));
    if (!deleteBatchId && !Number.isFinite(deletedAt.getTime())) return { error: apiCopy("apiCopy.files.op.changed") };
    const seen = { deleteBatchId, ...(!deleteBatchId && { updatedAt: deletedAt }) };
    const entry = await prisma.fileEntry.findFirst({
      where: {
        id: fileEntryId, isDeleted: true, ...seen,
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
      await restoreFileEntry({ fileEntryId }, session, seen);

      // The service validates capacity and revives a directory batch atomically.
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
  return withServerActionLocale(() => permanentDeleteFileEntryActionImpl(_prev, formData));
}

async function permanentDeleteFileEntryActionImpl(
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

    const deleteBatchId = String(formData.get("deleteBatchId") ?? "") || null;
    const deletedAt = new Date(String(formData.get("deletedAt") ?? ""));
    if (!deleteBatchId && !Number.isFinite(deletedAt.getTime())) return { error: apiCopy("apiCopy.files.op.changed") };
    const identity = { id: fileEntryId, isDeleted: true, deleteBatchId, ...(!deleteBatchId && { updatedAt: deletedAt }) };
    const where = { ...identity, storageNode: teamWhere(session) };
    const target = await prisma.fileEntry.findFirst({ where, select: { storageNodeId: true, relativePath: true } });
    if (!target) return { error: apiCopy("apiCopy.files.op.changed") };
    // Serialize against move/copy/delete/rename/restore on the same node:
    // permanent delete removes backing bytes AND index rows; interleaving
    // with a tree rewrite would corrupt the other operation's assumptions.
    const permRelease = await tryAcquireAdvisoryLock("storage-file-operation", target.storageNodeId);
    if (!permRelease) {
      return { error: apiCopy("apiCopy.files.op.busy") } satisfies StorageActionState;
    }
    let releasePath: (() => Promise<void>) | undefined;
    try {
      releasePath = await lockStorageFileOverwrite(target.storageNodeId, target.relativePath);
      const entry = await prisma.fileEntry.findFirst({
        where: { ...where, storageNodeId: target.storageNodeId },
        select: {
          id: true,
          name: true,
          entryType: true,
          relativePath: true,
          storageNodeId: true,
          deletedAgentRoot: true,
          storageVersion: true,
          storageNode: {
            select: {
              id: true,
              driver: true,
              basePath: true,
              // The WebDAV backend reads its connection from here: without it a
              // permanent delete on a WebDAV node failed before any request.
              webdavConfigEncrypted: true,
              host: true,
              port: true,
              username: true,
              teamId: true,
              hostKeySha256: true,
              server: { select: STORAGE_SSH_SERVER_SELECT },
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

      const isDirectory = entry.entryType === "DIRECTORY";
      if (isDirectory) {
        const outside = await prisma.fileEntry.count({
          where: deleteBatchId ? outsideDeleteBatchWhere(entry.storageNodeId, entry.relativePath, deleteBatchId)
            : { storageNodeId: entry.storageNodeId, relativePath: { startsWith: escapeLikeLiteral(entry.relativePath + "/") } },
        });
        if (outside > 0) {
          return { error: t("storagePage.action.liveEntriesUnderRecycledDirectory", { count: outside }) };
        }
      }
      const children = isDirectory && deleteBatchId ? await prisma.fileEntry.findMany({
        where: {
          storageNodeId: entry.storageNodeId, isDeleted: true, deleteBatchId,
          relativePath: { startsWith: escapeLikeLiteral(`${entry.relativePath}/`) },
        },
        select: { id: true, relativePath: true, entryType: true, deletedAgentRoot: true, storageVersion: true },
      }) : [];
      const affectedShareIds = await findAffectedShareIds({
        storageNodeId: entry.storageNodeId, relativePath: entry.relativePath, isDirectory,
      });
      await deleteRecycledBackingObjects(entry.storageNode, entry, children);
      await prisma.$transaction([
        prisma.fileEntry.deleteMany({
          where: { id: { in: children.map(row => row.id) }, storageNodeId: entry.storageNodeId, isDeleted: true, deleteBatchId },
        }),
        prisma.fileEntry.delete({ where: identity }),
        prisma.shareLink.updateMany({ where: { id: { in: affectedShareIds }, revokedAt: null }, data: { revokedAt: new Date() } }),
      ]);
      await purgeFileEntryVersionDirectories(entry.storageNodeId, [entry.id, ...children.map(row => row.id)]);

      await auditUserAction(
        session.userId,
        "storage.file_permanent_delete",
        { entryId: entry.id, entryName: entry.name, relativePath: entry.relativePath },
        "WARNING",
        session.currentTeamId,
      );

      return { success: t("storagePage.action.filePermanentlyDeleted", { name: entry.name }) } satisfies StorageActionState;
    } finally {
      try { await releasePath?.(); } finally { await permRelease(); }
    }
  } catch (error) {
    return {
      error: getErrorMessage(error, t("storagePage.action.filePermanentlyDeleteFailed")),
    } satisfies StorageActionState;
  }
}
