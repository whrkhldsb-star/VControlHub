import { config } from "@/lib/config/env";

/**
 * File version history — control-plane snapshots for ordinary files.
 *
 * Design:
 * - Snapshots are taken BEFORE overwrite (upload replace / text edit / restore).
 * - Blob bytes live under FILE_VERSION_DIR (default /var/lib/vcontrolhub/file-versions).
 * - Metadata in FileVersion; retention keeps latest N versions per file.
 * - LOCAL + SFTP source files supported for snapshot/restore via storage adapters.
 * - Size cap: only snapshot bodies <= FILE_VERSION_MAX_BYTES (default 50 MiB).
 */
import * as crypto from "node:crypto";
import { createReadStream } from "node:fs";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { FileVersionReason } from "@prisma/client";

import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  BusinessError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { logError } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import {
  readStorageFileBuffer,
  writeStorageFileBuffer,
  type StorageFileNode,
} from "@/lib/storage/file-content";
import { expandStorageBasePath } from "@/lib/storage/path-utils";

export const DEFAULT_FILE_VERSION_DIR =
  config.fileVersion.dir ||
  path.join("/var/lib/vcontrolhub", "file-versions");

/** Bodies larger than this are skipped for automatic snapshots (still listable history stays). */
export const DEFAULT_FILE_VERSION_MAX_BYTES = Number(
  config.fileVersion.maxBytes,
);

/** Keep latest N versions per fileEntry. Older ones are purged (blob + row). */
export const DEFAULT_FILE_VERSION_KEEP = Number(
  config.fileVersion.keep,
);

export type FileVersionView = {
  id: string;
  fileEntryId: string;
  storageNodeId: string;
  versionNumber: number;
  name: string;
  relativePath: string;
  mimeType: string | null;
  sizeBytes: number;
  checksumSha256: string;
  reason: FileVersionReason;
  note: string | null;
  createdByUserId: string | null;
  createdByName: string | null;
  createdAt: string;
};

function blobAbsolutePath(blobRelativePath: string): string {
  const base = path.resolve(DEFAULT_FILE_VERSION_DIR);
  const abs = path.resolve(base, blobRelativePath);
  if (!abs.startsWith(base + path.sep) && abs !== base) {
    throw new ValidationError("Invalid version blob path");
  }
  return abs;
}

function toView(row: {
  id: string;
  fileEntryId: string;
  storageNodeId: string;
  versionNumber: number;
  name: string;
  relativePath: string;
  mimeType: string | null;
  sizeBytes: bigint;
  checksumSha256: string;
  reason: FileVersionReason;
  note: string | null;
  createdByUserId: string | null;
  createdAt: Date;
  createdBy?: { username?: string | null; displayName?: string | null } | null;
}): FileVersionView {
  return {
    id: row.id,
    fileEntryId: row.fileEntryId,
    storageNodeId: row.storageNodeId,
    versionNumber: row.versionNumber,
    name: row.name,
    relativePath: row.relativePath,
    mimeType: row.mimeType,
    sizeBytes: Number(row.sizeBytes),
    checksumSha256: row.checksumSha256,
    reason: row.reason,
    note: row.note,
    createdByUserId: row.createdByUserId,
    createdByName: row.createdBy?.displayName || row.createdBy?.username || null,
    createdAt: row.createdAt.toISOString(),
  };
}

