"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/authorization";
import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import {
  expandStorageBasePath,
  joinStoragePath,
  normalizeStorageRelativePath,
  normalizeStorageTargetDirectory,
} from "@/lib/storage/path-utils";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

export type MoveFileActionState = { error?: string; success?: string };

export async function moveFileAction(
  _prev: MoveFileActionState | null,
  formData: FormData,
) {
  const session = await requirePermission("storage:write");

  try {
    const fileEntryId = String(formData.get("fileEntryId") ?? "").trim();
    const targetDir = String(formData.get("targetDir") ?? "").trim();

    if (!fileEntryId)
      return { error: "缺少文件参数" } satisfies MoveFileActionState;
    if (!targetDir)
      return { error: "目标路径不能为空" } satisfies MoveFileActionState;

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
      return { error: "文件条目不存在" } satisfies MoveFileActionState;

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
        error: destinationAccess.reason ?? "没有该存储节点或路径的访问授权",
      } satisfies MoveFileActionState;
    }

    if (newRelativePath === entry.relativePath) {
      return { error: "目标路径与当前路径相同" } satisfies MoveFileActionState;
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
        error: `目标路径 /${newRelativePath} 已存在同名文件`,
      } satisfies MoveFileActionState;
    }

    // LOCAL 节点：在磁盘上实际移动文件，成功后再更新 DB，避免 DB/磁盘路径不一致
    if (entry.storageNode.driver === "LOCAL") {
      const { rename, mkdir } = await import("node:fs/promises");
      const path = await import("node:path");
      const allowedRoot = path.resolve(expandStorageBasePath(entry.storageNode.basePath));

      const oldAbsolutePath = path.resolve(
        allowedRoot,
        normalizedCurrentPath.path,
      );
      const newAbsolutePath = path.resolve(
        allowedRoot,
        newRelativePath,
      );

      const oldRelativeToRoot = path.relative(allowedRoot, oldAbsolutePath);
      const newRelativeToRoot = path.relative(allowedRoot, newAbsolutePath);

      if (
        oldRelativeToRoot.startsWith("..") ||
        path.isAbsolute(oldRelativeToRoot) ||
        newRelativeToRoot.startsWith("..") ||
        path.isAbsolute(newRelativeToRoot)
      ) {
        return { error: "路径超出存储根目录" } satisfies MoveFileActionState;
      }

      try {
        const targetAbsDir = path.dirname(newAbsolutePath);
        await mkdir(targetAbsDir, { recursive: true });
        await rename(oldAbsolutePath, newAbsolutePath);
      } catch (error) {
        return {
          error: `本地文件移动失败：${error instanceof Error ? error.message : "未知错误"}`,
        } satisfies MoveFileActionState;
      }
    }

    if (entry.storageNode.driver === "SFTP") {
      const { createRemoteDirectory, renameRemoteFile } = await import("@/lib/ssh/client");
      const path = await import("node:path");
      let oldPath: string;
      let newPath: string;
      try {
        oldPath = normalizeRemoteTargetPath(
          entry.storageNode.basePath,
          normalizedCurrentPath.path,
        );
        newPath = normalizeRemoteTargetPath(
          entry.storageNode.basePath,
          newRelativePath,
        );
      } catch (error) {
        return {
          error: error instanceof Error ? error.message : "路径超出存储根目录",
        } satisfies MoveFileActionState;
      }

      try {
        const credentials = resolveStorageSshCredentials(entry.storageNode);
        const targetParentDirectory = path.posix.dirname(newPath);
        if (
          targetParentDirectory &&
          targetParentDirectory !== "." &&
          targetParentDirectory !== "/"
        ) {
          await createRemoteDirectory({
            ...credentials,
            remotePath: targetParentDirectory,
            recursive: true,
          });
        }
        await renameRemoteFile({ ...credentials, oldPath, newPath });
      } catch (error) {
        return {
          error: `远端文件移动失败：${error instanceof Error ? error.message : "未知错误"}`,
        } satisfies MoveFileActionState;
      }
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
      });

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
      success: `已移动到 /${newRelativePath}`,
    } satisfies MoveFileActionState;
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "移动文件失败",
    } satisfies MoveFileActionState;
  }
}
