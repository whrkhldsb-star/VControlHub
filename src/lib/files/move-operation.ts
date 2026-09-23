import type { SessionPayload } from "@/lib/auth/session";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { apiCopy } from "@/lib/i18n/api-copy";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { BusinessError, ForbiddenError } from "@/lib/errors";
import { moveBackingObject, statBackingObject } from "@/lib/storage/fs-backend";
import { serviceT } from "@/lib/i18n/service-locale";
import type { Locale } from "@/lib/i18n/core";
import {
  joinStoragePath,
  normalizeStorageRelativePath,
  normalizeStorageTargetDirectory,
} from "@/lib/storage/path-utils";
import { getErrorMessage } from "@/lib/http/error-message";
import { FileOperationUncertainError } from "./operation-schema";

export type MoveFileActionState = { error?: string; success?: string; needsReconcile?: boolean };

export async function executeMoveFile(
  session: SessionPayload,
  formData: FormData,
  locale?: Locale,
): Promise<MoveFileActionState> {
  const tr = await serviceT(locale);
  let release: (() => Promise<void>) | null = null;
  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();
    const targetDir = String(formData.get("targetDir") ?? "").trim();

    if (!fileEntryId)
      return { error: tr("filesPage.move.errorMissingFile") } satisfies MoveFileActionState;
    if (!targetDir)
      return { error: tr("filesPage.move.errorEmptyTarget") } satisfies MoveFileActionState;

    const targetDirResult = normalizeStorageTargetDirectory(targetDir);
    if (!targetDirResult.ok) {
      return { error: targetDirResult.reason } satisfies MoveFileActionState;
    }

    const normalizedTargetDir = targetDirResult.path;

    // Team-scope the lookup so foreign-team fileEntryIds cannot be moved by id.
    // isDeleted:false matches rename/delete actions and blocks resurrecting trash via move.
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
            webdavConfigEncrypted: true,
            server: {
              select: {
                id: true,
                managementMode: true,
                hostKeySha256: true,
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

    if (!entry)
      return { error: tr("filesPage.move.errorFileNotFound") } satisfies MoveFileActionState;

    release = await tryAcquireAdvisoryLock("storage-file-operation", entry.storageNodeId);
    if (!release) throw new Error(apiCopy("apiCopy.files.op.busy"));
    const current = await prisma.fileEntry.findFirst({ where: { id: fileEntryId, isDeleted: false }, select: { relativePath: true } });
    if (!current || current.relativePath !== entry.relativePath) throw new Error(apiCopy("apiCopy.files.op.changed"));

    const joinedPath = joinStoragePath(normalizedTargetDir, entry.name);
    if (!joinedPath.ok) {
      return { error: joinedPath.reason } satisfies MoveFileActionState;
    }

    const newRelativePath = joinedPath.path;
    const normalizedCurrentPath = normalizeStorageRelativePath(
      entry.relativePath,
    );
    if (!normalizedCurrentPath.ok) {
      return {
        error: normalizedCurrentPath.reason,
      } satisfies MoveFileActionState;
    }

    // Require write on BOTH source and destination. Destination-only ACL would
    // let a grant on /public pull files out of a restricted source prefix.
    const sourceAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: normalizedCurrentPath.path,
      operation: "write",
    });
    if (!sourceAccess.allowed) {
      return {
        error: storageAccessDeniedCopy(sourceAccess.reason, locale),
      } satisfies MoveFileActionState;
    }

    const destinationAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: newRelativePath,
      operation: "write",
    });

    if (!destinationAccess.allowed) {
      return {
        error: storageAccessDeniedCopy(destinationAccess.reason, locale),
      } satisfies MoveFileActionState;
    }

    if (newRelativePath === entry.relativePath) {
      return { error: tr("filesPage.move.errorSamePath") } satisfies MoveFileActionState;
    }

    if (entry.entryType === "DIRECTORY" && newRelativePath.startsWith(`${normalizedCurrentPath.path}/`)) {
      return { error: tr("filesPage.move.errorDescendant") } satisfies MoveFileActionState;
    }

    // 检查目标路径是否已存在。必须同时考虑软删除（回收站）行：物理 move 会
    // 直接覆盖目标位置的字节，而软删行的物理文件仍在磁盘上。若只查 isDeleted:false，
    // move 会覆盖并永久销毁回收站里同名文件的字节，之后 DB 更新还会撞唯一约束
    // （@@unique 覆盖软删行）触发补偿把本文件移回——净结果是回收站文件被静默清空。
    const occupant = await prisma.fileEntry.findFirst({
      where: {
        storageNodeId: entry.storageNodeId,
        relativePath: newRelativePath,
        id: { not: fileEntryId },
      },
      select: { id: true, isDeleted: true },
    });

    if (occupant) {
      return {
        error: occupant.isDeleted
          ? tr("filesPage.move.errorTargetInRecycleBin", { path: `/${newRelativePath}` })
          : tr("filesPage.move.errorTargetExists", { path: `/${newRelativePath}` }),
      } satisfies MoveFileActionState;
    }

    if (await statBackingObject({ storageNode: entry.storageNode, relativePath: newRelativePath })) {
      return { error: tr("filesPage.move.errorTargetExists", { path: `/${newRelativePath}` }) };
    }
    const descendants = entry.entryType === "DIRECTORY" ? await prisma.fileEntry.findMany({
      where: { storageNodeId: entry.storageNodeId, relativePath: { startsWith: `${entry.relativePath}/` } },
      select: { id: true, relativePath: true }, take: 10001,
    }) : [];
    if (descendants.length > 10000) {
      throw new BusinessError(tr("backend.storageHardening.files.tooManyChildren"));
    }
    for (const child of descendants) {
      for (const relativePath of [child.relativePath, newRelativePath + child.relativePath.slice(entry.relativePath.length)]) {
        const access = await assertStorageAccess({ session, storageNodeId: entry.storageNodeId, relativePath, operation: "write" });
        if (!access.allowed) throw new ForbiddenError(storageAccessDeniedCopy(access.reason, locale));
      }
    }

    // LOCAL/SFTP 节点：在磁盘/远端实际移动文件，成功后再更新 DB，避免 DB/磁盘路径不一致
    try {
      await moveBackingObject({
        storageNode: entry.storageNode,
        oldRelativePath: normalizedCurrentPath.path,
        newRelativePath,
      });
    } catch (error) {
      // A remote rename may have committed before its acknowledgement was lost.
      // Do not replay it against a path which might now contain another object.
      if (entry.storageNode.driver !== "LOCAL") {
        throw new FileOperationUncertainError(apiCopy("apiCopy.files.op.moveUnconfirmed", {
          v0: normalizedCurrentPath.path, v1: newRelativePath,
          v2: getErrorMessage(error, tr("filesPage.move.errorUnknown")),
        }));
      }
      const driverLabel =
        entry.storageNode.driver === "LOCAL" ? tr("filesPage.move.driverLocal") : tr("filesPage.move.driverRemote");
      return {
        error: tr("filesPage.move.errorBackingMoveFailed", { driver: driverLabel, message: getErrorMessage(error, tr("filesPage.move.errorUnknown")) }),
      } satisfies MoveFileActionState;
    }

    try {
      await prisma.$transaction(async (tx) => {
        // Update the root first so the unique constraint reserves the target
        // path before any descendant rows are changed.
        await tx.fileEntry.update({
          where: { id: fileEntryId },
          data: { relativePath: newRelativePath },
        });

        const oldSharePrefix = `${entry.relativePath}/`;
        const newSharePrefix = `${newRelativePath}/`;
        const activeShares = await tx.shareLink.findMany({
          where: {
            storageNodeId: entry.storageNodeId,
            revokedAt: null,
            OR: [
              { path: entry.relativePath },
              ...(entry.entryType === "DIRECTORY"
                ? [{ path: { startsWith: oldSharePrefix } }]
                : []),
            ],
          },
          select: { id: true, path: true },
          take: 10_001,
        });
        if (activeShares.length > 10_000) {
          throw new BusinessError(tr("backend.storageHardening.files.tooManyShares"));
        }
        for (const share of activeShares) {
          await tx.shareLink.update({
            where: { id: share.id },
            data: {
              path:
                share.path === entry.relativePath
                  ? newRelativePath
                  : share.path.replace(oldSharePrefix, newSharePrefix),
            },
          });
        }

        if (entry.entryType === "DIRECTORY") {
          const oldPrefix = entry.relativePath + "/";
          const newPrefix = newRelativePath + "/";
          // Their bytes move with the parent, including recycle-bin entries.
          const CHILD_CAP = 10_000;
          const children = await tx.fileEntry.findMany({
            where: {
              storageNodeId: entry.storageNodeId,
              relativePath: { startsWith: oldPrefix },
            },
            select: { id: true, relativePath: true },
            take: CHILD_CAP + 1,
          });
          if (children.length > CHILD_CAP) {
            throw new BusinessError(
              tr("backend.storageHardening.files.tooManyChildren"),
            );
          }

          for (const child of children) {
            await tx.fileEntry.update({
              where: { id: child.id },
              data: { relativePath: child.relativePath.replace(oldPrefix, newPrefix) },
            });
          }
        }
      });
    } catch (databaseError) {
      // The backing move already succeeded. Compensate it if the atomic DB
      // update fails so storage and metadata do not remain permanently split.
      try {
        if (await statBackingObject({ storageNode: entry.storageNode, relativePath: normalizedCurrentPath.path })) throw new Error(apiCopy("apiCopy.files.op.exists", { v0: normalizedCurrentPath.path }));
        await moveBackingObject({
          storageNode: entry.storageNode,
          oldRelativePath: newRelativePath,
          newRelativePath: normalizedCurrentPath.path,
        });
      } catch (compensationError) {
        throw new FileOperationUncertainError(apiCopy("apiCopy.files.op.moveUnconfirmed", {
          v0: normalizedCurrentPath.path, v1: newRelativePath,
          v2: `${getErrorMessage(databaseError, String(databaseError))}; ${getErrorMessage(compensationError, String(compensationError))}`,
        }));
      }
      throw databaseError;
    }

    return {
      success: tr("filesPage.move.success", { path: `/${newRelativePath}` }),
    } satisfies MoveFileActionState;
  } catch (error) {
    if (error instanceof FileOperationUncertainError) throw error;
    return {
      error: getErrorMessage(error, tr("filesPage.move.errorMoveFailed")),
    } satisfies MoveFileActionState;
  } finally {
    await release?.();
  }
}