async function resolveAccessibleFileEntry(input: {
  fileEntryId: string;
  session: SessionPayload;
  operation: "read" | "write";
}) {
  const entry = await prisma.fileEntry.findUnique({
    where: { id: input.fileEntryId },
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
          hostKeySha256: true,
          serverId: true,
          server: {
            select: {
              id: true,
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
  if (!entry || entry.isDeleted) {
    throw new NotFoundError("File entry not found");
  }
  if (entry.entryType !== "FILE") {
    throw new ValidationError("Only files support version history");
  }
  const access = await assertStorageAccess({
    session: input.session,
    storageNodeId: entry.storageNodeId,
    relativePath: entry.relativePath,
    operation: input.operation,
  });
  if (!access.allowed) {
    throw new ForbiddenError(access.reason ?? "No permission for this file");
  }
  return entry;
}

async function nextVersionNumber(fileEntryId: string): Promise<number> {
  const latest = await prisma.fileVersion.findFirst({
    where: { fileEntryId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return (latest?.versionNumber ?? 0) + 1;
}

async function enforceRetention(fileEntryId: string, keep = DEFAULT_FILE_VERSION_KEEP) {
  if (keep <= 0) return;
  const surplus = await prisma.fileVersion.findMany({
    where: { fileEntryId },
    orderBy: { versionNumber: "desc" },
    skip: keep,
    select: { id: true, blobRelativePath: true },
  });
  for (const row of surplus) {
    try {
      await rm(blobAbsolutePath(row.blobRelativePath), { force: true });
    } catch (err) {
      logError("file-version:blob-purge-failed", err);
    }
    await prisma.fileVersion.delete({ where: { id: row.id } }).catch(() => undefined);
  }
}

/**
 * Snapshot the *current* on-disk body of a file entry before overwrite.
 * Best-effort: size over cap / missing file / read errors return null (caller continues).
 */
export async function snapshotFileVersionBeforeOverwrite(input: {
  fileEntryId: string;
  userId?: string | null;
  reason: FileVersionReason;
  note?: string | null;
  maxBytes?: number;
}): Promise<FileVersionView | null> {
  const maxBytes = input.maxBytes ?? DEFAULT_FILE_VERSION_MAX_BYTES;
  const entry = await prisma.fileEntry.findUnique({
    where: { id: input.fileEntryId },
    include: {
      storageNode: {
        select: {
          id: true,
          driver: true,
          basePath: true,
          host: true,
          port: true,
          username: true,
          hostKeySha256: true,
          serverId: true,
          server: {
            select: {
              id: true,
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
  if (!entry || entry.isDeleted || entry.entryType !== "FILE") return null;

  let buffer: Buffer;
  try {
    const node = entry.storageNode as StorageFileNode;
    // expand LOCAL basePath placeholders
    if (node.driver === "LOCAL") {
      node.basePath = expandStorageBasePath(node.basePath);
    }
    buffer = await readStorageFileBuffer(node, entry.relativePath);
  } catch (err) {
    logError("file-version:read-source-failed", err);
    return null;
  }

  if (buffer.byteLength === 0) {
    // still allow empty snapshot (useful for first edit of empty file)
  }
  if (buffer.byteLength > maxBytes) {
    logError("file-version:skip-oversize", {
      fileEntryId: entry.id,
      size: buffer.byteLength,
      maxBytes,
    });
    return null;
  }

  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const versionNumber = await nextVersionNumber(entry.id);
  const blobRelativePath = path.posix.join(
    entry.storageNodeId,
    entry.id,
    `v${versionNumber}-${checksum.slice(0, 12)}.bin`,
  );
  const abs = blobAbsolutePath(blobRelativePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, buffer);

  try {
    const row = await prisma.fileVersion.create({
      data: {
        fileEntryId: entry.id,
        storageNodeId: entry.storageNodeId,
        versionNumber,
        name: entry.name,
        relativePath: entry.relativePath,
        mimeType: entry.mimeType,
        sizeBytes: BigInt(buffer.byteLength),
        checksumSha256: checksum,
        blobRelativePath,
        reason: input.reason,
        note: input.note ?? null,
        createdByUserId: input.userId ?? null,
      },
      include: {
        createdBy: { select: { username: true, displayName: true } },
      },
    });
    await enforceRetention(entry.id);
    return toView(row);
  } catch (err) {
    await rm(abs, { force: true }).catch(() => undefined);
    logError("file-version:create-failed", err);
    return null;
  }
}

/**
 * Snapshot for known buffer (e.g. when caller already has previous content).
 * Prefer snapshotFileVersionBeforeOverwrite when reading from storage is fine.
 */
export async function createFileVersionFromBuffer(input: {
  fileEntryId: string;
  buffer: Buffer;
  userId?: string | null;
  reason: FileVersionReason;
  note?: string | null;
  name?: string;
  relativePath?: string;
  mimeType?: string | null;
  storageNodeId?: string;
  maxBytes?: number;
}): Promise<FileVersionView | null> {
  const maxBytes = input.maxBytes ?? DEFAULT_FILE_VERSION_MAX_BYTES;
  if (input.buffer.byteLength > maxBytes) return null;

  const entry = await prisma.fileEntry.findUnique({
    where: { id: input.fileEntryId },
    select: {
      id: true,
      name: true,
      relativePath: true,
      mimeType: true,
      storageNodeId: true,
      entryType: true,
      isDeleted: true,
    },
  });
  if (!entry || entry.isDeleted || entry.entryType !== "FILE") return null;

  const checksum = crypto.createHash("sha256").update(input.buffer).digest("hex");
  const versionNumber = await nextVersionNumber(entry.id);
  const blobRelativePath = path.posix.join(
    entry.storageNodeId,
    entry.id,
    `v${versionNumber}-${checksum.slice(0, 12)}.bin`,
  );
  const abs = blobAbsolutePath(blobRelativePath);
  await mkdir(path.dirname(abs), { recursive: true });
  await writeFile(abs, input.buffer);

  try {
    const row = await prisma.fileVersion.create({
      data: {
        fileEntryId: entry.id,
        storageNodeId: input.storageNodeId ?? entry.storageNodeId,
        versionNumber,
        name: input.name ?? entry.name,
        relativePath: input.relativePath ?? entry.relativePath,
        mimeType: input.mimeType ?? entry.mimeType,
        sizeBytes: BigInt(input.buffer.byteLength),
        checksumSha256: checksum,
        blobRelativePath,
        reason: input.reason,
        note: input.note ?? null,
        createdByUserId: input.userId ?? null,
      },
      include: {
        createdBy: { select: { username: true, displayName: true } },
      },
    });
    await enforceRetention(entry.id);
    return toView(row);
  } catch (err) {
    await rm(abs, { force: true }).catch(() => undefined);
    logError("file-version:create-from-buffer-failed", err);
    return null;
  }
}

export async function listFileVersions(input: {
  fileEntryId: string;
  session: SessionPayload;
  limit?: number;
}): Promise<FileVersionView[]> {
  await resolveAccessibleFileEntry({
    fileEntryId: input.fileEntryId,
    session: input.session,
    operation: "read",
  });
  const limit = Math.min(Math.max(input.limit ?? 50, 1), 100);
  const rows = await prisma.fileVersion.findMany({
    where: { fileEntryId: input.fileEntryId },
    orderBy: { versionNumber: "desc" },
    take: limit,
    include: {
      createdBy: { select: { username: true, displayName: true } },
    },
  });
  return rows.map(toView);
}

export async function getFileVersionForDownload(input: {
  fileEntryId: string;
  versionId: string;
  session: SessionPayload;
}) {
  await resolveAccessibleFileEntry({
    fileEntryId: input.fileEntryId,
    session: input.session,
    operation: "read",
  });
  const row = await prisma.fileVersion.findFirst({
    where: { id: input.versionId, fileEntryId: input.fileEntryId },
  });
  if (!row) throw new NotFoundError("Version not found");
  const abs = blobAbsolutePath(row.blobRelativePath);
  await access(abs);
  return {
    version: toView({ ...row, createdBy: null }),
    absolutePath: abs,
    stream: createReadStream(abs),
  };
}

export async function restoreFileVersion(input: {
  fileEntryId: string;
  versionId: string;
  session: SessionPayload;
}): Promise<{ restored: FileVersionView; newRestorePoint: FileVersionView | null }> {
  const entry = await resolveAccessibleFileEntry({
    fileEntryId: input.fileEntryId,
    session: input.session,
    operation: "write",
  });

  const version = await prisma.fileVersion.findFirst({
    where: { id: input.versionId, fileEntryId: input.fileEntryId },
  });
  if (!version) throw new NotFoundError("Version not found");

  const abs = blobAbsolutePath(version.blobRelativePath);
  let buffer: Buffer;
  try {
    buffer = await readFile(abs);
  } catch {
    throw new BusinessError("Version blob is missing on disk");
  }

  // Snapshot current body as RESTORE_POINT before overwriting.
  const restorePoint = await snapshotFileVersionBeforeOverwrite({
    fileEntryId: entry.id,
    userId: input.session.userId,
    reason: "RESTORE_POINT",
    note: `Before restore to v${version.versionNumber}`,
  });

  const node = entry.storageNode as StorageFileNode;
  if (node.driver === "LOCAL") {
    node.basePath = expandStorageBasePath(node.basePath);
  }
  await writeStorageFileBuffer(node, entry.relativePath, buffer);

  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  await prisma.fileEntry.update({
    where: { id: entry.id },
    data: {
      size: BigInt(buffer.byteLength),
      mimeType: version.mimeType ?? entry.mimeType,
      checksumSha256: checksum,
      isDeleted: false,
      updatedAt: new Date(),
    },
  });

  return {
    restored: toView({ ...version, createdBy: null }),
    newRestorePoint: restorePoint,
  };
}

export async function createManualFileVersion(input: {
  fileEntryId: string;
  session: SessionPayload;
  note?: string | null;
}): Promise<FileVersionView> {
  await resolveAccessibleFileEntry({
    fileEntryId: input.fileEntryId,
    session: input.session,
    operation: "write",
  });
  const snap = await snapshotFileVersionBeforeOverwrite({
    fileEntryId: input.fileEntryId,
    userId: input.session.userId,
    reason: "MANUAL",
    note: input.note ?? null,
  });
  if (!snap) {
    throw new BusinessError("Unable to create version snapshot (file missing, oversized, or unreadable)");
  }
  return snap;
}
