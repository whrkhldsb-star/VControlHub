import { lockStorageFileOverwrite } from "./file-overwrite-lock";
import { getReadableStorageScope, readableStorageScopeWhere, readableStorageScopeSql } from "./readable-scope";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { assertNotRecycled, noRecycledAncestorSql } from "@/lib/storage/archive-access";
import { stat } from "node:fs/promises";
import path from "node:path";

import { Prisma } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { assertStorageAccess, getStorageAccessCapabilities, getStorageAccessCapabilityKey, releaseStorageQuotaGuard, STORAGE_ACCESS_DENIED_REASONS } from "./access-control";
import { storageAccessDeniedCopy } from "./access-denied";
import { seesAllCustomers, teamWhere } from "@/lib/auth/team-scope";
import { prisma, isUniqueViolation } from "@/lib/db";
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { t } from "@/lib/i18n/service-translations";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { normalizeRemotePath } from "@/lib/storage/remote-path";
import { resolveStorageRemotePath } from "@/lib/storage/remote-containment";
import { resolveStorageSshCredentials, resolveStorageSshPort } from "@/lib/storage/ssh-credentials";
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
import { isStorageStagingPath, storageStagingPathRegex } from "./staging-paths";
import { createRemoteStorageClient } from "./agent-file-client";
import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> & Partial<Pick<SessionPayload, "permissions">>;

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
        server: { select: { id: true; name: true; host: true; port: true; operatingSystem: true } };
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
    // The path is held by a recycle-bin entry. Reviving it silently made that
    // entry vanish from the bin with its versions hanging off the reused row,
    // while uploads and moves refuse the same situation (A4-05): refuse too.
    const t = await serviceT();
    throw new ConflictError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${payload.relativePath}` }));
  }

  await assertNotRecycled(payload.storageNodeId, payload.relativePath, "write");
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
        const t = await serviceT();
        throw new ConflictError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${payload.relativePath}` }));
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
        agentFileShare: { select: { rootIdentity: true } };
        host: true;
        port: true;
        username: true;
        teamId: true;
        hostKeySha256: true;
        server: {
          select: {
            id: true;
            teamId: true;
            host: true;
            port: true;
            username: true;
            connectionType: true;
            managementMode: true;
            operatingSystem: true;
            password: true;
            hostKeySha256: true;
            sshKey: { select: typeof SSH_KEY_CREDENTIAL_SELECT };
          };
        };
      };
    };
  };
}>;

export type { DeletedFileEntryWithNode };

