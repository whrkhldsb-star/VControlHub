import { stat } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { expandStorageBasePath } from "@/lib/storage/path-utils";
import {
  EDITABLE_TEXT_EXTENSIONS,
  EDITABLE_TEXT_MIME_PREFIXES,
  EDITABLE_TEXT_MIME_TYPES,
  isPreviewableFile,
} from "./mime-constants";
import {
  createFileEntrySchema,
  fileEntryMutationSchema,
  updateFileEntrySchema,
  type CreateFileEntryInput,
  type FileEntryMutationInput,
  type UpdateFileEntryInput,
} from "./schema";
import { buildDirectAccessStrategy } from "./service-direct-access";

export function resolveLocalAbsolutePath(basePath: string, relativePath: string) {
  const normalizedRelativePath = relativePath.replace(/^\/+/, "");
  const allowedRoot = path.resolve(expandStorageBasePath(basePath));
  const absolutePath = path.resolve(allowedRoot, normalizedRelativePath);
  const relativeToRoot = path.relative(allowedRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new ValidationError("非法路径");
  }

  return absolutePath;
}

export function isEditableTextFile(input: {
  entryType: "FILE" | "DIRECTORY";
  name: string;
  mimeType?: string | null;
}) {
  if (input.entryType !== "FILE") {
    return false;
  }

  if (input.mimeType) {
    const normalizedMimeType = input.mimeType.toLowerCase();
    if (
      EDITABLE_TEXT_MIME_PREFIXES.some((prefix) =>
        normalizedMimeType.startsWith(prefix),
      )
    ) {
      return true;
    }

    if (EDITABLE_TEXT_MIME_TYPES.has(normalizedMimeType)) {
      return true;
    }
  }

  return EDITABLE_TEXT_EXTENSIONS.has(path.extname(input.name).toLowerCase());
}

export function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "-";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024)
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

type FileEntryListRow = Prisma.FileEntryGetPayload<{
  include: {
    storageNode: {
      select: {
        id: true;
        name: true;
        driver: true;
        basePath: true;
        host: true;
        port: true;
        username: true;
        serverId: true;
        directAccessMode: true;
        publicBaseUrl: true;
        directAccessExpiresSeconds: true;
        server: { select: { id: true; name: true; host: true; port: true } };
      };
    };
  };
}>;
type DeletedFileEntryRow = Prisma.FileEntryGetPayload<{
  include: {
    storageNode: {
      select: {
        id: true;
        name: true;
        driver: true;
        host: true;
        port: true;
        server: { select: { host: true; port: true } };
      };
    };
  };
}>;

export type { FileEntryListRow, DeletedFileEntryRow };

export async function createFileEntry(input: CreateFileEntryInput) {
  const payload = createFileEntrySchema.parse(input);

  // Check for duplicate entry (same node + same relativePath). The database enforces
  // uniqueness across both active and soft-deleted rows, so resurrect a deleted row
  // instead of attempting a create that would fail after the backing folder/file has
  // already been created.
  const existing = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId: payload.storageNodeId,
      relativePath: payload.relativePath,
    },
    select: { id: true, isDeleted: true },
  });
  if (existing && !existing.isDeleted) {
    throw new ConflictError(`路径已存在: ${payload.relativePath}`);
  }
  if (existing?.isDeleted) {
    return prisma.fileEntry.update({
      where: { id: existing.id },
      data: {
        name: payload.name,
        entryType: payload.entryType,
        mimeType: payload.mimeType,
        size: payload.size == null ? null : BigInt(payload.size),
        checksumSha256: payload.checksumSha256,
        relativePath: payload.relativePath,
        parentId: payload.parentId,
        isDeleted: false,
      },
    });
  }

  return prisma.fileEntry.create({
    data: {
      storageNodeId: payload.storageNodeId,
      name: payload.name,
      entryType: payload.entryType,
      mimeType: payload.mimeType,
      size: payload.size == null ? undefined : BigInt(payload.size),
      checksumSha256: payload.checksumSha256,
      relativePath: payload.relativePath,
      parentId: payload.parentId,
    },
  });
}

