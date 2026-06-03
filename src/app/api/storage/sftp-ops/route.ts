import { NextResponse } from "next/server";
import { z } from "zod";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { SessionPayload } from "@/lib/auth/session";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import {
  createRemoteDirectory,
  deleteRemoteFile,
  renameRemoteFile,
  readRemoteFile,
  writeRemoteFile,
} from "@/lib/ssh/client";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
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
    });
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

const postSchema = z.object({
  nodeId: z.string().min(1),
  action: z.enum(["delete", "rename", "read", "write"]),
  path: z.string().min(1),
  newPath: z.string().optional(),
  content: z.string().optional(),
  isDirectory: z.boolean().optional(),
});

type SftpOpsBody = z.infer<typeof postSchema>;

async function handlePost(request: Request, session: SessionPayload) {
  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

  const zodResult = postSchema.safeParse(rawBody);
  if (!zodResult.success) {
    return NextResponse.json({ error: "输入参数无效" }, { status: 400 });
  }

  const body: SftpOpsBody = rawBody as SftpOpsBody;

  const { action, nodeId, path: remotePath } = body;

  if (!nodeId) {
    return NextResponse.json({ error: "缺少 nodeId 参数" }, { status: 400 });
  }

  if (!remotePath) {
    return NextResponse.json({ error: "缺少 path 参数" }, { status: 400 });
  }

  // Resolve storage node connection params (same pattern as sftp/route.ts)
  const node = await prisma.storageNode.findUnique({
    where: { id: nodeId },
    select: {
      id: true,
      name: true,
      driver: true,
      basePath: true,
      host: true,
      port: true,
      username: true,
      serverId: true,
      server: {
        select: {
          id: true,
          host: true,
          port: true,
          username: true,
          connectionType: true,
          password: true,
          sshKey: {
            select: {
              privateKey: true,
            },
          },
        },
      },
    },
  });

  if (!node) {
    return NextResponse.json({ error: "存储节点不存在" }, { status: 404 });
  }

  if (node.driver !== "SFTP") {
    return NextResponse.json(
      { error: "该节点不是 SFTP 类型" },
      { status: 400 },
    );
  }

  const connectionCredentials = (() => {
    try {
      return resolveStorageSshCredentials(node);
    } catch (error) {
      return error instanceof Error
        ? error
        : new Error("缺少远端主机地址或连接凭据，无法连接");
    }
  })();
  if (connectionCredentials instanceof Error) {
    return NextResponse.json(
      { error: connectionCredentials.message },
      { status: 400 },
    );
  }

  let normalizedRemotePath: string;
  let normalizedRelativePath: string;
  try {
    normalizedRemotePath = normalizeRemoteTargetPath(node.basePath, remotePath);
    normalizedRelativePath = normalizeRemoteRelativePath(remotePath);
  } catch {
    return NextResponse.json(
      toClientStorageError("请求路径超出存储节点根目录"),
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
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
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
      { error: accessDecision.reason ?? "缺少存储访问授权" },
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
        await deleteRemoteFile({
          ...connParams,
          remotePath: normalizedRemotePath,
          isDirectory: body.isDirectory ?? false,
        });
        await softDeleteSftpIndex(node.id, normalizedRelativePath, body.isDirectory ?? false);
        return NextResponse.json({ success: true });
      }

      case "rename": {
        if (!body.newPath) {
          return NextResponse.json(
            { error: "缺少 newPath 参数" },
            { status: 400 },
          );
        }
        let normalizedNewPath: string;
        let normalizedNewRelativePath: string;
        try {
          normalizedNewPath = normalizeRemoteTargetPath(
            node.basePath,
            body.newPath,
          );
          normalizedNewRelativePath = normalizeRemoteRelativePath(body.newPath);
        } catch {
          return NextResponse.json(
            toClientStorageError("新路径超出存储节点根目录"),
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
                destinationAccessDecision.reason ?? "缺少目标路径存储访问授权",
            },
            { status: 403 },
          );
        }

        const targetParentDirectory = path.posix.dirname(normalizedNewPath);
        if (
          targetParentDirectory &&
          targetParentDirectory !== "." &&
          targetParentDirectory !== "/"
        ) {
          await createRemoteDirectory({
            ...connParams,
            remotePath: targetParentDirectory,
            recursive: true,
          });
        }
        await renameRemoteFile({
          ...connParams,
          oldPath: normalizedRemotePath,
          newPath: normalizedNewPath,
        });
        await renameSftpIndex(node.id, normalizedRelativePath, normalizedNewRelativePath, body.isDirectory ?? false);
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
              error: "文件超过 1 MB，暂不支持在线读取，请使用下载功能",
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
              error: "文件超过 1 MB，暂不支持在线读取，请使用下载功能",
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
          content = buffer.toString("base64");
          encoding = "base64";
        }

        return NextResponse.json({ content, encoding, size: buffer.length });
      }

      case "write": {
        if (body.content === undefined || body.content === null) {
          return NextResponse.json(
            { error: "缺少 content 参数" },
            { status: 400 },
          );
        }
        const parentDirectory = path.posix.dirname(normalizedRemotePath);
        if (
          parentDirectory &&
          parentDirectory !== "." &&
          parentDirectory !== "/"
        ) {
          await createRemoteDirectory({
            ...connParams,
            remotePath: parentDirectory,
            recursive: true,
          });
        }
        await writeRemoteFile({
          ...connParams,
          remotePath: normalizedRemotePath,
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
            await deleteRemoteFile({
              ...connParams,
              remotePath: normalizedRemotePath,
            });
          } catch (cleanupError) {
            logger.warn("failed to clean up remote file after index persistence failed", cleanupError, {
              nodeId,
              remotePath: normalizedRemotePath,
            });
          }
          throw indexError;
        }
        return NextResponse.json({ success: true });
      }

      default:
        return NextResponse.json(
          { error: `不支持的操作: ${action}` },
          { status: 400 },
        );
    }
  } catch (error) {
    logger.error("remote file operation failed", error, { action, nodeId });
    return NextResponse.json(
      toClientStorageError("远端文件操作失败，请检查节点配置、路径或权限"),
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
      errorMessage: "远端文件操作失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      return handlePost(request, session);
    },
  );
}
