import { stat } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma, isUniqueViolation } from "@/lib/db";
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { t } from "@/lib/i18n/service-translations";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import {
  EDITABLE_TEXT_EXTENSIONS,
  EDITABLE_TEXT_MIME_PREFIXES,
  EDITABLE_TEXT_MIME_TYPES,
  isPreviewableFile,
} from "./mime-constants";
import {
  createFileEntrySchema,
  fileEntryMutationSchema,
  type CreateFileEntryInput,
  type FileEntryMutationInput,
} from "./schema";
import { buildDirectAccessStrategy } from "./service-direct-access";
import { createWebDavClient } from "./webdav-client";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

function storageNodeTeamFilter(session?: TeamSession | null): Record<string, unknown> {
  if (!session) return {};
  return { storageNode: teamWhere(session) };
}

export function resolveLocalAbsolutePath(basePath: string, relativePath: string) {
  const resolved = resolveStoragePathWithinBase(basePath, relativePath);
  if (!resolved.ok) {
    throw new ValidationError(t("backend.storage.invalidPath"));
  }
  return resolved.path;
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

/**
 * Shared pagination builder for fileEntry list queries (TR: two verbatim
 * copies used to sit inline in listFileEntries / listDeletedFileEntries).
 *
 * take defaults to a 1000-row cap (P2 收敛: caller can override explicitly so
 * an ever-growing fileEntry table cannot blow up memory in one pull). Cursor
 * semantics: `cursor` alone starts AT the cursor (inclusive); with `skip` too,
 * Prisma skips N past the cursor, so skip is bumped by one to keep the cursor
 * row included.
 */
function buildPaginationArgs(options: { take?: number; skip?: number; cursor?: string }): {
  take: number;
  skip?: number;
  cursor?: { id: string };
} {
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
  return paginationArgs;
}

/**
 * Field-identical summary prefix shared by the list and deleted-list row
 * mappers (TR: two verbatim copies). Generic so each caller's distinct
 * storageNode include shape flows through unchanged; the explicit return type
 * keeps T["storageNode"] deferred instead of widening to unknown.
 */
function toEntrySummary<
  T extends {
    id: string;
    storageNodeId: string;
    name: string;
    entryType: "FILE" | "DIRECTORY";
    mimeType: string | null;
    size: bigint | null;
    checksumSha256: string | null;
    relativePath: string;
    parentId: string | null;
    isDeleted: boolean;
    createdAt: Date;
    updatedAt: Date;
    storageNode: unknown;
  },
>(entry: T): {
  id: T["id"];
  storageNodeId: T["storageNodeId"];
  name: T["name"];
  entryType: T["entryType"];
  mimeType: T["mimeType"];
  size: T["size"];
  checksumSha256: T["checksumSha256"];
  relativePath: T["relativePath"];
  parentId: T["parentId"];
  isDeleted: T["isDeleted"];
  createdAt: string;
  updatedAt: string;
  storageNode: T["storageNode"];
} {
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
  };
}

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
    const t = await serviceT();
    throw new ConflictError(t("backend.storage.pathAlreadyExists", { path: payload.relativePath }));
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

  try {
    return await prisma.fileEntry.create({
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
  } catch (error) {
    // Concurrent first-time create: unique ([storageNodeId, relativePath]) loser → re-enter update path.
    if (isUniqueViolation(error)) {
      const raced = await prisma.fileEntry.findFirst({
        where: {
          storageNodeId: payload.storageNodeId,
          relativePath: payload.relativePath,
        },
        select: { id: true, isDeleted: true },
      });
      if (raced && !raced.isDeleted) {
        const t = await serviceT();
        throw new ConflictError(t("backend.storage.pathAlreadyExists", { path: payload.relativePath }));
      }
      if (raced?.isDeleted) {
        return prisma.fileEntry.update({
          where: { id: raced.id },
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
    }
    throw error;
  }
}

type DeletedFileEntryWithNode = Prisma.FileEntryGetPayload<{
  include: {
    storageNode: {
      select: {
        id: true;
        driver: true;
        basePath: true;
        webdavConfigEncrypted: true;
        host: true;
        port: true;
        username: true;
        hostKeySha256: true;
        server: {
          select: {
            id: true;
            host: true;
            port: true;
            username: true;
            connectionType: true;
            managementMode: true;
            password: true;
            hostKeySha256: true;
            sshKey: { select: { privateKey: true } };
          };
        };
      };
    };
  };
}>;

export type { DeletedFileEntryWithNode };

async function assertDeletedEntryStillExists(entry: DeletedFileEntryWithNode) {
  const t = await serviceT();
  if (entry.storageNode.driver === "WEBDAV") {
    let remoteEntry;
    try {
      remoteEntry = await createWebDavClient(entry.storageNode).stat(entry.relativePath);
    } catch {
      throw new BusinessError(t("backend.storage.remoteFileCheckFailed"));
    }
    if (!remoteEntry) throw new BusinessError(t("backend.storage.remoteFileMissing"));
    if (entry.entryType === "DIRECTORY" && !remoteEntry.isDirectory) {
      throw new BusinessError(t("backend.storage.remotePathNotDirectory"));
    }
    if (entry.entryType === "FILE" && remoteEntry.isDirectory) {
      throw new BusinessError(t("backend.storage.remotePathNotFile"));
    }
    return;
  }
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

export async function restoreFileEntry(
  input: FileEntryMutationInput,
  session: TeamSession,
) {
  const payload = fileEntryMutationSchema.parse(input);
  const current = await prisma.fileEntry.findFirst({
    where: {
      id: payload.fileEntryId,
      storageNode: teamWhere(session),
    },
    include: {
      storageNode: {
        select: {
          id: true,
          teamId: true,
          driver: true,
          basePath: true,
          webdavConfigEncrypted: true,
          host: true,
          port: true,
          username: true,
          hostKeySha256: true,
          server: {
            select: {
              id: true,
              host: true,
              port: true,
              username: true,
              connectionType: true,
              managementMode: true,
              password: true,
              hostKeySha256: true,
              sshKey: { select: { privateKey: true } },
            },
          },
        },
      },
    },
  });

  if (!current) {
    const t = await serviceT();
    throw new NotFoundError(t("backend.storage.fileEntryNotFound"));
  }

  if (!current.isDeleted) {
    const t = await serviceT();
    throw new BusinessError(t("backend.storage.fileEntryNotInRecycleBin"));
  }

  await assertDeletedEntryStillExists(current);

  return prisma.fileEntry.update({
    where: {
      id: payload.fileEntryId,
      storageNode: { teamId: current.storageNode.teamId ?? null },
    },
    data: { isDeleted: false, deleteBatchId: null },
  });
}

export async function listFileEntries(
  storageNodeId?: string,
  options: { take?: number; skip?: number; cursor?: string; ids?: string[] } = {},
  session?: TeamSession | null,
) {
  const where = {
    isDeleted: false,
    ...(storageNodeId ? { storageNodeId } : {}),
    ...(options.ids ? { id: { in: options.ids } } : {}),
    ...storageNodeTeamFilter(session),
  };

  // P2 收敛: 默认 take=1000 上界, caller 传 take 显式覆盖。防止 fileEntry 表无界增长后单次拉爆内存。
  const paginationArgs = buildPaginationArgs(options);

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
      ...toEntrySummary<FileEntryListRow>(entry),
      sizeLabel: entry.size == null ? "-" : formatFileSize(Number(entry.size)),
      directAccess,
      // LOCAL drafts use /api/files/editable; SFTP drafts use sftp-ops.
      // The UI capability must include both or remote text editing stays hidden.
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
  session?: TeamSession | null,
) {
  const where = {
    isDeleted: true,
    ...(storageNodeId ? { storageNodeId } : {}),
    ...storageNodeTeamFilter(session),
  };

  // P2 收敛: 默认 take=1000 上界, caller 传 take 显式覆盖。
  const paginationArgs = buildPaginationArgs(options);

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
    ...toEntrySummary<DeletedFileEntryRow>(entry),
    sizeLabel: entry.size == null ? "-" : formatFileSize(Number(entry.size)),
  }));
}
