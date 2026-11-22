import { createHash, randomUUID } from "node:crypto";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";

import { isUniqueViolation, prisma } from "@/lib/db";
import { assertStorageAccess, releaseStorageQuotaGuard } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import {
  deleteBackingObject,
  isMissingBackingObjectError,
  readBackingObject,
  renameBackingObject,
  statBackingObject,
  writeBackingObject,
} from "@/lib/storage/fs-backend";
import { assertNotRecycled } from "@/lib/storage/archive-access";
import { isWindowsStorageBasePath } from "@/lib/storage/path-utils";
import { statRemoteEntry } from "@/lib/ssh/client";
import { getSftpNodeConnection } from "@/lib/storage/sftp-node";
import { resolveStorageRemotePath } from "@/lib/storage/remote-containment";
import path from "node:path";
import {
  normalizeRemoteTargetPath,
  normalizeRemoteRelativePath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import { outsideDeleteBatchWhere } from "@/lib/files/recycle-bin";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";
import { previousFileIndexFields, writeFileIndex } from "@/lib/storage/file-write-index";
import { createLogger } from "@/lib/logging";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { guessContentType } from "@/lib/http/mime-types";
import { withApiRoute } from "@/lib/http/api-guard";
import { MAX_EDITABLE_FILE_SIZE_BYTES, MAX_INLINE_REMOTE_READ_BYTES } from "@/lib/storage/mime-constants";
import {
  sftpOpsBodySchema,
  validateStorageFileIndex,
  type SftpOpsBody,
} from "@/lib/storage/schema";

import { ConflictError, ForbiddenError, ValidationError, isAppError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { getErrorMessage } from "@/lib/http/error-message";
import { moveSharePaths } from "@/lib/share-link/follow-path";
import { snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
const logger = createLogger("api:storage:sftp-ops");

/** Hard cap for directory-descendant rewrites. Hitting the cap must fail closed. */
const DIRECTORY_CHILD_REWRITE_LIMIT = 10_000;

async function softDeleteSftpIndex(storageNodeId: string, relativePath: string, isDirectory = false) {
  const normalizedPrefix = relativePath.endsWith("/")
    ? relativePath
    : `${relativePath}/`;
  if (isDirectory) {
    // Fail closed for huge trees — same limit as rename rewrites.
    const childCount = await prisma.fileEntry.count({
      where: {
        storageNodeId,
        OR: [
          { relativePath },
          { relativePath: { startsWith: escapeLikeLiteral(normalizedPrefix) } },
        ],
      },
    });
    if (childCount > DIRECTORY_CHILD_REWRITE_LIMIT) {
      throw new ValidationError(
        apiCopy("apiCopy.directory.has.too.many.indexed.children.to.soft.delete.safely.li.22d140d8", { v0: String(DIRECTORY_CHILD_REWRITE_LIMIT) }),
      );
    }
  }
  await prisma.fileEntry.updateMany({
    where: isDirectory
      ? {
          storageNodeId, isDeleted: false,
          OR: [
            { relativePath },
            { relativePath: { startsWith: escapeLikeLiteral(normalizedPrefix) } },
          ],
        }
      : { storageNodeId, relativePath, isDeleted: false },
    data: { isDeleted: true, deleteBatchId: randomUUID() },
  });
}

/**
 * Prefer the indexed entryType over client-supplied isDirectory. Callers
 * must not be able to force recursive soft-delete / child rewrites by
 * lying about a FILE being a DIRECTORY (or vice versa).
 * Unindexed paths fall back to the request flag so first-touch remote ops
 * still work before inventory sync.
 */
async function resolveIndexedIsDirectory(
  storageNodeId: string,
  relativePath: string,
  clientIsDirectory: boolean | undefined,
): Promise<boolean> {
  const indexed = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId,
      relativePath,
      isDeleted: false,
    },
    select: { entryType: true },
  });
  if (indexed) {
    return indexed.entryType === "DIRECTORY";
  }
  return clientIsDirectory ?? false;
}