export async function updateFileEntry(input: UpdateFileEntryInput) {
  const payload = updateFileEntrySchema.parse(input);
  const current = await prisma.fileEntry.findUnique({
    where: { id: payload.fileEntryId },
  });

  if (!current) {
    throw new NotFoundError("文件条目不存在或已删除");
  }

  return prisma.fileEntry.update({
    where: { id: payload.fileEntryId },
    data: {
      storageNodeId: payload.storageNodeId ?? current.storageNodeId,
      name: payload.name ?? current.name,
      mimeType: payload.mimeType ?? current.mimeType,
      size: payload.size == null ? current.size : BigInt(payload.size),
      checksumSha256: payload.checksumSha256 ?? current.checksumSha256,
      relativePath: payload.relativePath ?? current.relativePath,
      parentId: payload.parentId ?? current.parentId,
    },
  });
}

export async function softDeleteFileEntry(input: FileEntryMutationInput) {
  const payload = fileEntryMutationSchema.parse(input);
  const current = await prisma.fileEntry.findUnique({
    where: { id: payload.fileEntryId },
  });

  if (!current) {
    throw new NotFoundError("文件条目不存在或已删除");
  }

  return prisma.fileEntry.update({
    where: { id: payload.fileEntryId },
    data: { isDeleted: true },
  });
}

type DeletedFileEntryWithNode = Prisma.FileEntryGetPayload<{
  include: {
    storageNode: {
      select: {
        id: true;
        driver: true;
        basePath: true;
        host: true;
        port: true;
        username: true;
        server: {
          select: {
            host: true;
            port: true;
            username: true;
            connectionType: true;
            password: true;
            sshKey: { select: { privateKey: true } };
          };
        };
      };
    };
  };
}>;

export type { DeletedFileEntryWithNode };

async function assertDeletedEntryStillExists(entry: DeletedFileEntryWithNode) {
  if (entry.storageNode.driver === "LOCAL") {
    const absolutePath = resolveLocalAbsolutePath(
      entry.storageNode.basePath,
      entry.relativePath,
    );
    let fileStat;
    try {
      fileStat = await stat(absolutePath);
    } catch {
      throw new BusinessError("原始文件已不存在，无法恢复索引");
    }

    if (entry.entryType === "DIRECTORY" && !fileStat.isDirectory()) {
      throw new BusinessError("原始路径已不是目录，无法恢复索引");
    }
    if (entry.entryType === "FILE" && !fileStat.isFile()) {
      throw new BusinessError("原始路径已不是文件，无法恢复索引");
    }
    return;
  }

  const parentRelativePath = path.posix.dirname(entry.relativePath);
  const normalizedParent = parentRelativePath === "." ? "" : parentRelativePath;
  let remoteParentPath: string;
  try {
    remoteParentPath = normalizeRemotePath(
      entry.storageNode.basePath,
      normalizedParent,
    );
  } catch {
    throw new BusinessError("原始远端路径非法，无法恢复索引");
  }

  const credentials = resolveStorageSshCredentials(entry.storageNode);
  let entries;
  try {
    entries = await listRemoteDirectory({
      ...credentials,
      remotePath: remoteParentPath,
    });
  } catch {
    throw new BusinessError("无法确认远端文件仍然存在，恢复已取消");
  }

  const expectedName = path.posix.basename(entry.relativePath);
  const remoteEntry = entries.find(
    (candidate) => candidate.name === expectedName,
  );
  if (!remoteEntry) {
    throw new BusinessError("原始远端文件已不存在，无法恢复索引");
  }

  if (entry.entryType === "DIRECTORY" && remoteEntry.type !== "directory") {
    throw new BusinessError("原始远端路径已不是目录，无法恢复索引");
  }
  if (entry.entryType === "FILE" && remoteEntry.type !== "file") {
    throw new BusinessError("原始远端路径已不是文件，无法恢复索引");
  }
}