async function assertDeletedEntryStillExists(entry: Pick<DeletedFileEntryWithNode, "storageNode" | "entryType" | "relativePath" | "deletedAgentRoot" | "storageVersion">) {
  const t = await serviceT();
  const agent = entry.storageNode.driver === "AGENT";
  if ((agent || entry.deletedAgentRoot) && (!agent || !entry.deletedAgentRoot || !entry.storageVersion ||
      entry.storageNode.agentFileShare?.rootIdentity !== entry.deletedAgentRoot)) {
    throw new ConflictError(t("backend.storage.recycledAgentChanged"));
  }
  if (entry.storageNode.driver === "WEBDAV" || agent) {
    let remoteEntry;
    try {
      remoteEntry = await createRemoteStorageClient({ ...entry.storageNode, expectedRoot: entry.deletedAgentRoot ?? undefined }).stat(entry.relativePath, true);
    } catch {
      throw new BusinessError(t("backend.storage.remoteFileCheckFailed"));
    }
    if (!remoteEntry) throw new BusinessError(t("backend.storage.remoteFileMissing"));
    if (agent && remoteEntry.etag !== entry.storageVersion) throw new ConflictError(t("backend.storage.recycledAgentChanged"));
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
  try {
    normalizeRemotePath(entry.storageNode.basePath, normalizedParent);
  } catch {
    throw new BusinessError(t("backend.storage.remotePathInvalid"));
  }

  const credentials = resolveStorageSshCredentials(entry.storageNode);
  // The parent's physical location must be the same place inside the node.
  const remoteParentPath = (await resolveStorageRemotePath(entry.storageNode, normalizedParent, { allowRoot: true, credentials })).remotePath;
  let entries;
  try {
    entries = await listRemoteDirectory({
      ...credentials,
      remotePath: remoteParentPath,
      requireComplete: true,
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
          agentFileShare: { select: { rootIdentity: true } },
          host: true,
          port: true,
          username: true,
          hostKeySha256: true,
          server: {
            select: {
              id: true,
              teamId: true,
              host: true,
              port: true,
              username: true,
              connectionType: true,
              managementMode: true,
              operatingSystem: true,
              password: true,
              hostKeySha256: true,
              sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
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

  const actor: SessionPayload = { ...session, username: "", mustChangePassword: false };
  const children = current.entryType === "DIRECTORY" && current.deleteBatchId ? await prisma.fileEntry.findMany({
    where: {
      storageNodeId: current.storageNodeId,
      deleteBatchId: current.deleteBatchId,
      isDeleted: true,
      relativePath: { startsWith: escapeLikeLiteral(`${current.relativePath}/`) },
    },
    select: { id: true, relativePath: true, entryType: true, size: true, deletedAgentRoot: true, storageVersion: true, updatedAt: true },
  }) : [];
  if (children.length > 0) {
    // One batched capability lookup for the whole batch instead of 2–3
    // queries per child inside the operation lock (R0-06).
    const capabilities = await getStorageAccessCapabilities({
      session: actor,
      targets: children.map((child) => ({ storageNodeId: current.storageNodeId, relativePath: child.relativePath })),
    });
    for (const child of children) {
      const key = getStorageAccessCapabilityKey({ storageNodeId: current.storageNodeId, relativePath: child.relativePath });
      if (!key || capabilities.get(key)?.canDelete !== true) {
        throw new BusinessError(storageAccessDeniedCopy(STORAGE_ACCESS_DENIED_REASONS.noAccess));
      }
    }
  }
  const files = [current, ...children].filter((row) => row.entryType === "FILE");
  const bytes = files.reduce((sum, row) => sum + (row.size ?? BigInt(0)), BigInt(0));
  const largest = files.reduce((max, row) => (row.size ?? BigInt(0)) > max ? row.size! : max, BigInt(0));
  const capacity = await assertStorageAccess({ session: actor, storageNodeId: current.storageNodeId, relativePath: current.relativePath, operation: "delete", writeBytes: bytes, largestFileBytes: largest });
  if (!capacity.allowed) throw new BusinessError(storageAccessDeniedCopy(capacity.reason));
  let releasePath: (() => Promise<void>) | undefined;
  try {
    releasePath = await lockStorageFileOverwrite(current.storageNodeId, current.relativePath);
    const slash = current.relativePath.lastIndexOf("/");
    if (slash >= 0) await assertNotRecycled(current.storageNodeId, current.relativePath.slice(0, slash), "write", current.storageNode.driver);
    const batch = [current, ...children];
    for (const member of batch) {
      await assertDeletedEntryStillExists({ ...member, storageNode: current.storageNode });
    }
    const restoreWhere = {
      storageNodeId: current.storageNodeId,
      storageNode: {
        teamId: current.storageNode.teamId ?? null,
        ...(current.deletedAgentRoot ? { agentFileShare: { is: { rootIdentity: current.deletedAgentRoot } } } : {}),
      },
      deleteBatchId: current.deleteBatchId,
      isDeleted: true,
    };
    const data = { isDeleted: false, deleteBatchId: null, deletedAgentRoot: null };
    if (children.length) {
      return await prisma.$transaction(async (tx) => {
        const restored = await tx.fileEntry.updateMany({
          where: { ...restoreWhere, OR: batch.map(({ id, relativePath, updatedAt }) => ({ id, relativePath, updatedAt })) },
          data,
        });
        if (restored.count !== batch.length) throw new ConflictError(t("backend.storage.recycleBatchChanged"));
        return tx.fileEntry.findUniqueOrThrow({ where: { id: current.id } });
      });
    }
    return await prisma.fileEntry.update({
      where: { ...restoreWhere, id: current.id, relativePath: current.relativePath, updatedAt: current.updatedAt },
      data,
    });
  } finally {
    try { await releasePath?.(); } finally { await releaseStorageQuotaGuard(capacity); }
  }
}

type FileEntryPageOptions = { take?: number; skip?: number; cursor?: string; ids?: string[] };

async function visibleFilePageIds(storageNodeId: string | undefined, options: FileEntryPageOptions, session?: TeamSession | null, readable?: Awaited<ReturnType<typeof getReadableStorageScope>>) {
  const { take, skip, cursor } = buildPaginationArgs(options);
  if (options.ids?.length === 0 || take === 0) return [];
  const teamId = session?.currentTeamId;
  if (session && !teamId && !seesAllCustomers(session)) return [];
  const direction = take < 0 ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const cursorFilter = cursor
    ? Prisma.sql`AND (e."entryType", e."relativePath", e.id) ${take < 0 ? Prisma.sql`<=` : Prisma.sql`>=`}
        (SELECT "entryType", "relativePath", id FROM file_entries WHERE id = ${cursor.id})`
    : Prisma.empty;
  const rows = await prisma.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    SELECT e.id FROM file_entries e
    WHERE e."isDeleted" = false AND ${readableStorageScopeSql(readable)} AND ${noRecycledAncestorSql} AND e."relativePath" !~ ${storageStagingPathRegex}
      ${storageNodeId ? Prisma.sql`AND e."storageNodeId" = ${storageNodeId}` : Prisma.empty}
      ${teamId ? Prisma.sql`AND e."storageNodeId" IN (SELECT id FROM "StorageNode" WHERE "teamId" = ${teamId})` : Prisma.empty}
      ${options.ids ? Prisma.sql`AND e.id IN (${Prisma.join(options.ids)})` : Prisma.empty}
      ${cursorFilter}
    ORDER BY e."entryType" ${direction}, e."relativePath" ${direction}, e.id ${direction}
    LIMIT ${Math.abs(take)} OFFSET ${skip ?? 0}
  `);
  return rows.map(row => row.id);
}

export async function listFileEntries(
  storageNodeId?: string,
  options: FileEntryPageOptions = {},
  session?: TeamSession | null,
) {
  const readable = session ? await getReadableStorageScope(session) : null;
  const ids = await visibleFilePageIds(storageNodeId, options, session, readable);
  if (!ids.length) return [];
  const where = {
    isDeleted: false,
    ...(storageNodeId ? { storageNodeId } : {}),
    id: { in: ids },
    ...(readable ? { AND: [readableStorageScopeWhere(readable)] } : {}),
    ...storageNodeTeamFilter(session),
  };

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
          server: { select: { id: true, name: true, host: true, port: true, operatingSystem: true } },
        },
      },
    },
  });

  return entries.filter(entry => !isStorageStagingPath(entry.relativePath)).map((entry: FileEntryListRow) => {
    const directAccess = buildDirectAccessStrategy({
      driver: entry.storageNode.driver,
      nodeId: entry.storageNode.id,
      host: entry.storageNode.host ?? entry.storageNode.server?.host,
      port: resolveStorageSshPort(entry.storageNode),
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
  const readable = session ? await getReadableStorageScope(session) : null;
  const where = {
    isDeleted: true,
    ...(readable ? { AND: [readableStorageScopeWhere(readable)] } : {}),
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
