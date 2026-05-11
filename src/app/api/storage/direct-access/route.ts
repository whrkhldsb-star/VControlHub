import { NextResponse } from "next/server";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { requireSession } from "@/lib/auth/require-session";

import { prisma } from "@/lib/db";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";

export const dynamic = "force-dynamic";

/**
 * Direct public HTTP serving from remote VPS nodes was intentionally disabled.
 *
 * The previous prototype started an unmanaged public file server on the target
 * VPS, but that server cannot enforce this app's auth, signed tokens, expiry,
 * or exact-file authorization. Remote SFTP media access should use the managed
 * `/api/storage/sftp-download` stream instead, which authenticates every
 * request through the control plane and constrains paths under the storage
 * node base path.
 */

export async function POST(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "storage:read")) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const { nodeId, relativePath } = body as { nodeId?: string; relativePath?: string };

  if (!nodeId || !relativePath) {
    return NextResponse.json({ error: "缺少 nodeId 或 relativePath" }, { status: 400 });
  }

  const node = await prisma.storageNode.findUnique({
    where: { id: nodeId },
    select: { basePath: true },
  });

  if (!node) {
    return NextResponse.json({ error: "存储节点不存在" }, { status: 404 });
  }

  try {
    normalizeRemoteTargetPath(node.basePath, relativePath);
  } catch {
    return NextResponse.json({ error: "请求路径超出存储节点根目录" }, { status: 400 });
  }

  const params = new URLSearchParams({ nodeId, path: relativePath });
  return NextResponse.json(
    {
      error: "VPS 直连播放已停用，请使用受控的 SFTP 中转预览/下载。",
      fallbackUrl: `/api/storage/sftp-download?${params.toString()}`,
      mode: "managed-download",
    },
    { status: 410 },
  );
}

export async function DELETE(request: Request) {
  const session = await requireSession();
  if (!sessionHasPermission(session, "storage:read")) {
    return NextResponse.json({ error: "无权限" }, { status: 403 });
  }

  await request.json().catch(() => ({}));
  return NextResponse.json({ stopped: true, mode: "managed-download" });
}
