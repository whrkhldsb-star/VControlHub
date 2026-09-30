import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Storage-file resumable upload finalize.
 *
 * Reuses MediaUploadSession + chunk pipeline, then writes the assembled
 * file to LOCAL/SFTP/WebDAV storage and upserts the FileEntry index.
 */
import path from "node:path";

import { prisma } from "@/lib/db";
import { ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import {
  getStorageFileNode,
  writeStorageFileFromLocalPath,
} from "@/lib/storage/file-content";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import {
  assembleMediaUploadToFile,
  completeMediaUploadSession,
  cleanupMediaUploadTempDir,
} from "@/lib/upload/service";
import { snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import type { MediaUploadSessionView } from "@/lib/upload/types";
import type { SessionPayload } from "@/lib/auth/session";
import { t } from "@/lib/i18n/service-translations";
import { logError } from "@/lib/logging";

export type CompleteStorageUploadResult = {
  session: MediaUploadSessionView;
  relativePath: string;
  size: number;
  storageNodeId: string;
};


// Bound disk and transport work per process; each stream uses a 64 KiB window.
let activeFinalizations = 0;
const finalizationsByUser = new Set<string>();
const finalizationsByNode = new Map<string, number>();
function acquireFinalizationSlot(userId: string, nodeId: string): () => void {
  const nodeCount = finalizationsByNode.get(nodeId) ?? 0;
  if (activeFinalizations >= 4 || finalizationsByUser.has(userId) || nodeCount >= 2) {
    throw new ConflictError(t("backend.storage.finalizationBusy"));
  }
  activeFinalizations += 1;
  finalizationsByUser.add(userId);
  finalizationsByNode.set(nodeId, nodeCount + 1);
  return () => {
    activeFinalizations -= 1;
    finalizationsByUser.delete(userId);
    const count = (finalizationsByNode.get(nodeId) ?? 1) - 1;
    if (count === 0) finalizationsByNode.delete(nodeId); else finalizationsByNode.set(nodeId, count);
  };
}

export async function completeStorageFileUpload(params: {
  sessionId: string;
  session: SessionPayload;
}): Promise<CompleteStorageUploadResult> {
  const { sessionId, session } = params;

  let ownsFinalization = false;
  const existing = await prisma.mediaUploadSession.findFirst({
    where: { id: sessionId, userId: session.userId },
    select: {
      filename: true,
      mimeType: true,
      storageNodeId: true,
      relativePath: true,
      status: true,
      totalSize: true,
      totalChunks: true,
      receivedChunks: true,
      expiresAt: true,
    },
  });
  if (!existing) {
    throw new ValidationError(apiCopy("apiCopy.upload.session.not.found.or.does.not.belong.to.the.current.user.134b524c"), {
      code: "session_not_found",
    });
  }
  if (!existing.storageNodeId || !existing.relativePath) {
    throw new ValidationError(apiCopy("apiCopy.storage.upload.session.is.missing.storagenodeid.relativepath.352d0848"), {
      code: "storage_target_missing",
    });
  }

  if (!["PENDING", "UPLOADING"].includes(existing.status) || existing.expiresAt.getTime() <= Date.now()) {
    throw new ValidationError(t("backend.storage.uploadSessionNotActive"), { code: "session_not_active" });
  }
  const byteSize = Number(existing.totalSize);
  const received = new Set(existing.receivedChunks);
  if (received.size !== existing.totalChunks || Array.from({ length: existing.totalChunks }, (_, i) => i).some((i) => !received.has(i))) {
    throw new ValidationError(t("backend.storage.chunksMissing"), { code: "chunks_incomplete" });
  }
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > 200 * 1024 * 1024) throw new ValidationError(t("backend.storage.invalidUploadSize"));

  const normalized = normalizeStorageRelativePath(existing.relativePath);
  if (normalized.ok !== true) {
    throw new ValidationError(normalized.reason);
  }
  const normalizedRelativePath = normalized.path;

  const access = await assertStorageAccess({
    session,
    storageNodeId: existing.storageNodeId,
    relativePath: normalizedRelativePath,
    operation: "write",
    writeBytes: byteSize,
  });
  if (!access.allowed) {
    throw new ForbiddenError(storageAccessDeniedCopy(access.reason));
  }

  let releaseFinalization: (() => void) | undefined;
  try {
  const storageNode = await getStorageFileNode(existing.storageNodeId, session);
  if (!storageNode || !["LOCAL", "SFTP", "WEBDAV"].includes(storageNode.driver)) {
    throw new ValidationError(t("backend.storage.uploadNotSupported"));
  }

  releaseFinalization = acquireFinalizationSlot(session.userId, existing.storageNodeId);
  const claimed = await prisma.mediaUploadSession.updateMany({
    where: { id: sessionId, userId: session.userId, status: { in: ["PENDING", "UPLOADING"] }, expiresAt: { gt: new Date() } },
    data: { status: "FINALIZING" },
  });
  if (claimed.count === 0) {
    throw new ValidationError(t("backend.storage.uploadSessionNotActive"), {
      code: "session_not_active",
    });
  }
  ownsFinalization = true;
  const assembled = await assembleMediaUploadToFile(sessionId, session.userId);

  // Snapshot existing body before overwrite when index already exists.
  const existingEntry = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId: existing.storageNodeId,
      relativePath: normalizedRelativePath,
    },
    select: { id: true },
  });
  if (existingEntry) {
    await snapshotFileVersionBeforeOverwrite({
      fileEntryId: existingEntry.id,
      userId: session.userId,
      reason: "UPLOAD",
      note: "Before resumable upload overwrite",
    });
  }

  await writeStorageFileFromLocalPath(storageNode, normalizedRelativePath, assembled.path);

  const fileName = path.posix.basename(normalizedRelativePath);
  const mimeType = existing.mimeType || null;
  if (assembled.size !== byteSize) throw new ValidationError(t("backend.storage.assembledSizeChanged"));

  const indexData = {
    name: fileName,
    entryType: "FILE" as const,
    mimeType,
    size: BigInt(byteSize),
    isDeleted: false as const,
    // The row leaves the recycle bin on this overwrite — clear the batch
    // marker so a later directory restore cannot revive a stale copy of it.
    deleteBatchId: null,
    checksumSha256: assembled.checksum,
  };

  const view = await prisma.$transaction(async (tx) => {
    await tx.fileEntry.upsert({
      where: { storageNodeId_relativePath: { storageNodeId: existing.storageNodeId!, relativePath: normalizedRelativePath } },
      create: { storageNodeId: existing.storageNodeId!, relativePath: normalizedRelativePath, ...indexData },
      update: indexData,
    });
    return completeMediaUploadSession({ sessionId, userId: session.userId, checksum: assembled.checksum, allowedStatuses: ["FINALIZING"], transaction: tx });
  });
  await cleanupMediaUploadTempDir(sessionId).catch((error) => logError("storage-upload:cleanup-failed", error));

  return {
    session: view,
    relativePath: normalizedRelativePath,
    size: byteSize,
    storageNodeId: existing.storageNodeId,
  };
  } catch (error) {
    if (ownsFinalization) {
    await prisma.mediaUploadSession.updateMany({
      where: { id: sessionId, userId: session.userId, status: "FINALIZING" },
      data: {
        status: "FAILED",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Storage upload finalization failed",
      },
    }).catch((failure) => logError("storage-upload:failure-status-update-failed", failure));
    await cleanupMediaUploadTempDir(sessionId).catch((failure) => logError("storage-upload:cleanup-failed", failure));
    }
    throw error;
  } finally {
    releaseFinalization?.();
    await releaseStorageQuotaGuard(access);
  }
}