async function renameSftpIndex(storageNodeId: string, oldRelativePath: string, newRelativePath: string, isDirectory = false) {
  const oldPrefix = oldRelativePath.endsWith("/")
    ? oldRelativePath
    : `${oldRelativePath}/`;
  const newPrefix = newRelativePath.endsWith("/")
    ? newRelativePath
    : `${newRelativePath}/`;
  let children: Array<{ id: string; relativePath: string }> = [];
  if (isDirectory) {
    // Every descendant moves, recycle-bin rows included: the physical rename moves their bytes too. Left at the old
    // prefix they resurrected trashed files under the new name (a sync indexed them again) and "delete permanently"
    // removed nothing (isDeleted stays as it is; only the path changes).
    // Fail closed if the directory has more children than we can rewrite
    // in one pass — silent truncation would leave stale relativePath rows.
    children = await prisma.fileEntry.findMany({
      where: {
        storageNodeId,
        relativePath: { startsWith: escapeLikeLiteral(oldPrefix) },
      },
      select: { id: true, relativePath: true },
      take: DIRECTORY_CHILD_REWRITE_LIMIT + 1,
    });
    if (children.length > DIRECTORY_CHILD_REWRITE_LIMIT) {
      throw new ValidationError(
        apiCopy("apiCopy.directory.has.too.many.indexed.children.to.rename.safely.limit.r.a9701b8f", { v0: String(DIRECTORY_CHILD_REWRITE_LIMIT) }),
      );
    }
  }

  // One transaction: a failure part-way (a duplicate path, a dropped connection) left some children at the new
  // prefix and the rest at the old one, with nothing rolled back.
  await prisma.$transaction(async (tx) => {
    // N+1 acceptable: non-uniform per-item writes (each row gets a computed relativePath)
    for (const child of children) {
      await tx.fileEntry.update({
        where: { id: child.id },
        data: {
          relativePath: newPrefix + child.relativePath.slice(oldPrefix.length),
        },
      });
    }
    await tx.fileEntry.updateMany({
      where: { storageNodeId, relativePath: oldRelativePath },
      data: {
        relativePath: newRelativePath,
        name: path.posix.basename(newRelativePath),
      },
    });
    // Shares follow the renamed entry (and back, when this rolls a rename back).
    await moveSharePaths(tx, { storageNodeId, oldPath: oldRelativePath, newPath: newRelativePath, isDirectory });
  }, { timeout: 60_000 });
}

/** Whether the index holds anything, recycle bin included, at `relativePath` or below it. */
async function sftpIndexHasPath(
  storageNodeId: string,
  relativePath: string,
  caseInsensitive = false,
): Promise<boolean> {
  const mode = caseInsensitive ? { mode: "insensitive" as const } : {};
  const taken = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId,
      OR: [
        { relativePath: caseInsensitive ? { equals: relativePath, ...mode } : relativePath },
        { relativePath: { startsWith: escapeLikeLiteral(`${relativePath}/`), ...mode } },
      ],
    },
    select: { id: true },
  });
  return Boolean(taken);
}

export const dynamic = "force-dynamic";