export async function restoreFileEntry(input: FileEntryMutationInput) {
  const payload = fileEntryMutationSchema.parse(input);
  const current = await prisma.fileEntry.findUnique({
    where: { id: payload.fileEntryId },
    include: {
      storageNode: {
        select: {
          id: true,
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

  if (!current) {
    throw new NotFoundError("文件条目不存在或已删除");
  }

  if (!current.isDeleted) {
    throw new BusinessError("文件条目未在回收站中");
  }

  await assertDeletedEntryStillExists(current);

  return prisma.fileEntry.update({
    where: { id: payload.fileEntryId },
    data: { isDeleted: false },
  });
}

export async function listFileEntries(storageNodeId?: string) {
  const where = {
    isDeleted: false,
    ...(storageNodeId ? { storageNodeId } : {}),
  };

  const entries = await prisma.fileEntry.findMany({
    where,
    orderBy: [{ entryType: "asc" }, { relativePath: "asc" }],
    include: {
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          basePath: true,
          host: true,
          port: true,
          username: true,
          serverId: true,
          directAccessMode: true,
          publicBaseUrl: true,
          directAccessExpiresSeconds: true,
          server: { select: { id: true, name: true, host: true, port: true } },
        },
      },
    },
  });

  return entries.map((entry: FileEntryListRow) => {
    const directAccess = buildDirectAccessStrategy({
      driver: entry.storageNode.driver,
      nodeId: entry.storageNode.id,
      host: entry.storageNode.host ?? entry.storageNode.server?.host,
      port: entry.storageNode.port ?? entry.storageNode.server?.port,
      relativePath: entry.relativePath,
      directAccessMode: entry.storageNode.directAccessMode,
      publicBaseUrl: entry.storageNode.publicBaseUrl,
      directAccessExpiresSeconds: entry.storageNode.directAccessExpiresSeconds,
    });

    return {
      id: entry.id,
      storageNodeId: entry.storageNodeId,
      name: entry.name,
      entryType: entry.entryType,
      mimeType: entry.mimeType,
      size: entry.size,
      checksumSha256: entry.checksumSha256,
      relativePath: entry.relativePath,
      parentId: entry.parentId,
      isDeleted: entry.isDeleted,
      createdAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
      updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
      storageNode: entry.storageNode,
      sizeLabel: entry.size == null ? "-" : formatFileSize(Number(entry.size)),
      directAccess,
      localEditable:
        (entry.storageNode.driver === "LOCAL" ||
          entry.storageNode.driver === "SFTP") &&
        isEditableTextFile({
          entryType: entry.entryType,
          name: entry.name,
          mimeType: entry.mimeType,
        }),
      previewable: isPreviewableFile({
        mimeType: entry.mimeType,
        name: entry.name,
        relativePath: entry.relativePath,
      }),
    };
  });
}

export async function listDeletedFileEntries(storageNodeId?: string) {
  const where = {
    isDeleted: true,
    ...(storageNodeId ? { storageNodeId } : {}),
  };

  const entries = await prisma.fileEntry.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }],
    include: {
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          host: true,
          port: true,
          server: { select: { host: true, port: true } },
        },
      },
    },
  });

  return entries.map((entry: DeletedFileEntryRow) => ({
    id: entry.id,
    storageNodeId: entry.storageNodeId,
    name: entry.name,
    entryType: entry.entryType,
    mimeType: entry.mimeType,
    size: entry.size,
    checksumSha256: entry.checksumSha256,
    relativePath: entry.relativePath,
    parentId: entry.parentId,
    isDeleted: entry.isDeleted,
    createdAt: entry.createdAt?.toISOString?.() ?? entry.createdAt,
    updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
    storageNode: entry.storageNode,
    sizeLabel: entry.size == null ? "-" : formatFileSize(Number(entry.size)),
  }));
}
