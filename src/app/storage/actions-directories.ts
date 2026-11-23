"use server";
import { isCaseInsensitiveStorageNode } from "@/lib/storage/path-utils";
import { Prisma } from "@prisma/client";

import { assertNotRecycled } from "@/lib/storage/archive-access";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { guessContentType } from "@/lib/http/mime-types";
import { auditUserAction } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { serverT, withServerActionLocale } from "@/lib/i18n/server-locale";
import { moveMeasurement } from "@/lib/storage/move-capacity";
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { createFileEntry } from "@/lib/storage/service";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { ConflictError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import {
  createManagedFolder,
  renameBackingObject,
  statBackingObject,
} from "@/lib/storage/fs-backend";
import {
  joinStoragePath,
  normalizeStorageEntryName,
  normalizeStorageTargetDirectory,
} from "@/lib/storage/path-utils";

import type { StorageActionState } from "./actions-helpers";
import { getErrorMessage } from "@/lib/http/error-message";
import { STORAGE_SSH_SERVER_SELECT } from "@/lib/storage/ssh-credentials";
import { moveSharePaths } from "@/lib/share-link/follow-path";

export async function createFolderAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  return withServerActionLocale(() => createFolderActionImpl(_prev, formData));
}

async function createFolderActionImpl(
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

    const storageNode = await prisma.storageNode.findFirst({
      where: { id: storageNodeId, ...teamWhere(session) },
      select: {
        id: true,
        name: true,
        driver: true,
        basePath: true,
        webdavConfigEncrypted: true,
        host: true,
        port: true,
        username: true,
        teamId: true,
        hostKeySha256: true,
        serverId: true,
        server: { select: STORAGE_SSH_SERVER_SELECT },
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
        error: storageAccessDeniedCopy(folderAccess.reason),
      } satisfies StorageActionState;
    }

    // Serialize against move/copy/delete/rename on the same node so the
    // create + index write cannot interleave with a tree rewrite.
    const release = await tryAcquireAdvisoryLock("storage-file-operation", storageNodeId);
    try {
      if (!release) {
        return {
          error: apiCopy("apiCopy.files.op.busy"),
        } satisfies StorageActionState;
      }

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
          error: t("storagePage.action.folderAlreadyExists", { path: relativePath }),
        } satisfies StorageActionState;
      }

      let directory: Awaited<ReturnType<typeof createManagedFolder>>;
      try {
        await assertNotRecycled(storageNodeId, relativePath, "write");
        directory = await createManagedFolder({
          storageNode,
          relativePath,
        });
      } catch (error) {
        return {
          error: getErrorMessage(error, t("storagePage.action.folderCreateFailed")),
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
      if (directory.removeIfEmpty) {
        const indexed = await prisma.fileEntry.findFirst({
          where: { storageNodeId, relativePath }, select: { id: true },
        }).catch(() => true);
        if (!indexed) await directory.removeIfEmpty().catch(() => undefined);
      }
      throw error;
    }

    await auditUserAction(
      session.userId,
      "storage.folder.create",
      { storageNodeId, relativePath, folderName },
      undefined,
      session.currentTeamId,
    );

    return {
      success: t("storagePage.action.folderCreated", { path: relativePath }),
    } satisfies StorageActionState;
    } finally {
      void release?.();
    }
  } catch (error) {
    return {
      error: getErrorMessage(error, t("storagePage.action.folderCreateFailed")),
    } satisfies StorageActionState;
  }
}

export async function renameFileEntryAction(
  _prev: StorageActionState | null,
  formData: FormData,
) {
  return withServerActionLocale(() => renameFileEntryActionImpl(_prev, formData));
}

