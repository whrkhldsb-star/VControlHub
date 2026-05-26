import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

import { prisma } from "@/lib/db";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { listRemoteDirectory } from "@/lib/ssh/client";
import { normalizeRemotePath, toClientStorageError } from "@/lib/storage/remote-path";
import { createLogger } from "@/lib/logging";

const logger = createLogger("api:storage:sftp");

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "storage:read")) {
    return NextResponse.json({ error: "缺少权限" }, { status: 403 });
  }
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
  return NextResponse.json({ error: "该节点不是 SFTP 类型" }, { status: 400 });
 }

 // 确定连接参数：优先使用节点自身的 host/port/username，否则从绑定的 server 继承
 const host = node.host ?? node.server?.host;
 const port = node.port ?? node.server?.port ?? 22;
 const username = node.username ?? node.server?.username ?? "root";
 const connectionType = node.server?.connectionType ?? "SSH_KEY";
const privateKey = (connectionType === "SSH_KEY" && node.server?.sshKey?.privateKey ? decryptSshPrivateKey(node.server.sshKey.privateKey) : undefined) ?? undefined;
const password = (connectionType === "PASSWORD" ? node.server?.password : undefined) ?? undefined;

 if (!host || (connectionType === "SSH_KEY" && !privateKey) || (connectionType === "PASSWORD" && !password)) {
  return NextResponse.json(
  { error: "缺少远端主机地址或连接凭据，无法连接" },
  { status: 400 },
  );
 }

  let normalizedRemotePath: string;
  try {
    normalizedRemotePath = normalizeRemotePath(node.basePath, remotePath);
  } catch {
    return NextResponse.json(toClientStorageError("请求路径超出存储节点根目录"), { status: 400 });
  }

  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: node.id,
    relativePath: remotePath,
    operation: "read",
  });
  if (!accessDecision.allowed) {
    return NextResponse.json({ error: accessDecision.reason ?? "缺少存储访问授权" }, { status: 403 });
  }

 try {
 const entries = await listRemoteDirectory({
  host,
  port,
  username,
  privateKey,
  password,
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
    return NextResponse.json(toClientStorageError("连接远端节点失败，请检查节点配置或远端路径"), { status: 502 });
  }
}
