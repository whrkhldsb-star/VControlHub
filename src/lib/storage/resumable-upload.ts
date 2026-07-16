/**
 * Storage-file resumable upload finalize.
 *
 * Reuses MediaUploadSession + chunk pipeline, then writes the assembled
 * buffer to LOCAL/SFTP storage and upserts the FileEntry index.
 */
import path from "node:path";

import { prisma } from "@/lib/db";
import { ForbiddenError, ValidationError } from "@/lib/errors";
import { assertStorageAccess } from "@/lib/storage/access-control";
import {
  getStorageFileNode,
  writeStorageFileBuffer,
} from "@/lib/storage/file-content";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import {
  assembleMediaUploadChunks,
  completeMediaUploadSession,
  MediaUploadError,
} from "@/lib/upload/service";
import type { MediaUploadSessionView } from "@/lib/upload/types";
import type { SessionPayload } from "@/lib/auth/session";

export type CompleteStorageUploadResult = {
  session: MediaUploadSessionView;
  relativePath: string;
  size: number;
  storageNodeId: string;
};

export async function completeStorageFileUpload(params: {
  sessionId: string;
  session: SessionPayload;
}): Promise<CompleteStorageUploadResult> {
  const { sessionId, session } = params;

  let assembled: Buffer;
  try {
    assembled = await assembleMediaUploadChunks(sessionId, session.userId);
  } catch (err) {
    if (err instanceof MediaUploadError) {
      throw new ValidationError(err.message, { code: err.code });
    }
    throw err;
  }

  const existing = await prisma.mediaUploadSession.findFirst({
    where: { id: sessionId, userId: session.userId },
    select: {
      filename: true,
      mimeType: true,
      storageNodeId: true,
      relativePath: true,
      status: true,
    },
  });
  if (!existing) {
    throw new ValidationError("Upload session not found or does not belong to the current user", {
      code: "session_not_found",
    });
  }
  if (!existing.storageNodeId || !existing.relativePath) {
    throw new ValidationError("Storage upload session is missing storageNodeId/relativePath", {
      code: "storage_target_missing",
    });
  }

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
    writeBytes: assembled.byteLength,
  });
  if (!access.allowed) {
    throw new ForbiddenError(access.reason ?? "No permission to write to the storage path");
  }

  const storageNode = await getStorageFileNode(existing.storageNodeId);
  if (!storageNode || (storageNode.driver !== "LOCAL" && storageNode.driver !== "SFTP")) {
    throw new ValidationError("Storage node does not support file uploads");
  }

  await writeStorageFileBuffer(storageNode, normalizedRelativePath, assembled);

  const fileName = path.posix.basename(normalizedRelativePath);
  const mimeType = existing.mimeType || null;
  const byteSize = assembled.byteLength;

  const existingEntry = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId: existing.storageNodeId,
      relativePath: normalizedRelativePath,
    },
    select: { id: true },
  });

  if (existingEntry) {
    await prisma.fileEntry.update({
      where: { id: existingEntry.id },
      data: {
        name: fileName,
        entryType: "FILE",
        mimeType,
        size: BigInt(byteSize),
        isDeleted: false,
      },
    });
  } else {
    await prisma.fileEntry.create({
      data: {
        storageNodeId: existing.storageNodeId,
        name: fileName,
        entryType: "FILE",
        mimeType,
        size: BigInt(byteSize),
        relativePath: normalizedRelativePath,
      },
    });
  }

  const view = await completeMediaUploadSession({
    sessionId,
    userId: session.userId,
    buffer: assembled,
  });

  return {
    session: view,
    relativePath: normalizedRelativePath,
    size: byteSize,
    storageNodeId: existing.storageNodeId,
  };
}
