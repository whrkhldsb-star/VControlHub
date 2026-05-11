import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import {
  deleteRemoteFile,
  renameRemoteFile,
  readRemoteFile,
  writeRemoteFile,
} from "@/lib/ssh/client";
import { normalizeRemoteTargetPath, toClientStorageError } from "@/lib/storage/remote-path";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:storage:sftp-ops");

export const dynamic = "force-dynamic";

type SftpOpsBody = {
  action: "delete" | "rename" | "read" | "write";
  nodeId: string;
  path: string;
  newPath?: string;
  content?: string;
  isDirectory?: boolean;
};

export async function POST(request: Request) {
  const session = await requireSession();

  let body: SftpOpsBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "无效的请求体" }, { status: 400 });
  }

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
  return NextResponse.json({ error: "该节点不是 SFTP 类型" }, { status: 400 });
 }

 const host = node.host ?? node.server?.host;
 const port = node.port ?? node.server?.port ?? 22;
 const username = node.username ?? node.server?.username ?? "root";
 const connectionType = node.server?.connectionType ?? "SSH_KEY";
const privateKey = (connectionType === "SSH_KEY" ? node.server?.sshKey?.privateKey : undefined) ?? undefined;
const password = (connectionType === "PASSWORD" ? node.server?.password : undefined) ?? undefined;

 if (!host || (connectionType === "SSH_KEY" && !privateKey) || (connectionType === "PASSWORD" && !password)) {
  return NextResponse.json(
  { error: "缺少远端主机地址或连接凭据，无法连接" },
  { status: 400 },
  );
 }

  let normalizedRemotePath: string;
  try {
    normalizedRemotePath = normalizeRemoteTargetPath(node.basePath, remotePath);
  } catch {
    return NextResponse.json(toClientStorageError("请求路径超出存储节点根目录"), { status: 400 });
  }

  const operation = action === "read" ? "read" : action === "delete" ? "delete" : "write";
  const requiredPermission = operation === "read" ? "storage:read" : operation === "delete" ? "storage:delete" : "storage:write";
  if (!sessionHasPermission(session, requiredPermission)) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }
  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: node.id,
    relativePath: remotePath,
    operation,
    writeBytes: action === "write" && typeof body.content === "string" ? Buffer.byteLength(body.content) : null,
  });
  if (!accessDecision.allowed) {
    return NextResponse.json({ error: accessDecision.reason ?? "缺少存储访问授权" }, { status: 403 });
  }

 const connParams = { host, port, username, privateKey, password };

  try {
    switch (action) {
      case "delete": {
        await deleteRemoteFile({
          ...connParams,
          remotePath: normalizedRemotePath,
          isDirectory: body.isDirectory ?? false,
        });
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
        try {
          normalizedNewPath = normalizeRemoteTargetPath(node.basePath, body.newPath);
        } catch {
          return NextResponse.json(toClientStorageError("新路径超出存储节点根目录"), { status: 400 });
        }
        const destinationAccessDecision = await assertStorageAccess({
          session,
          storageNodeId: node.id,
          relativePath: body.newPath,
          operation: "write",
          writeBytes: null,
        });
        if (!destinationAccessDecision.allowed) {
          return NextResponse.json(
            { error: destinationAccessDecision.reason ?? "缺少目标路径存储访问授权" },
            { status: 403 },
          );
        }

        await renameRemoteFile({
          ...connParams,
          oldPath: normalizedRemotePath,
          newPath: normalizedNewPath,
        });
        return NextResponse.json({ success: true });
      }

      case "read": {
        const buffer = await readRemoteFile({
          ...connParams,
          remotePath: normalizedRemotePath,
        });

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
        await writeRemoteFile({
          ...connParams,
          remotePath: normalizedRemotePath,
          content: body.content,
        });
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
    return NextResponse.json(toClientStorageError("远端文件操作失败，请检查节点配置、路径或权限"), { status: 502 });
  }
}
