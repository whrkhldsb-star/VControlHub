import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import {
  deleteBackingObject,
  renameBackingObject,
  writeBackingObject,
} from "@/lib/storage/fs-backend";
import { readRemoteFile } from "@/lib/ssh/client";
import { getSftpNodeConnection } from "@/lib/storage/sftp-node";
import path from "node:path";
import {
  normalizeRemoteTargetPath,
  normalizeRemoteRelativePath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import { createLogger } from "@/lib/logging";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { withApiRoute } from "@/lib/http/api-guard";
import { MAX_INLINE_REMOTE_READ_BYTES } from "@/lib/storage/mime-constants";
import {
  sftpOpsBodySchema,
  type SftpOpsBody,
} from "@/lib/storage/schema";

import { AuthError, ForbiddenError, ValidationError } from "@/lib/errors";
const logger = createLogger("api:storage:sftp-ops");

function guessMimeType(relativePath: string) {
  const ext = path.posix.extname(relativePath).toLowerCase();
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".md") return "text/markdown; charset=utf-8";
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

async function upsertSftpFileIndex(params: {
  storageNodeId: string;
  relativePath: string;
  content: string | Buffer;
}) {
  const name = path.posix.basename(params.relativePath);
  const size = Buffer.isBuffer(params.content)
    ? params.content.byteLength
    : Buffer.byteLength(params.content);
  await prisma.fileEntry.upsert({
    where: {
      storageNodeId_relativePath: {
        storageNodeId: params.storageNodeId,
        relativePath: params.relativePath,
      },
    },
    update: {
      name,
      entryType: "FILE",
      mimeType: guessMimeType(params.relativePath),
      size: BigInt(size),
      isDeleted: false,
    },
    create: {
      storageNodeId: params.storageNodeId,
      name,
      entryType: "FILE",
      mimeType: guessMimeType(params.relativePath),
      size: BigInt(size),
      relativePath: params.relativePath,
    },
  });
}

async function softDeleteSftpIndex(storageNodeId: string, relativePath: string, isDirectory = false) {
  const normalizedPrefix = relativePath.endsWith("/")
    ? relativePath
    : `${relativePath}/`;
  await prisma.fileEntry.updateMany({
    where: isDirectory
      ? {
          storageNodeId,
          OR: [
            { relativePath },
            { relativePath: { startsWith: normalizedPrefix } },
          ],
        }
      : { storageNodeId, relativePath },
    data: { isDeleted: true },
  });
}

async function renameSftpIndex(storageNodeId: string, oldRelativePath: string, newRelativePath: string, isDirectory = false) {
  if (isDirectory) {
    const oldPrefix = oldRelativePath.endsWith("/")
      ? oldRelativePath
      : `${oldRelativePath}/`;
    const newPrefix = newRelativePath.endsWith("/")
      ? newRelativePath
      : `${newRelativePath}/`;
    const children = await prisma.fileEntry.findMany({
      where: {
        storageNodeId,
        relativePath: { startsWith: oldPrefix },
      },
      select: { id: true, relativePath: true },
      take: 10_000,
    });
    // N+1 acceptable: non-uniform per-item writes (each row gets a computed relativePath)
    for (const child of children) {
      await prisma.fileEntry.update({
        where: { id: child.id },
        data: {
          relativePath: newPrefix + child.relativePath.slice(oldPrefix.length),
          isDeleted: false,
        },
      });
    }
  }

  await prisma.fileEntry.updateMany({
    where: { storageNodeId, relativePath: oldRelativePath },
    data: {
      relativePath: newRelativePath,
      name: path.posix.basename(newRelativePath),
      isDeleted: false,
    },
  });
}

export const dynamic = "force-dynamic";

// `postSchema` is a local alias of the shared boundary schema in
// `src/lib/storage/schema.ts`. Behaviour is identical to the inline version
// (`nodeId` + `action` enum + `path`, with optional `newPath`/`content`/
// `isDirectory`). The exported `SftpOpsBody` type comes from the same module
// and is re-imported above for downstream call-sites.
const postSchema = sftpOpsBodySchema;

async function handlePost(body: SftpOpsBody, session: SessionPayload) {
  const { action, nodeId, path: remotePath } = body;

  if (!nodeId) {
    throw new ValidationError("Missing nodeId parameter");
  }

  if (!remotePath) {
    throw new ValidationError("Missing path parameter");
  }

  // Resolve storage node connection params (same pattern as sftp/route.ts)
  const { node, credentials: connectionCredentials } = await getSftpNodeConnection(nodeId);

  let normalizedRemotePath: string;
  let normalizedRelativePath: string;
  try {
    normalizedRemotePath = normalizeRemoteTargetPath(node.basePath, remotePath);
    normalizedRelativePath = normalizeRemoteRelativePath(remotePath);
  } catch {
    return NextResponse.json(
      toClientStorageError("Requested path exceeds storage node root directory"),
      { status: 400 },
    );
  }

  const operation =
    action === "read" ? "read" : action === "delete" ? "delete" : "write";
  const requiredPermission =
    operation === "read"
      ? "storage:read"
      : operation === "delete"
        ? "storage:delete"
        : "storage:write";
  if (!sessionHasPermission(session, requiredPermission)) {
    throw new ForbiddenError("Missing permission");
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
      { error: accessDecision.reason ?? "Missing storage access authorization" },
      { status: 403 },
    );
  }

  const connParams = {
    host: connectionCredentials.host,
    port: connectionCredentials.port,
    username: connectionCredentials.username,
    privateKey: connectionCredentials.privateKey,
    password: connectionCredentials.password,
  };

  try {
    switch (action) {
      case "delete": {
        // Index-first: mark DB entries as deleted before removing the physical
        // backing object. If the physical delete fails, the index is already
        // soft-deleted so the UI no longer shows the entry — but the file
        // remains on disk and can be cleaned up manually or by a future
        // reconciliation pass. This avoids the previous "file gone but index
        // still shows" inconsistency.
        await softDeleteSftpIndex(node.id, normalizedRelativePath, body.isDirectory ?? false);
        try {
          await deleteBackingObject({
            storageNode: node,
            relativePath: normalizedRelativePath,
            isDirectory: body.isDirectory ?? false,
            tolerateMissing: true,
          });
        } catch (physicalError) {
          logger.warn("physical delete failed after index soft-delete; file may remain on disk", physicalError, { nodeId, relativePath: normalizedRelativePath });
        }
        return NextResponse.json({ success: true });
      }

      case "rename": {
        if (!body.newPath) {
          return NextResponse.json(
            { error: "Missing newPath Parameter" },
            { status: 400 },
          );
        }
        let normalizedNewRelativePath: string;
        try {
          // Validate the new path is within the storage root; the result is
          // used implicitly by fs-backend which re-derives the absolute path.
          normalizeRemoteTargetPath(node.basePath, body.newPath);
          normalizedNewRelativePath = normalizeRemoteRelativePath(body.newPath);
        } catch {
          return NextResponse.json(
            toClientStorageError("New path exceeds storage Node root directory"),
            { status: 400 },
          );
        }
        const destinationAccessDecision = await assertStorageAccess({
          session,
          storageNodeId: node.id,
          relativePath: normalizedNewRelativePath,
          operation: "write",
          writeBytes: null,
        });
        if (!destinationAccessDecision.allowed) {
          return NextResponse.json(
            {
              error:
                destinationAccessDecision.reason ?? "Missing target path storage access authorization",
            },
            { status: 403 },
          );
        }

        // Index-first: update DB entries before renaming the physical file.
        // If the physical rename fails, the index can be rolled back by the
        // caller; if it succeeds but a later error occurs, the index already
        // reflects the correct state.
        await renameSftpIndex(node.id, normalizedRelativePath, normalizedNewRelativePath, body.isDirectory ?? false);
        try {
          await renameBackingObject({
            storageNode: node,
            oldRelativePath: normalizedRelativePath,
            newRelativePath: normalizedNewRelativePath,
          });
        } catch (physicalError) {
          // Physical rename failed — roll back the index to the old path.
          logger.warn("physical rename failed after index update; rolling back index", physicalError, { nodeId, oldPath: normalizedRelativePath, newPath: normalizedNewRelativePath });
          try {
            await renameSftpIndex(node.id, normalizedNewRelativePath, normalizedRelativePath, body.isDirectory ?? false);
          } catch (rollbackError) {
            logger.error("index rollback failed after physical rename error; index may be inconsistent", rollbackError, { nodeId, oldPath: normalizedRelativePath, newPath: normalizedNewRelativePath });
          }
          throw physicalError;
        }
        return NextResponse.json({ success: true });
      }

      case "read": {
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
              error: "File exceeds 1 MB, online reading is temporarily unsupported, please use the download feature",
              maxInlineBytes: MAX_INLINE_REMOTE_READ_BYTES,
              size: Number(indexedSize),
            },
            { status: 413 },
          );
        }

        const buffer = await readRemoteFile({
          ...connParams,
          remotePath: normalizedRemotePath,
        });

        if (buffer.byteLength > MAX_INLINE_REMOTE_READ_BYTES) {
          return NextResponse.json(
            {
              error: "File exceeds 1 MB, online reading is temporarily unsupported, please use the download feature",
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

        return NextResponse.json({ content, encoding, size: buffer.length });
      }

      case "write": {
        if (body.content === undefined || body.content === null) {
          return NextResponse.json(
            { error: "Missing content Parameter" },
            { status: 400 },
          );
        }
        // Physical write first via fs-backend (same adapter as delete/rename),
        // then upsert the file index. If index persistence fails, remove the
        // remote file so we do not leave an unindexed orphan on disk.
        const { byteSize: writtenSize } = await writeBackingObject({
          storageNode: node,
          relativePath: normalizedRelativePath,
          content: body.content,
        });
        try {
          await upsertSftpFileIndex({
            storageNodeId: node.id,
            relativePath: normalizedRelativePath,
            content: body.content,
          });
        } catch (indexError) {
          try {
            await deleteBackingObject({
              storageNode: node,
              relativePath: normalizedRelativePath,
              isDirectory: false,
              tolerateMissing: true,
            });
          } catch (cleanupError) {
            logger.warn("failed to clean up remote file after index persistence failed", cleanupError, {
              nodeId,
              relativePath: normalizedRelativePath,
            });
          }
          throw indexError;
        }
        return NextResponse.json({ success: true, byteSize: writtenSize });
      }

      default:
        return NextResponse.json(
          { error: `Unsupported'sOperation: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    logger.error("remote file operation failed", error, { action, nodeId });
    return NextResponse.json(
      toClientStorageError("Remote file operation failed, please check node configuration, path or permissions"),
      { status: 502 },
    );
  }
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      requireAuth: true,
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "Remote file operation failed",
      bodySchema: postSchema,
    },
    async ({ session, body }) => {
      if (!session)
        throw new AuthError("Not authenticated");
      return handlePost(body, session);
    },
  );
}