async function handlePost(body: SftpOpsBody, session: SessionPayload) {
  const { action, nodeId, path: remotePath } = body;

  if (!nodeId) {
    throw new ValidationError(apiCopy("apiCopy.missing.nodeid.parameter.6d98c74c"));
  }

  if (!remotePath) {
    throw new ValidationError(apiCopy("apiCopy.missing.path.parameter.352f3af2"));
  }

  // Resolve storage node (credentials resolved inside fs-backend for SFTP).
  const { node, credentials } = await getSftpNodeConnection(nodeId, session);
  const windowsSftp = Boolean(credentials.windowsOpenSsh) || isWindowsStorageBasePath(node.basePath);

  // Path containment only — physical ops go through fs-backend which
  // re-derives absolute/remote paths from the storage node.
  const normalizedRelativePath = normalizeRemoteRelativePath(remotePath);
  normalizeRemoteTargetPath(node.basePath, normalizedRelativePath);

  const operation =
    action === "read" ? "read" : action === "delete" ? "delete" : "write";
  const requiredPermission =
    operation === "read"
      ? "storage:read"
      : operation === "delete"
        ? "storage:delete"
        : "storage:write";
  if (!sessionHasPermission(session, requiredPermission)) {
    throw new ForbiddenError(apiCopy("apiCopy.missing.permission.8af29748"));
  }
  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: node.id,
    relativePath: normalizedRelativePath,
    operation,
    writeBytes:
      action === "write" && typeof body.content === "string"
        ? Buffer.byteLength(body.content)
        : null,
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: storageAccessDeniedCopy(accessDecision.reason) },
      { status: 403 },
    );
  }
  let renameAdmission: Awaited<ReturnType<typeof assertStorageAccess>> | undefined;
  let releaseDeleteTreeLock: (() => Promise<void>) | undefined;
  let releasePathLock: (() => Promise<void>) | undefined;
  // Everything after the access check runs inside the try that releases the
  // grant's quota lock: a containment failure returned (or threw) here and
  // kept that lock — and its pooled connection — until the process restarted.
  try {
  // Physical containment before anything changes (delete soft-deletes the
  // index first). fs-backend checks again right before each remote call.
  try {
    await resolveStorageRemotePath(node, normalizedRelativePath, { credentials });
  } catch (error) {
    if (error instanceof ValidationError) {
      return NextResponse.json(toClientStorageError(error.message), { status: 400 });
    }
    throw error;
  }

  try {
    switch (action) {
      case "delete": {
        releaseDeleteTreeLock = await acquireAdvisoryLock("storage-file-operation", node.id);
        releasePathLock = await lockStorageFileOverwrite(node.id, normalizedRelativePath);
        // Trust the live file index for directory vs file when present; never
        // let the client force recursive soft-delete by lying about entryType.
        const isDirectory = await resolveIndexedIsDirectory(
          node.id,
          normalizedRelativePath,
          body.isDirectory,
        );
        await assertNotRecycled(node.id, normalizedRelativePath, "write", node.driver, windowsSftp);
        if (isDirectory) {
          const recycled = await prisma.fileEntry.findFirst({
            where: outsideDeleteBatchWhere(node.id, normalizedRelativePath),
            select: { relativePath: true },
          });
          if (recycled) {
            throw new ConflictError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${recycled.relativePath}` }));
          }
        }
        // Index-first: mark DB entries as deleted before removing the physical
        // backing object. If the physical delete fails, the index is already
        // soft-deleted so the UI no longer shows the entry — but the file
        // remains on disk and can be cleaned up manually or by a future
        // reconciliation pass. This avoids the previous "file gone but index
        // still shows" inconsistency.
        await softDeleteSftpIndex(node.id, normalizedRelativePath, isDirectory);
        let physicalDeleted = true;
        let physicalErrorMessage: string | null = null;
        try {
          await deleteBackingObject({
            storageNode: node,
            relativePath: normalizedRelativePath,
            isDirectory,
            tolerateMissing: true,
          });
        } catch (physicalError) {
          physicalDeleted = false;
          physicalErrorMessage =
            getErrorMessage(physicalError, String(physicalError));
          logger.warn("physical delete failed after index soft-delete; file may remain on disk", physicalError, { nodeId, relativePath: normalizedRelativePath });
        }
        // Index is soft-deleted either way; surface partial success so clients/ops don't assume disk is clean.
        if (!physicalDeleted) {
          return NextResponse.json(
            {
              success: false,
              partial: true,
              indexDeleted: true,
              physicalDeleted: false,
              warning: physicalErrorMessage?.slice(0, 300) || "Physical delete failed; index entry was soft-deleted",
            },
            { status: 207 },
          );
        }
        return NextResponse.json({ success: true, indexDeleted: true, physicalDeleted: true });
      }

      case "rename": {
        if (!body.newPath) {
          return NextResponse.json(
            { error: apiCopy("apiCopy.missing.newpath.parameter.9ea59987") },
            { status: 400 },
          );
        }
        const normalizedNewRelativePath = normalizeRemoteRelativePath(body.newPath);
        normalizeRemoteTargetPath(node.basePath, normalizedNewRelativePath);
        const indexed = await prisma.fileEntry.findFirst({
          where: { storageNodeId: node.id, relativePath: normalizedRelativePath, isDeleted: false },
          select: { entryType: true, size: true },
        });
        const size = indexed?.entryType === "FILE" ? indexed.size : null;
        renameAdmission = await assertStorageAccess({
          session, storageNodeId: node.id, relativePath: normalizedNewRelativePath, operation: "write",
          writeBytes: size, movedFrom: normalizedRelativePath,
          // The SFTP index may omit physical descendants. An unmeasured tree or
          // file can only be moved where no byte-limited grant needs accounting.
          unmeteredTreeWrite: size == null,
        });
        if (!renameAdmission.allowed) {
          return NextResponse.json({ error: storageAccessDeniedCopy(renameAdmission.reason) }, { status: 403 });
        }
        releasePathLock = await lockStorageFileOverwrite(node.id, normalizedNewRelativePath, normalizedRelativePath);
        await assertNotRecycled(node.id, normalizedRelativePath, "write", node.driver, windowsSftp);
        await assertNotRecycled(node.id, normalizedNewRelativePath, "write", node.driver, windowsSftp);
        const { remotePath: source } = await resolveStorageRemotePath(node, normalizedRelativePath, { credentials });
        const stat = await statRemoteEntry({ ...credentials, remotePath: source });
        const isDirectory = stat.type === "directory";
        if ((!isDirectory && stat.type !== "file") || (indexed && (indexed.entryType === "DIRECTORY") !== isDirectory)) {
          throw new ConflictError(apiCopy("apiCopy.files.op.changed"));
        }
        if (renameAdmission.matchedGrantId && size != null) {
          const live = await prisma.fileEntry.findFirst({
            where: { storageNodeId: node.id, relativePath: normalizedRelativePath, isDeleted: false, entryType: "FILE", size },
            select: { id: true },
          });
          if (!live || stat.type !== "file" || !Number.isSafeInteger(stat.size) || BigInt(stat.size) !== size) {
            throw new ConflictError(t("backend.downloads.storageLimitExceeded"));
          }
        }

        // The destination must be free in the index, recycle bin included. Otherwise the rewrite below put this
        // entry's rows among the destination's, the physical rename then failed (the target exists), and the
        // rollback moved the destination's own rows back here as well.
        if (await sftpIndexHasPath(node.id, normalizedNewRelativePath, windowsSftp) ||
            await statBackingObject({ storageNode: node, relativePath: normalizedNewRelativePath })) {
          throw new ConflictError(apiCopy("apiCopy.target.file.already.exists.0c91e640", { v0: normalizedNewRelativePath }));
        }

        // Index-first: update DB entries before renaming the physical file.
        // If the physical rename fails, the index can be rolled back by the
        // caller; if it succeeds but a later error occurs, the index already
        // reflects the correct state.
        try {
          await renameSftpIndex(node.id, normalizedRelativePath, normalizedNewRelativePath, isDirectory);
        } catch (indexError) {
          if (indexError instanceof ValidationError) {
            return NextResponse.json({ error: indexError.message }, { status: 400 });
          }
          throw indexError;
        }
        try {
          await renameBackingObject({
            storageNode: node,
            oldRelativePath: normalizedRelativePath,
            newRelativePath: normalizedNewRelativePath,
            noReplace: true,
          });
        } catch (physicalError) {
          // Physical rename failed — roll back the index to the old path.
          logger.warn("physical rename failed after index update; rolling back index", physicalError, { nodeId, oldPath: normalizedRelativePath, newPath: normalizedNewRelativePath });
          try {
            await renameSftpIndex(node.id, normalizedNewRelativePath, normalizedRelativePath, isDirectory);
          } catch (rollbackError) {
            logger.error("index rollback failed after physical rename error; index may be inconsistent", rollbackError, { nodeId, oldPath: normalizedRelativePath, newPath: normalizedNewRelativePath });
          }
          if (await statBackingObject({ storageNode: node, relativePath: normalizedNewRelativePath })) {
            throw new ConflictError(apiCopy("apiCopy.target.file.already.exists.0c91e640", { v0: normalizedNewRelativePath }));
          }
          throw physicalError;
        }
        return NextResponse.json({ success: true });
      }

      case "read": {
        await assertNotRecycled(node.id, normalizedRelativePath, "read", node.driver, windowsSftp);
        const indexedEntry = await prisma.fileEntry.findFirst({
          where: {
            storageNodeId: node.id,
            relativePath: normalizedRelativePath,
            isDeleted: false,
          },
          select: { size: true },
        });
        const indexedSize = indexedEntry?.size ?? null;
        if (indexedSize !== null && indexedSize > BigInt(MAX_INLINE_REMOTE_READ_BYTES)) {
          return NextResponse.json(
            {
              error: apiCopy("apiCopy.file.exceeds.1.mb.online.reading.is.temporarily.unsupported.plea.01cb31d7"),
              maxInlineBytes: MAX_INLINE_REMOTE_READ_BYTES,
              size: Number(indexedSize),
            },
            { status: 413 },
          );
        }

        // Pass the cap into the backend so an UNINDEXED remote file (indexedSize
        // null → the pre-check above is skipped) can never be buffered whole
        // into memory. The stream aborts once it crosses the limit.
        const probe = () => statBackingObject({ storageNode: node, relativePath: normalizedRelativePath });
        const beforeRead = await probe();
        let buffer: Buffer;
        try {
          buffer = await readBackingObject({
            storageNode: node,
            relativePath: normalizedRelativePath,
            maxBytes: MAX_INLINE_REMOTE_READ_BYTES,
          });
        } catch (readError) {
          // The backend aborts oversized reads with a typed error; surface it as
          // a 413 (not the generic 502 from the outer catch) so the client shows
          // the correct "too large, use download" hint.
          if (isAppError(readError) && readError.status === 422) {
            return NextResponse.json(
              {
                error: apiCopy("apiCopy.file.exceeds.1.mb.online.reading.is.temporarily.unsupported.plea.01cb31d7"),
                maxInlineBytes: MAX_INLINE_REMOTE_READ_BYTES,
              },
              { status: 413 },
            );
          }
          throw readError;
        }

        if (buffer.byteLength > MAX_INLINE_REMOTE_READ_BYTES) {
          return NextResponse.json(
            {
              error: apiCopy("apiCopy.file.exceeds.1.mb.online.reading.is.temporarily.unsupported.plea.01cb31d7"),
              maxInlineBytes: MAX_INLINE_REMOTE_READ_BYTES,
              size: buffer.byteLength,
            },
            { status: 413 },
          );
        }

        // Try to decode as UTF-8 text; if it fails, fall back to base64
        let content: string;
        let encoding: "text" | "base64";
        try {
          content = buffer.toString("utf-8");
          // Validate that it's actually valid UTF-8 by re-encoding and comparing
          // This catches cases where binary data was decoded with replacement chars
          const reEncoded = Buffer.from(content, "utf-8");
          if (reEncoded.equals(buffer)) {
            encoding = "text";
          } else {
            content = buffer.toString("base64");
            encoding = "base64";
          }
        } catch {
          // UTF-8 decode/validation failed (binary content) — fall back to base64.
          content = buffer.toString("base64");
          encoding = "base64";
        }

        // Older clients use the SFTP modification time. The editor uses the digest of these exact bytes.
        const readStat = await probe();
        if (beforeRead?.lastModifiedMs !== readStat?.lastModifiedMs || beforeRead?.size !== readStat?.size) {
          throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
        }
        return NextResponse.json({
          content,
          encoding,
          size: buffer.length,
          contentVersion: createHash("sha256").update(buffer).digest("hex"),
          lastModifiedMs: readStat?.lastModifiedMs ?? null,
        });
      }

      case "write": {
        if (body.content === undefined || body.content === null) {
          return NextResponse.json(
            { error: apiCopy("apiCopy.missing.content.parameter.23941f39") },
            { status: 400 },
          );
        }
        const writeBytes = Buffer.byteLength(body.content);
        if (writeBytes > MAX_EDITABLE_FILE_SIZE_BYTES) {
          return NextResponse.json(
            {
              error: apiCopy("apiCopy.file.exceeds.bytes.online.editing.is.temporarily.unsupported.4686f955", { v0: String(MAX_EDITABLE_FILE_SIZE_BYTES) }),
              maxInlineBytes: MAX_EDITABLE_FILE_SIZE_BYTES,
              size: writeBytes,
            },
            { status: 413 },
          );
        }
        const index = validateStorageFileIndex({
          storageNodeId: node.id, relativePath: normalizedRelativePath,
          size: writeBytes, mimeType: guessContentType(normalizedRelativePath),
        });
        // The editor returns the digest of the bytes it loaded. Keep strict mtime checks for older clients.
        const releaseFileLock = await lockStorageFileOverwrite(node.id, normalizedRelativePath);
        try {
        await assertNotRecycled(node.id, normalizedRelativePath, "write", node.driver, windowsSftp);
        const previousStat = await statBackingObject({
          storageNode: node,
          relativePath: normalizedRelativePath,
        });
        if (body.expectedContentVersion) {
          if (!previousStat || previousStat.isDirectory || previousStat.size > MAX_INLINE_REMOTE_READ_BYTES) {
            throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
          }
          const current = await readBackingObject({
            storageNode: node, relativePath: normalizedRelativePath, maxBytes: MAX_INLINE_REMOTE_READ_BYTES,
          }).catch(error => {
            if (isMissingBackingObjectError(error)) throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
            throw error;
          });
          if (createHash("sha256").update(current).digest("hex") !== body.expectedContentVersion) {
            throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
          }
        } else if (typeof body.expectedLastModifiedMs === "number" && previousStat?.lastModifiedMs !== body.expectedLastModifiedMs) {
          throw new ConflictError(t("backend.storage.editableFileChangedOnDisk"));
        }
        const indexed = await prisma.fileEntry.findFirst({
          where: {
            storageNodeId: node.id,
            relativePath: windowsSftp
              ? { equals: normalizedRelativePath, mode: "insensitive" }
              : normalizedRelativePath,
          },
          select: previousFileIndexFields,
        });
        if (previousStat?.isDirectory || indexed?.entryType === "DIRECTORY") {
          throw new ConflictError(t("backend.webdav.cannotOverwriteACollectionWithAFile"));
        }
        // A recycle-bin file keeps its bytes at its path. Writing over it destroyed what a restore would bring back,
        // and the upsert revived the row half-way; every other upload path refuses this.
        if (indexed?.isDeleted) {
          throw new ConflictError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${normalizedRelativePath}` }));
        }
        // The editor saves SFTP files here: like the LOCAL editor (and the
        // version panel's promise), keep the previous body as a version first.
        // Without it an online edit of an SFTP file left no history.
        if (indexed && !indexed.isDeleted) {
          await snapshotFileVersionBeforeOverwrite({
            fileEntryId: indexed.id,
            userId: session.userId,
            reason: "EDIT",
            note: "Before text editor save",
          }).catch(() => undefined);
        }
        let rollback: Awaited<ReturnType<typeof writeFileIndex>>;
        try {
          rollback = await writeFileIndex(index, indexed);
        } catch (error) {
          if (isUniqueViolation(error) || (error as NodeJS.ErrnoException)?.code === "P2025") {
            throw new ConflictError(t("backend.storage.editableFileUpdatedByOther"));
          }
          throw error;
        }
        try {
          await writeBackingObject({ storageNode: node, relativePath: normalizedRelativePath, content: body.content });
        } catch (error) {
          await rollback();
          throw error;
        }
        // Hand back the post-write mtime so the editor's *next* save carries a
        // token matching what is now on the remote. Reusing the local clock here
        // would make the following save 409 against the user's own write.
        const afterWriteStat = await statBackingObject({
          storageNode: node,
          relativePath: normalizedRelativePath,
        });
        return NextResponse.json({
          success: true,
          byteSize: writeBytes,
          contentVersion: createHash("sha256").update(body.content).digest("hex"),
          lastModifiedMs: afterWriteStat?.lastModifiedMs ?? null,
        });
        } finally {
          await releaseFileLock();
        }
      }

      default:
        return NextResponse.json(
          { error: apiCopy("apiCopy.unsupported.soperation.e8006bb1", { v0: String(action) }) },
          { status: 400 },
        );
    }
  } catch (error) {
    // An AppError carries its own status and product copy — rethrow so
    // `withApiRoute`/`apiCatch` map it. Collapsing everything into 502 turned the
    // write path's 409 (remote file changed since load) into "node unreachable",
    // which tells the user to check their SSH config instead of reloading.
    if (isAppError(error)) throw error;
    logger.error("remote file operation failed", error, { action, nodeId });
    return NextResponse.json(
      toClientStorageError("Remote file operation failed, please check node configuration, path or permissions"),
      { status: 502 },
    );
  }
  } finally {
    try { await releasePathLock?.(); } finally {
      await releaseDeleteTreeLock?.();
      if (renameAdmission) await releaseStorageQuotaGuard(renameAdmission);
      await releaseStorageQuotaGuard(accessDecision);
    }
  }
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permissions: ["storage:read", "storage:write", "storage:delete"],
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: apiCopy("apiCopy.remote.file.operation.failed.711098ba"),
      bodySchema: sftpOpsBodySchema,
    },
    async ({ session, body }) => {
      return handlePost(body, session);
    },
  );
}