async function renameFileEntryActionImpl(
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

    const nameResult = normalizeStorageEntryName(newName);
    if (!nameResult.ok) {
      return {
        error: nameResult.reason || t("storagePage.action.invalidEntryName"),
      } satisfies StorageActionState;
    }
    const normalizedNewName = nameResult.path;

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
        updatedAt: true,
        size: true,
        relativePath: true,
        storageNodeId: true,
        storageNode: {
          select: {
            id: true,
            driver: true,
            basePath: true,
            // The WebDAV backend reads its connection from the node row.
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

    const lastSlashIndex = entry.relativePath.lastIndexOf("/");
    const newRelativePath =
      lastSlashIndex >= 0
        ? entry.relativePath.substring(0, lastSlashIndex + 1) + normalizedNewName
        : normalizedNewName;

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
        error: storageAccessDeniedCopy(sourceAccess.reason),
      } satisfies StorageActionState;
    }

    const destinationAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: newRelativePath,
      operation: "write", writeBytes: entry.size, movedFrom: entry.relativePath,
      measureMove: moveMeasurement(entry.storageNode, entry),
    });
    if (!destinationAccess.allowed) {
      return {
        error: storageAccessDeniedCopy(destinationAccess.reason),
      } satisfies StorageActionState;
    }

    // Serialize against move/copy/delete on the same node: the physical
    // rename + index rewrite below is not atomic with respect to those
    // operations, and the advisory lock is the established coordination
    // point (executeMoveFile / executeCopyFile / executeDeleteFile).
    let release;
    try { release = await tryAcquireAdvisoryLock("storage-file-operation", entry.storageNodeId); }
    catch (error) { await releaseStorageQuotaGuard(destinationAccess); throw error; }
    if (!release) { await releaseStorageQuotaGuard(destinationAccess); return { error: apiCopy("apiCopy.files.op.busy") }; }
    let releasePaths: (() => Promise<void>) | undefined;
    try {
    releasePaths = await lockStorageFileOverwrite(entry.storageNodeId, newRelativePath, entry.relativePath);
    const sourceIdentity = {
      id: fileEntryId, storageNodeId: entry.storageNodeId,
      relativePath: entry.relativePath, isDeleted: false, updatedAt: entry.updatedAt,
    };
    const sourceStillIndexed = () => prisma.fileEntry.findUnique({ where: sourceIdentity, select: { id: true } });
    if (!await sourceStillIndexed()) return { error: apiCopy("apiCopy.files.op.changed") };

    // Include soft-deleted (recycle-bin) rows: the physical rename overwrites
    // the target bytes, but a soft-deleted occupant's file is still on disk.
    // Filtering to isDeleted:false would let rename destroy a recycled file's
    // bytes and then hit the @@unique constraint (which spans soft-deleted
    // rows) on the DB update, silently emptying the recycle-bin entry.
    const caseInsensitive = isCaseInsensitiveStorageNode(entry.storageNode);
    const occupant = await prisma.fileEntry.findFirst({
      where: {
        storageNodeId: entry.storageNodeId,
        relativePath: caseInsensitive ? { equals: newRelativePath, mode: "insensitive" } : newRelativePath,
        id: { not: fileEntryId },
      },
      select: { id: true, isDeleted: true },
    });

    if (occupant) {
      return {
        error: occupant.isDeleted
          ? t("storagePage.action.pathInRecycleBin", { path: newRelativePath })
          : t("storagePage.action.pathAlreadyExists", { path: newRelativePath }),
      } satisfies StorageActionState;
    }

    // Preload directory children and fail closed before physical rename so we
    // never leave a renamed remote tree with partial index rewrites.
    const DIRECTORY_CHILD_REWRITE_LIMIT = 10_000;
    let directoryChildren: Array<{ id: string; relativePath: string }> = [];
    if (entry.entryType === "DIRECTORY") {
      const oldPrefix = entry.relativePath + "/";
      // Include soft-deleted (recycle-bin) descendants: the physical rename
      // moves the whole tree including recycled bytes, so their index rows
      // must migrate to the new prefix too — otherwise archives filter on
      // stale paths and re-include recycled files, and restore loses track
      // of where the bytes actually live.
      directoryChildren = await prisma.fileEntry.findMany({
        where: {
          storageNodeId: entry.storageNodeId,
          relativePath: { startsWith: escapeLikeLiteral(oldPrefix), ...(caseInsensitive ? { mode: "insensitive" as const } : {}) },
        },
        select: { id: true, relativePath: true },
        take: DIRECTORY_CHILD_REWRITE_LIMIT + 1,
      });
      if (directoryChildren.length > DIRECTORY_CHILD_REWRITE_LIMIT) {
        return {
          error: t("storagePage.action.directoryTooLargeToRename", { limit: DIRECTORY_CHILD_REWRITE_LIMIT }),
        } satisfies StorageActionState;
      }
    }

    // Guard against an un-indexed physical file at the destination (e.g. an
    // in-flight upload or an SSH-written file not yet scanned). The DB check
    // above cannot see it, and the raw rename would silently replace its
    // bytes. Mirrors executeMoveFile's physical occupancy check.
    if (await statBackingObject({ storageNode: entry.storageNode, relativePath: newRelativePath })) {
      return {
        error: t("storagePage.action.pathAlreadyExists", { path: newRelativePath }),
      } satisfies StorageActionState;
    }

    await assertNotRecycled(entry.storageNodeId, newRelativePath, "write");
    await destinationAccess.verifyMove?.();
    await renameBackingObject({
      storageNode: entry.storageNode,
      oldRelativePath: entry.relativePath,
      newRelativePath,
      noReplace: true,
    });

    try {
      // Wrap the child-row rewrites and the root update in a single
      // transaction. Without it, a mid-loop failure (connection blip/timeout)
      // leaves some descendants pointing at the new prefix and the rest at the
      // old one while the physical tree is rolled back below — a permanent
      // index/disk mismatch. This mirrors moveFileAction's atomic DB update.
      await prisma.$transaction(async (tx) => {
        if (entry.entryType === "DIRECTORY" && directoryChildren.length > 0) {
          const oldPrefix = entry.relativePath + "/";
          const newPrefix = newRelativePath + "/";
          // One UPDATE for the subtree (A4-28): a row per child inside the
          // interactive transaction tripped the 5 s transaction timeout on big
          // directories and the rename rolled back every time.
          // Recycle-bin rows move too (see the preload above): their bytes moved with the rename. Leaving them at
          // the old prefix resurrected trashed files under the new name and made "delete permanently" a no-op.
          // A plain concatenation: the new prefix is taken as it is (it holds no "\": storage paths refuse it).
          await tx.$executeRaw`
            UPDATE file_entries
            SET "relativePath" = ${newPrefix} || substring("relativePath" from length(${oldPrefix}::text) + 1),
                "updatedAt" = (now() AT TIME ZONE 'UTC')
            WHERE "storageNodeId" = ${entry.storageNodeId}
              AND ${caseInsensitive
                ? Prisma.sql`lower("relativePath") LIKE ${`${escapeLikeLiteral(oldPrefix.toLowerCase())}%`} ESCAPE '\\'`
                : Prisma.sql`"relativePath" LIKE ${`${escapeLikeLiteral(oldPrefix)}%`} ESCAPE '\\'`}
          `;
        }

        // A changed extension changes the type the previews and icons go by (A4-29).
        const extensionOf = (name: string) => { const i = name.lastIndexOf("."); return i > 0 ? name.slice(i + 1).toLowerCase() : ""; };
        const retype = entry.entryType === "FILE" && extensionOf(entry.name) !== extensionOf(normalizedNewName);
        await tx.fileEntry.update({
          where: sourceIdentity,
          data: { name: normalizedNewName, relativePath: newRelativePath, ...(retype ? { mimeType: guessContentType(normalizedNewName) } : {}) },
        });
        // Shares follow the renamed entry, as they follow a move.
        await moveSharePaths(tx, {
          storageNodeId: entry.storageNodeId,
          oldPath: entry.relativePath,
          newPath: newRelativePath,
          isDirectory: entry.entryType === "DIRECTORY",
          caseInsensitive,
        });
      }, { timeout: 60_000 });
    } catch (databaseError) {
      // Physical rename already succeeded — roll back so disk and index stay aligned.
      try {
        if (!await sourceStillIndexed() ||
            await statBackingObject({ storageNode: entry.storageNode, relativePath: entry.relativePath })) {
          throw new ConflictError(apiCopy("apiCopy.files.op.changed"));
        }
        await renameBackingObject({
          storageNode: entry.storageNode,
          oldRelativePath: newRelativePath,
          newRelativePath: entry.relativePath,
          noReplace: true,
        });
      } catch (compensationError) {
        return {
          // A database error has no message for people (its own is the query): it is named instead.
          error: t("storagePage.action.renameRollbackFailed", {
            error: getErrorMessage(databaseError, t("storagePage.action.indexWriteFailed")),
            rollback: getErrorMessage(compensationError, String(compensationError)),
          }),
        } satisfies StorageActionState;
      }
      return {
        error: getErrorMessage(databaseError, t("storagePage.action.renameFailed")),
      } satisfies StorageActionState;
    }

    await auditUserAction(
      session.userId,
      "storage.file_rename",
      {
        entryId: entry.id,
        oldName: entry.name,
        newName: normalizedNewName,
        oldPath: entry.relativePath,
        newPath: newRelativePath,
      },
      undefined,
      session.currentTeamId,
    );

    return { success: t("storagePage.action.fileRenamed", { name: normalizedNewName }) } satisfies StorageActionState;
    } finally {
      try { await releasePaths?.(); } finally { try { await release(); } finally { await releaseStorageQuotaGuard(destinationAccess); } }
    }
  } catch (error) {
    return {
      error: getErrorMessage(error, t("storagePage.action.fileRenameFailed")),
    } satisfies StorageActionState;
  }
}
