import { stat } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { serverT } from "@/lib/i18n/server-locale";
import { t } from "@/lib/i18n/translations";
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
    throw new ValidationError(t("backend.storage.invalidPath"));
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
    const t = await serverT();
    throw new ConflictError(t("backend.storage.pathAlreadyExists").replace("{path}", payload.relativePath));
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
    const t = await serverT();
    throw new NotFoundError(t("backend.storage.fileEntryNotFound"));
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
    const t = await serverT();
    throw new NotFoundError(t("backend.storage.fileEntryNotFound"));
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
  const t = await serverT();
  if (entry.storageNode.driver === "LOCAL") {
    const absolutePath = resolveLocalAbsolutePath(
      entry.storageNode.basePath,
      entry.relativePath,
    );
    let fileStat;
    try {
      fileStat = await stat(absolutePath);
    } catch {
      throw new BusinessError(t("backend.storage.originalFileMissing"));
    }

    if (entry.entryType === "DIRECTORY" && !fileStat.isDirectory()) {
      throw new BusinessError(t("backend.storage.originalPathNotDirectory"));
    }
    if (entry.entryType === "FILE" && !fileStat.isFile()) {
      throw new BusinessError(t("backend.storage.originalPathNotFile"));
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
    throw new BusinessError(t("backend.storage.remotePathInvalid"));
  }

  const credentials = resolveStorageSshCredentials(entry.storageNode);
  let entries;
  try {
    entries = await listRemoteDirectory({
      ...credentials,
      remotePath: remoteParentPath,
    });
  } catch {
    throw new BusinessError(t("backend.storage.remoteFileCheckFailed"));
  }

  const expectedName = path.posix.basename(entry.relativePath);
  const remoteEntry = entries.find(
    (candidate) => candidate.name === expectedName,
  );
  if (!remoteEntry) {
    throw new BusinessError(t("backend.storage.remoteFileMissing"));
  }

  if (entry.entryType === "DIRECTORY" && remoteEntry.type !== "directory") {
    throw new BusinessError(t("backend.storage.remotePathNotDirectory"));
  }
  if (entry.entryType === "FILE" && remoteEntry.type !== "file") {
    throw new BusinessError(t("backend.storage.remotePathNotFile"));
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
    const t = await serverT();
    throw new NotFoundError(t("backend.storage.fileEntryNotFound"));
  }

  if (!current.isDeleted) {
    const t = await serverT();
    throw new BusinessError(t("backend.storage.fileEntryNotInRecycleBin"));
  }

  await assertDeletedEntryStillExists(current);

  return prisma.fileEntry.update({
    where: { id: payload.fileEntryId },
    data: { isDeleted: false },
  });
}

export async function listFileEntries(
  storageNodeId?: string,
  options: { take?: number; skip?: number; cursor?: string } = {},
) {
  const where = {
    isDeleted: false,
    ...(storageNodeId ? { storageNodeId } : {}),
  };

  // P2 收敛: 默认 take=1000 上界, caller 传 take 显式覆盖。防止 fileEntry 表无界增长后单次拉爆内存。
  const paginationArgs: { take: number; skip?: number; cursor?: { id: string } } = {
    take: typeof options.take === "number" ? options.take : 1000,
  };
  if (typeof options.skip === "number") {
    paginationArgs.skip = options.skip;
    if (options.cursor) {
      // With both `cursor` and `skip` set, Prisma positions *at* the cursor
      // and then skips N more. We always want the cursor row included, so
      // bump skip by one to offset the cursor row being skipped internally.
      paginationArgs.cursor = { id: options.cursor };
      paginationArgs.skip = options.skip + 1;
    }
  } else if (options.cursor) {
    // Prisma's `cursor` alone (no skip) returns rows starting at the cursor
    // (inclusive). That matches the "give me the page starting at this id"
    // semantic callers expect.
    paginationArgs.cursor = { id: options.cursor };
  }


  const entries = await prisma.fileEntry.findMany({
    where,
    orderBy: [{ entryType: "asc" }, { relativePath: "asc" }, { id: "asc" }],
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
    ...paginationArgs,
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

export async function listDeletedFileEntries(
  storageNodeId?: string,
  options: { take?: number; skip?: number; cursor?: string } = {},
) {
  const where = {
    isDeleted: true,
    ...(storageNodeId ? { storageNodeId } : {}),
  };

  // P2 收敛: 默认 take=1000 上界, caller 传 take 显式覆盖。
  const paginationArgs: { take: number; skip?: number; cursor?: { id: string } } = {
    take: typeof options.take === "number" ? options.take : 1000,
  };
  if (typeof options.skip === "number") {
    paginationArgs.skip = options.skip;
    if (options.cursor) {
      paginationArgs.cursor = { id: options.cursor };
      paginationArgs.skip = options.skip + 1;
    }
  } else if (options.cursor) {
    paginationArgs.cursor = { id: options.cursor };
  }

  const entries = await prisma.fileEntry.findMany({
    where,
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
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
    ...paginationArgs,
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
