import { NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth/session";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import {
  normalizeRemotePath,
  normalizeRemoteRelativePath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import { createLogger } from "@/lib/logging";
import { withApiRoute } from "@/lib/http/api-guard";

const logger = createLogger("api:storage:sftp");

export const dynamic = "force-dynamic";

async function handleGet(request: Request, session: SessionPayload) {
  const url = new URL(request.url);
  const nodeId = url.searchParams.get("nodeId");
  const remotePath = url.searchParams.get("path") ?? "/";

  if (!nodeId) {
    return NextResponse.json({ error: "缺少 nodeId 参数" }, { status: 400 });
  }

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
    normalizedRemotePath = normalizeRemotePath(node.basePath, remotePath);
    normalizedRelativePath = normalizeRemoteRelativePath(remotePath);
  } catch {
    return NextResponse.json(
      toClientStorageError("请求路径超出存储节点根目录"),
      { status: 400 },
    );
  }

  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: node.id,
    relativePath: normalizedRelativePath,
    operation: "read",
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: accessDecision.reason ?? "缺少存储访问授权" },
      { status: 403 },
    );
  }

  try {
    const entries = await listRemoteDirectory({
      host: connectionCredentials.host,
      port: connectionCredentials.port,
      username: connectionCredentials.username,
      privateKey: connectionCredentials.privateKey,
      password: connectionCredentials.password,
      remotePath: normalizedRemotePath,
    });
    return NextResponse.json({
      nodeId: node.id,
      nodeName: node.name,
      remotePath: remotePath.startsWith("/") ? remotePath : `/${remotePath}`,
      entries,
    });
  } catch (error) {
    logger.error("list remote directory failed", error);
    return NextResponse.json(
      toClientStorageError("连接远端节点失败，请检查节点配置或远端路径"),
      { status: 502 },
    );
  }
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "列出远端目录失败" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      return handleGet(request, session);
    },
  );
}
