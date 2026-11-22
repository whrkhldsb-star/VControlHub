import { captureUploadTarget } from "./upload-target";
import { assertCanonicalWritePath, assertNotRecycled } from "@/lib/storage/archive-access";
import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * Storage-file resumable upload finalize.
 *
 * Reuses MediaUploadSession + chunk pipeline, then writes the assembled
 * file to LOCAL/SFTP/WebDAV storage and upserts the FileEntry index.
 */
import { lstat, rm } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/lib/db";
import { BusinessError, UploadOutcomeUnknownError, ConflictError, ForbiddenError, ValidationError } from "@/lib/errors";
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import {
  getStorageFileNode,
  writeStorageFileFromLocalPath,
} from "@/lib/storage/file-content";
import { normalizeStorageRelativePath, resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { createRemoteStorageClient } from "@/lib/storage/agent-file-client";
import {
  MediaUploadError,
  assembleMediaUploadToFile,
  assertUploadDiskReserve,
  completeMediaUploadSession,
  cleanupMediaUploadTempDir,
} from "@/lib/upload/service";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import type { MediaUploadSessionView } from "@/lib/upload/types";
import type { SessionPayload } from "@/lib/auth/session";
import { t } from "@/lib/i18n/service-translations";
import { beginUploadFinalization, recordFinalizationFailure, type FinalizationLease } from "@/lib/upload/finalization-lease";
import { logError } from "@/lib/logging";
import { readStorageUploadMaxBytes } from "@/lib/upload/limits";

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

const REFUSED_LOCAL_WRITE_CODES = new Set(["ENAMETOOLONG", "ENOSPC", "EDQUOT", "EACCES", "EPERM", "EISDIR", "ENOTDIR", "EROFS", "ENOENT", "EMFILE"]);

/** An errno from the local copy/rename: the target is as it was. */
function isRefusedLocalWrite(error: unknown): boolean {
  const code = error && typeof error === "object" && "code" in error ? (error as NodeJS.ErrnoException).code : undefined;
  return typeof code === "string" && REFUSED_LOCAL_WRITE_CODES.has(code);
}

async function assertUploadTargetIsNotFolder(
  node: { driver: string; basePath?: string | null } & Parameters<typeof createRemoteStorageClient>[0],
  relativePath: string,
  indexedAsFolder: boolean,
): Promise<void> {
  const conflict = () => new ConflictError(t("backend.storage.targetIsDirectory"));
  if (indexedAsFolder) throw conflict();
  if (node.driver === "LOCAL" && node.basePath) {
    const resolved = resolveStoragePathWithinBase(node.basePath, relativePath);
    if (resolved.ok && (await lstat(resolved.path).catch(() => null))?.isDirectory()) throw conflict();
  } else if (node.driver === "WEBDAV" || node.driver === "AGENT") {
    if ((await createRemoteStorageClient(node).stat(relativePath, true))?.isDirectory) throw conflict();
  }
}

export async function completeStorageFileUpload(params: {
  sessionId: string;
  session: SessionPayload;
}): Promise<CompleteStorageUploadResult> {
  const { sessionId, session } = params;

  let lease: FinalizationLease | undefined;
  const existing = await prisma.mediaUploadSession.findFirst({
    where: { id: sessionId, userId: session.userId, teamId: session.currentTeamId ?? null, teamBound: true },
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
      createdAt: true,
      recoveryMetadata: true,
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
  if (!Number.isSafeInteger(byteSize) || byteSize < 0 || byteSize > (await readStorageUploadMaxBytes())) throw new ValidationError(t("backend.storage.invalidUploadSize"));

  const normalized = normalizeStorageRelativePath(existing.relativePath);
  if (normalized.ok !== true) {
    throw new ValidationError(normalized.reason);
  }
  const normalizedRelativePath = normalized.path;

  // Permission first, without the quota guard: the node-wide quota lock must
  // not be held while the chunks are being assembled (R0-01). The quota check
  // itself (which takes the lock) runs once the body is ready to be written.
  const permitted = await assertStorageAccess({
    session,
    storageNodeId: existing.storageNodeId,
    relativePath: normalizedRelativePath,
    operation: "write",
  });
  if (!permitted.allowed) {
    throw new ForbiddenError(storageAccessDeniedCopy(permitted.reason));
  }

  let access: Awaited<ReturnType<typeof assertStorageAccess>> | null = null;
  let releaseFinalization: (() => void) | undefined;
  let releaseOverwrite: (() => Promise<void>) | undefined;
  try {
  let storageNode = await getStorageFileNode(existing.storageNodeId, session);
  if (!storageNode || !["LOCAL", "SFTP", "WEBDAV", "AGENT"].includes(storageNode.driver)) {
    throw new ValidationError(t("backend.storage.uploadNotSupported"));
  }

  // Room for the assembled copy (the upload's size again), looked for while the session can still be resumed.
  // Found out only once the finalization was claimed, the failure removed the uploaded chunks and the whole
  // file had to be sent again.
  await assertUploadDiskReserve(byteSize).catch((error: unknown) => {
    if (error instanceof MediaUploadError && error.code === "insufficient_storage") {
      throw new BusinessError(t("backend.storage.uploadTempSpaceLow"), { code: error.code }, 507);
    }
    throw error;
  });

  releaseFinalization = acquireFinalizationSlot(session.userId, existing.storageNodeId);
  lease = await beginUploadFinalization(sessionId, session.userId, session.currentTeamId ?? null);
  const assembled = await assembleMediaUploadToFile(sessionId, session.userId);

  // Quota admission with the body assembled: the guard is now held only across
  // the write and the index update, not the chunk assembly.
  access = await assertStorageAccess({
    session,
    storageNodeId: existing.storageNodeId,
    relativePath: normalizedRelativePath,
    operation: "write",
    writeBytes: byteSize,
  });
  if (!access.allowed) {
    throw new ForbiddenError(storageAccessDeniedCopy(access.reason));
  }

  // Same ordering as editor/version restore: quota first, content lock second.
  releaseOverwrite = await lockStorageFileOverwrite(existing.storageNodeId, normalizedRelativePath);
  // The root edit holds the exclusive ancestor lock. Re-read the node after acquisition.
  storageNode = await getStorageFileNode(existing.storageNodeId, session);
  if (!storageNode) throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
  const journal = existing.recoveryMetadata;
  const binding = journal && typeof journal === "object" && !Array.isArray(journal) && journal.storageTarget;
  const current = await captureUploadTarget(storageNode, normalizedRelativePath);
  if (!binding || typeof binding !== "object" || Array.isArray(binding) ||
      binding.root !== current.root || binding.version !== current.version) {
    throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
  }
  // Snapshot existing body before overwrite when index already exists.
  const existingEntry = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId: existing.storageNodeId,
      relativePath: normalizedRelativePath,
    },
    select: { id: true, entryType: true, isDeleted: true, updatedAt: true },
  });
  await assertNotRecycled(existing.storageNodeId, normalizedRelativePath, "write", storageNode.driver);
  await assertCanonicalWritePath(existing.storageNodeId, normalizedRelativePath, storageNode.driver);
  // The upload would replace a folder, and for WebDAV (MOVE with Overwrite) that deletes everything in it.
  // Refused before anything is written, so the session stays a plain failure the user can fix and retry.
  await assertUploadTargetIsNotFolder(storageNode, normalizedRelativePath, existingEntry?.entryType === "DIRECTORY");
  if (existingEntry?.isDeleted) throw new ConflictError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${normalizedRelativePath}` }));
  if (existingEntry && existingEntry.updatedAt >= existing.createdAt) {
    throw new ConflictError(t("backend.storage.pathAlreadyExists", { path: normalizedRelativePath }));
  }
  if (existingEntry) {
    await snapshotFileVersionBeforeOverwrite({
      fileEntryId: existingEntry.id,
      userId: session.userId,
      reason: "UPLOAD",
      note: "Before resumable upload overwrite",
    });
  }

  if (assembled.size !== byteSize) throw new ValidationError(t("backend.storage.assembledSizeChanged"));
  let storageVersion: string | null = null;
  const activeLease = lease;
  const beforePublish = () => activeLease.beforeWrite({ kind: "storage", storageNodeId: storageNode.id, relativePath: normalizedRelativePath, checksum: assembled.checksum, size: assembled.size });
  if (storageNode.driver !== "AGENT") await beforePublish();
  try {
    await writeStorageFileFromLocalPath({ ...storageNode, expectedRoot: storageNode.agentFileShare?.rootIdentity ?? undefined }, normalizedRelativePath, assembled.path, {
      expectedVersion: current.version,
      checksum: assembled.checksum, beforePublish, onVersion: version => { storageVersion = version; },
    });
  } catch (error) {
    if (storageNode.driver === "AGENT" && await activeLease.resumeBeforePublication()) {
      lease.stop();
      lease = undefined;
      await rm(assembled.path, { force: true });
    }
    // A local filesystem answers with an errno before it changes anything; only a remote write can succeed unseen.
    if (storageNode.driver === "LOCAL" && (isRefusedLocalWrite(error) || (error instanceof ConflictError && !(error.details && typeof error.details === "object" && "recoveryRequired" in error.details)))) activeLease.writeRefused();
    throw error;
  }

  const indexData = {
    name: path.posix.basename(normalizedRelativePath),
    entryType: "FILE" as const,
    mimeType: existing.mimeType || null,
    size: BigInt(byteSize),
    checksumSha256: assembled.checksum,
    storageVersion,
  };

  await activeLease.assertActive();
  const finalizationToken = activeLease.token;
  const view = await prisma.$transaction(async (tx) => {
    const target = { storageNodeId: existing.storageNodeId!, relativePath: normalizedRelativePath };
    if (existingEntry) {
      await tx.fileEntry.update({
        where: { ...target, id: existingEntry.id, updatedAt: existingEntry.updatedAt, isDeleted: false },
        data: indexData,
      });
    } else {
      await tx.fileEntry.create({ data: { ...target, ...indexData } });
    }
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
    await releaseOverwrite?.();
    if (access) await releaseStorageQuotaGuard(access);
  }
}
