"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { moveBackingObject } from "@/lib/storage/fs-backend";
import { getServerLocale, t } from "@/lib/i18n/translations";
import {
  joinStoragePath,
  normalizeStorageRelativePath,
  normalizeStorageTargetDirectory,
} from "@/lib/storage/path-utils";

export type MoveFileActionState = { error?: string; success?: string };

export async function moveFileAction(
  _prev: MoveFileActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("storage:write");
  const locale = await getServerLocale();
  const tr = (key: string) => t(key, locale);

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

    if (!entry)
      return { error: tr("filesPage.move.errorFileNotFound") } satisfies MoveFileActionState;

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

    const destinationAccess = await assertStorageAccess({
      session,
      storageNodeId: entry.storageNodeId,
      relativePath: newRelativePath,
      operation: "write",
    });

    if (!destinationAccess.allowed) {
      return {
        error: destinationAccess.reason ?? tr("filesPage.move.errorNoAccess"),
      } satisfies MoveFileActionState;
    }

    if (newRelativePath === entry.relativePath) {
      return { error: tr("filesPage.move.errorSamePath") } satisfies MoveFileActionState;
    }

    // 检查目标路径是否已存在
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
        error: tr("filesPage.move.errorTargetExists").replace("{path}", `/${newRelativePath}`),
      } satisfies MoveFileActionState;
    }

    // LOCAL/SFTP 节点：在磁盘/远端实际移动文件，成功后再更新 DB，避免 DB/磁盘路径不一致
    try {
      await moveBackingObject({
        storageNode: entry.storageNode,
        oldRelativePath: normalizedCurrentPath.path,
        newRelativePath,
      });
    } catch (error) {
      const driverLabel =
        entry.storageNode.driver === "LOCAL" ? tr("filesPage.move.driverLocal") : tr("filesPage.move.driverRemote");
      return {
        error: tr("filesPage.move.errorBackingMoveFailed").replace("{driver}", driverLabel).replace("{message}", error instanceof Error ? error.message : tr("filesPage.move.errorUnknown")),
      } satisfies MoveFileActionState;
    }

    // 如果是目录，还需要更新所有子条目的路径
    if (entry.entryType === "DIRECTORY") {
      const oldPrefix = entry.relativePath + "/";
      const newPrefix = newRelativePath + "/";

      const children = await prisma.fileEntry.findMany({
        where: {
          storageNodeId: entry.storageNodeId,
          relativePath: { startsWith: oldPrefix },
        },
        select: { id: true, relativePath: true },
        take: 10_000,
      });

      // N+1 acceptable: non-uniform per-item writes (each row gets a computed relativePath)
      for (const child of children) {
        await prisma.fileEntry.update({
          where: { id: child.id },
          data: {
            relativePath: child.relativePath.replace(oldPrefix, newPrefix),
          },
        });
      }
    }

    // 更新文件条目路径
    await prisma.fileEntry.update({
      where: { id: fileEntryId },
      data: { relativePath: newRelativePath },
    });

    revalidatePath("/");
    revalidatePath("/storage");
    revalidatePath("/files");

    return {
      success: tr("filesPage.move.success").replace("{path}", `/${newRelativePath}`),
    } satisfies MoveFileActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : tr("filesPage.move.errorMoveFailed"),
    } satisfies MoveFileActionState;
  }
}
