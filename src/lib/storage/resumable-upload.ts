import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Storage-file resumable upload finalize.
 *
 * Reuses MediaUploadSession + chunk pipeline, then writes the assembled
 * file to LOCAL/SFTP/WebDAV storage and upserts the FileEntry index.
 */
import path from "node:path";

import { prisma } from "@/lib/db";
import { UploadOutcomeUnknownError, ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
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
import { beginUploadFinalization, recordFinalizationFailure, type FinalizationLease } from "@/lib/upload/finalization-lease";
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

  let lease: FinalizationLease | undefined;
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
  lease = await beginUploadFinalization(sessionId, session.userId);
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

  await lease.beforeWrite({ kind: "storage", storageNodeId: existing.storageNodeId, relativePath: normalizedRelativePath, checksum: assembled.checksum, size: assembled.size });
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

  await lease.assertActive();
  const finalizationToken = lease.token;
  const view = await prisma.$transaction(async (tx) => {
    await tx.fileEntry.upsert({
      where: { storageNodeId_relativePath: { storageNodeId: existing.storageNodeId!, relativePath: normalizedRelativePath } },
      create: { storageNodeId: existing.storageNodeId!, relativePath: normalizedRelativePath, ...indexData },
      update: indexData,
    });
    return completeMediaUploadSession({ sessionId, userId: session.userId, checksum: assembled.checksum, allowedStatuses: ["FINALIZING"], finalizationToken, transaction: tx });
  });
  await cleanupMediaUploadTempDir(sessionId).catch((error) => logError("storage-upload:cleanup-failed", error));

  return {
    session: view,
    relativePath: normalizedRelativePath,
    size: byteSize,
    storageNodeId: existing.storageNodeId,
  };
  } catch (error) {
    if (lease) {
      const failure = await recordFinalizationFailure(lease);
      if (failure.changed && !failure.review) await cleanupMediaUploadTempDir(sessionId).catch((err) => logError("storage-upload:cleanup-failed", err));
      if (failure.review) throw new UploadOutcomeUnknownError(t("backend.storage.uploadOutcomeUnknown"));
    }
    throw error;
  } finally {
    lease?.stop();
    releaseFinalization?.();
    await releaseStorageQuotaGuard(access);
  }
}
