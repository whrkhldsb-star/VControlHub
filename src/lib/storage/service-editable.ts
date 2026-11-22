import { matchTargetMode } from "@/lib/storage/local-permissions";
import { rename, rm, stat, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import {
  BusinessError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import {
  assertStorageAccess,
  releaseStorageQuotaGuard,
} from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import { MAX_EDITABLE_FILE_SIZE_BYTES } from "./mime-constants";
import {
  isEditableTextFile,
  resolveLocalAbsolutePath,
} from "./service-entries";
import { snapshotFileVersionBeforeOverwrite } from "./file-versions";
import { validateStorageFileIndex } from "./schema";
import { lockStorageFileOverwrite } from "./file-overwrite-lock";
import { assertNotRecycled } from "./archive-access";
import { openManagedLocalFile } from "./open-local-file";
import { normalizeStorageRelativePath } from "./path-utils";

async function resolveLocalEditableFileEntry(input: {
  fileEntryId: string;
  session: SessionPayload;
  operation: "read" | "write";
  writeBytes?: number | bigint | null;
}) {
  const t = await serviceT();
  const entry = await prisma.fileEntry.findUnique({
    where: { id: input.fileEntryId },
    include: {
      storageNode: {
        select: {
          id: true,
          name: true,
          driver: true,
          basePath: true,
        },
      },
    },
  });

  if (!entry || entry.isDeleted) {
    throw new NotFoundError(t("backend.storage.editableEntryNotFound"));
  }

  if (entry.storageNode.driver !== "LOCAL") {
    throw new BusinessError(t("backend.storage.editableLocalOnly"));
  }

  const normalized = normalizeStorageRelativePath(entry.relativePath);
  if (!normalized.ok) throw new ValidationError(normalized.reason);
  const relativePath = normalized.path;
  const storageAccess = await assertStorageAccess({
    session: input.session,
    storageNodeId: entry.storageNode.id,
    relativePath,
    operation: input.operation,
    writeBytes: input.writeBytes,
  });
  if (!storageAccess.allowed) {
    throw new ForbiddenError(storageAccessDeniedCopy(storageAccess.reason));
  }

  // A write holds the grant's quota lock from here; the caller releases it,
  // but only once this returns — a check failing below must release it here.
  try {
    await assertNotRecycled(entry.storageNode.id, relativePath, input.operation, entry.storageNode.driver);
    if (
      !isEditableTextFile({
        entryType: entry.entryType,
        name: entry.name,
        mimeType: entry.mimeType,
      })
    ) {
      throw new ValidationError(t("backend.storage.editableTextOnly"));
    }

    const absolutePath = resolveLocalAbsolutePath(
      entry.storageNode.basePath,
      relativePath,
    );
    const handle = await openManagedLocalFile(entry.storageNode.basePath, relativePath);
    let keepOpen = false;
    try {
      const fileStat = await handle.stat();
      if (!fileStat.isFile()) {
        throw new BusinessError(t("backend.storage.editableTargetNotFile"));
      }
      if (fileStat.size > MAX_EDITABLE_FILE_SIZE_BYTES) {
        throw new ValidationError(t("backend.storage.editableFileTooLarge"));
      }
      keepOpen = input.operation === "read";
      return { entry, relativePath, absolutePath, fileStat, handle: keepOpen ? handle : null, storageAccess };
    } finally {
      if (!keepOpen) await handle.close();
    }
  } catch (error) {
    await releaseStorageQuotaGuard(storageAccess);
    throw error;
  }
}

export async function getLocalEditableFileDraft(input: {
  fileEntryId: string;
  session: SessionPayload;
}) {
  const { entry, fileStat, handle } = await resolveLocalEditableFileEntry(
    {
      fileEntryId: input.fileEntryId,
      session: input.session,
      operation: "read",
    },
  );
  try {
    const content = await handle!.readFile({ encoding: "utf8" });

    return {
      fileEntryId: entry.id,
      name: entry.name,
      relativePath: entry.relativePath,
      content,
      byteSize: fileStat.size,
      lastModifiedMs: fileStat.mtimeMs,
      updatedAt: entry.updatedAt?.toISOString?.() ?? entry.updatedAt,
    };
  } finally {
    await handle?.close();
  }
}

export async function saveLocalEditableFileDraft(input: {
  fileEntryId: string;
  content: string;
  session: SessionPayload;
  expectedUpdatedAt?: string | null;
  expectedLastModifiedMs?: number | null;
}) {
  const content = String(input.content ?? "");
  const byteSize = Buffer.byteLength(content, "utf8");

  const t = await serviceT();

  if (byteSize > MAX_EDITABLE_FILE_SIZE_BYTES) {
    throw new ValidationError(t("backend.storage.editableFileTooLarge"));
  }

  const { entry, relativePath, absolutePath, storageAccess } =
    await resolveLocalEditableFileEntry({
      fileEntryId: input.fileEntryId,
      session: input.session,
      operation: "write",
      writeBytes: byteSize,
    });

  try {
    const releaseLock = await lockStorageFileOverwrite(entry.storageNode.id, relativePath);
    try {
      // Compare against what is current now, under the lock: two saves that
      // both read the same version before locking must not both pass.
      const current = await prisma.fileEntry.findUnique({
        where: { id: entry.id, storageNodeId: entry.storageNode.id, relativePath: entry.relativePath },
        select: { updatedAt: true, isDeleted: true, size: true, checksumSha256: true, mimeType: true },
      });
      if (!current || current.isDeleted) {
        throw new NotFoundError(t("backend.storage.editableEntryNotFound"));
      }
      await assertNotRecycled(entry.storageNode.id, relativePath, "write", entry.storageNode.driver);
      const currentHandle = await openManagedLocalFile(entry.storageNode.basePath, relativePath);
      const currentStat = await currentHandle.stat().finally(() => currentHandle.close());
      const currentUpdatedAt = current.updatedAt.toISOString();
      if (
        input.expectedUpdatedAt &&
        currentUpdatedAt &&
        input.expectedUpdatedAt !== currentUpdatedAt
      ) {
        throw new ConflictError(
          t("backend.storage.editableFileUpdatedByOther"),
        );
      }

      if (
        typeof input.expectedLastModifiedMs === "number" &&
        Number.isFinite(input.expectedLastModifiedMs) &&
        Math.abs(currentStat.mtimeMs - input.expectedLastModifiedMs) > 1
      ) {
        throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
      }

      validateStorageFileIndex({ storageNodeId: entry.storageNode.id, relativePath, size: byteSize, mimeType: current.mimeType });
      // Snapshot previous body before overwrite (best-effort).
      await snapshotFileVersionBeforeOverwrite({
        fileEntryId: entry.id,
        userId: input.session.userId,
        reason: "EDIT",
        note: "Before text editor save",
      });

      // Temp file + rename: a crash mid-save must not leave a truncated file (A4-26).
      const temporaryPath = path.join(path.dirname(absolutePath), `.vch-edit-${randomUUID()}.tmp`);
      try {
        await writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
        await matchTargetMode(temporaryPath, absolutePath);
        const identity = { id: entry.id, storageNodeId: entry.storageNode.id, relativePath, isDeleted: false };
        const updated = await prisma.fileEntry.update({
          where: { ...identity, updatedAt: current.updatedAt },
          data: { size: BigInt(byteSize), checksumSha256: null, updatedAt: new Date() },
        });
        try {
          await rename(temporaryPath, absolutePath);
        } catch (error) {
          await prisma.fileEntry.updateMany({
            where: { ...identity, updatedAt: updated.updatedAt },
            data: { size: current.size, checksumSha256: current.checksumSha256, updatedAt: current.updatedAt },
          });
          throw error;
        }
        const nextStat = await stat(absolutePath);
        return {
          fileEntryId: entry.id,
          name: entry.name,
          relativePath: entry.relativePath,
          byteSize: nextStat.size,
          previousByteSize: currentStat.size,
          lastModifiedMs: nextStat.mtimeMs,
          updatedAt: updated.updatedAt?.toISOString?.() ?? updated.updatedAt,
        };
      } finally { await rm(temporaryPath, { force: true }).catch(() => undefined); }
    } finally {
      await releaseLock();
    }
  } finally {
    await releaseStorageQuotaGuard(storageAccess);
  }
}
