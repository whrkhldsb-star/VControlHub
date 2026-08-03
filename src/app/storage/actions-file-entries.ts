"use server";

import { revalidatePath } from "next/cache";

import { auditUserAction } from "@/lib/audit/service";
import { requirePermission } from "@/lib/auth/authorization";
import { teamWhere } from "@/lib/auth/team-scope";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { prisma } from "@/lib/db";
import { serverT } from "@/lib/i18n/server-locale";
import { restoreFileEntry } from "@/lib/storage/service";
import { deleteBackingObject } from "@/lib/storage/fs-backend";

import type { StorageActionState, StorageDeleteActionState } from "./actions-helpers";
import { getErrorMessage } from "@/lib/http/error-message";

async function findAffectedShareIds(input: {
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
		revokeShares,
      ]);
    } else {
	  await prisma.$transaction([
		prisma.fileEntry.update({
		  where: { id: fileEntryId },
		  data: { isDeleted: true },
		}),
		revokeShares,
	  ]);
    }

    await auditUserAction(session.userId, "storage.file_delete", {
      entryId: entry.id,
      entryName: entry.name,
      relativePath: entry.relativePath,
      physicalDeleted: false,
      recycleBin: true,
    }, "INFO");

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");
    revalidatePath("/files/recycle-bin");

    return {
      success: t("storagePage.action.fileMovedToRecycle", { name: entry.name }),
      physicalDeleted: false,
      needsReconcile: false,
    } satisfies StorageDeleteActionState;
  } catch (error) {
    return {
      error: getErrorMessage(error, t("storagePage.action.fileDeleteFailed")),
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
    revalidatePath("/files/recycle-bin");

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
      return { error: permDeleteAccess.reason ?? t("storagePage.action.fileEntryNotFound") } satisfies StorageActionState;
    }

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
	  await prisma.$transaction([
		prisma.fileEntry.delete({ where: { id: fileEntryId } }),
		revokeShares,
	  ]);
    }

    await auditUserAction(session.userId, "storage.file_permanent_delete", {
      entryId: entry.id,
      entryName: entry.name,
      relativePath: entry.relativePath,
    }, "WARNING");

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");
    revalidatePath("/files/recycle-bin");

    return { success: t("storagePage.action.filePermanentlyDeleted", { name: entry.name }) } satisfies StorageActionState;
  } catch (error) {
    return {
      error: getErrorMessage(error, t("storagePage.action.filePermanentlyDeleteFailed")),
    } satisfies StorageActionState;
  }
}
