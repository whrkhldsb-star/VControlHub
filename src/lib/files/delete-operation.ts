import { auditUserAction } from "@/lib/audit/service";
import crypto from "node:crypto";
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { prisma } from "@/lib/db";
import { serviceT } from "@/lib/i18n/service-locale";
import type { Locale } from "@/lib/i18n/core";
import { getErrorMessage } from "@/lib/http/error-message";
import type { StorageDeleteActionState } from "@/app/storage/actions-helpers";
import { tryAcquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { apiCopy } from "@/lib/i18n/api-copy";

export async function findAffectedShareIds(input: {
  storageNodeId: string;
  relativePath: string;
  isDirectory: boolean;
}): Promise<string[]> {
  const shares = await prisma.shareLink.findMany({
    where: {
      storageNodeId: input.storageNodeId,
      revokedAt: null,
      OR: [
        { path: input.relativePath },
        ...(input.isDirectory
          ? [{ path: { startsWith: `${input.relativePath}/` } }]
          : []),
        { entryType: "DIRECTORY" },
      ],
    },
    select: { id: true, path: true, entryType: true },
  });
  return shares
    .filter(
      (share) =>
        share.path === input.relativePath ||
        (input.isDirectory && share.path.startsWith(`${input.relativePath}/`)) ||
        (share.entryType === "DIRECTORY" &&
          input.relativePath.startsWith(`${share.path.replace(/\/+$/, "")}/`)),
    )
    .map((share) => share.id);
}

export async function executeDeleteFile(
  session: SessionPayload,
  formData: FormData,
  locale?: Locale,
): Promise<StorageDeleteActionState> {

  const t = await serviceT(locale);
  let release: (() => Promise<void>) | null = null;
  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();

    if (!fileEntryId) {
      return { error: t("storagePage.action.missingFileEntryParam") } satisfies StorageDeleteActionState;
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
      return { error: t("storagePage.action.fileEntryNotFound") } satisfies StorageDeleteActionState;
    }
    release = await tryAcquireAdvisoryLock("storage-file-operation", entry.storageNodeId);
    if (!release) throw new Error(apiCopy("apiCopy.files.op.busy"));
    const current = await prisma.fileEntry.findFirst({
      where: { id: fileEntryId, isDeleted: false, storageNode: teamWhere(session) },
      select: { relativePath: true, storageNodeId: true, entryType: true },
    });
    if (!current || current.relativePath !== entry.relativePath ||
        current.storageNodeId !== entry.storageNodeId || current.entryType !== entry.entryType) {
      throw new Error(apiCopy("apiCopy.files.op.changed"));
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

    if (entry.entryType === "DIRECTORY") {
      const descendants = await prisma.fileEntry.findMany({ where: { storageNodeId: entry.storageNodeId, relativePath: { startsWith: `${entry.relativePath}/` }, isDeleted: false }, select: { relativePath: true }, take: 10001 });
      if (descendants.length > 10000) throw new Error("Directory has more than 10000 children; split the deletion");
      for (const child of descendants) {
        const access = await assertStorageAccess({ session, storageNodeId: entry.storageNodeId, relativePath: child.relativePath, operation: "delete" });
        if (!access.allowed) throw new Error(access.reason ?? t("storagePage.action.fileEntryNotFound"));
      }
    }

	const affectedShareIds = await findAffectedShareIds({
	  storageNodeId: entry.storageNodeId,
	  relativePath: entry.relativePath,
	  isDirectory: entry.entryType === "DIRECTORY",
	});
	const revokeShares = prisma.shareLink.updateMany({
	  where: { id: { in: affectedShareIds }, revokedAt: null },
	  data: { revokedAt: new Date() },
	});

    // Soft-delete is index-only. Revoke every direct, descendant, or parent
    // directory share in the same transaction so recycle-bin bytes cannot be
    // reached through an already-issued public token.
    if (entry.entryType === "DIRECTORY") {
      const prefix = entry.relativePath + "/";
      // Tag every soft-deleted row with this operation's batch id so a later
      // directory restore can revive exactly this batch — not descendants
      // that were already sitting in the recycle bin before this delete.
      const deleteBatchId = crypto.randomUUID();
      await prisma.$transaction([
        prisma.fileEntry.updateMany({
          where: {
            storageNodeId: entry.storageNodeId,
            relativePath: { startsWith: prefix },
            isDeleted: false,
          },
          data: { isDeleted: true, deleteBatchId },
        }),
        prisma.fileEntry.update({
          where: { id: fileEntryId },
          data: { isDeleted: true, deleteBatchId },
        }),
		revokeShares,
      ]);
    } else {
	  await prisma.$transaction([
		prisma.fileEntry.update({
		  where: { id: fileEntryId },
		  data: { isDeleted: true, deleteBatchId: crypto.randomUUID() },
		}),
		revokeShares,
	  ]);
    }

    await auditUserAction(
      session.userId,
      "storage.file_delete",
      {
        entryId: entry.id,
        entryName: entry.name,
        relativePath: entry.relativePath,
        physicalDeleted: false,
        recycleBin: true,
      },
      "INFO",
      session.currentTeamId,
    );

    return {
      success: t("storagePage.action.fileMovedToRecycle", { name: entry.name }),
      physicalDeleted: false,
      needsReconcile: false,
    } satisfies StorageDeleteActionState;
  } catch (error) {
    return {
      error: getErrorMessage(error, t("storagePage.action.fileDeleteFailed")),
    } satisfies StorageDeleteActionState;
  } finally {
    await release?.();
  }
}
