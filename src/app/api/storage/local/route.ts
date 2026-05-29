import { createReadStream } from "node:fs";
import { access, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import type { SessionPayload } from "@/lib/auth/session";

import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { prisma } from "@/lib/db";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { logError } from "@/lib/logging";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { createRemoteDirectory, writeRemoteFile } from "@/lib/ssh/client";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { normalizeRemoteTargetPath } from "@/lib/storage/remote-path";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { withApiRoute } from "@/lib/http/api-guard";

type UploadLike = {
  arrayBuffer(): Promise<ArrayBuffer>;
  name?: string;
  type?: string;
  size?: number;
};

function isUploadLike(value: unknown): value is UploadLike {
  return (
    !!value &&
    typeof value === "object" &&
    typeof (value as UploadLike).arrayBuffer === "function"
  );
}

export const dynamic = "force-dynamic";

function resolveManagedLocalPath(basePath: string, relativePath: string) {
  const normalizedPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedPath.ok) {
    throw new Error(normalizedPath.reason);
  }

  const normalizedRelativePath = normalizedPath.path;
  const allowedRoot = path.resolve(basePath);
  const absolutePath = path.resolve(allowedRoot, normalizedRelativePath);
  const relativeToRoot = path.relative(allowedRoot, absolutePath);

  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) {
    throw new Error("非法路径");
  }

  return {
    normalizedRelativePath,
    absolutePath,
    allowedRoot,
  };
}

function guessContentType(fileName: string, mimeType: string | null) {
  if (mimeType) {
    return mimeType;
  }

  const ext = path.extname(fileName).toLowerCase();
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function handleGet(request: Request, session: SessionPayload) {
  const url = new URL(request.url);
  const relativePath = url.searchParams.get("path");
  const storageNodeId = url.searchParams.get("nodeId");
  const download = url.searchParams.get("download") === "1";

  if (!relativePath) {
    return NextResponse.json({ error: "缺少 path 参数" }, { status: 400 });
  }

  const normalizedDownloadPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedDownloadPath.ok) {
    return NextResponse.json(
      { error: normalizedDownloadPath.reason },
      { status: 400 },
    );
  }

  const entryWhere: Record<string, unknown> = {
    relativePath: normalizedDownloadPath.path,
    isDeleted: false,
    storageNode: {
      driver: "LOCAL",
    },
  };
  // If nodeId specified, scope to that specific node to avoid cross-node path collisions
  if (storageNodeId) {
    entryWhere.storageNodeId = storageNodeId;
  }

  const entry = await prisma.fileEntry.findFirst({
    where: entryWhere,
    include: {
      storageNode: {
        select: {
          id: true,
          name: true,
          basePath: true,
          driver: true,
        },
      },
    },
  });

  if (!entry) {
    return NextResponse.json(
      { error: "文件条目不存在，或未登记为本机存储文件" },
      { status: 404 },
    );
  }

  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: entry.storageNode.id,
    relativePath: entry.relativePath,
    operation: "read",
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: accessDecision.reason ?? "缺少存储访问授权" },
      { status: 403 },
    );
  }

  let absolutePath: string;
  try {
    ({ absolutePath } = resolveManagedLocalPath(
      entry.storageNode.basePath,
      normalizedDownloadPath.path,
    ));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "非法路径" },
      { status: 400 },
    );
  }

  try {
    await access(absolutePath);
    const fileStat = await stat(absolutePath);
    if (!fileStat.isFile()) {
      return NextResponse.json(
        { error: "目标不是可下载文件" },
        { status: 400 },
      );
    }

    const nodeStream = createReadStream(absolutePath);
    const body = nodeStreamToWeb(nodeStream);
    const headers = new Headers();
    headers.set("content-type", guessContentType(entry.name, entry.mimeType));
    headers.set("content-length", String(fileStat.size));
    headers.set("cache-control", "private, no-store");
    headers.set(
      "content-disposition",
      buildContentDisposition(download ? "attachment" : "inline", entry.name),
    );

    return new Response(body, { status: 200, headers });
  } catch (downloadError) {
    logError("[/api/storage/local] download error:", downloadError);
    return NextResponse.json(
      { error: "文件不存在或暂时无法读取" },
      { status: 404 },
    );
  }
}

async function handlePost(request: Request, session: SessionPayload) {
  const formData = await request.formData();
  const storageNodeId = String(formData.get("storageNodeId") ?? "").trim();
  const relativePath = String(formData.get("relativePath") ?? "").trim();
  const file = formData.get("file");

  if (!storageNodeId) {
    return NextResponse.json(
      { error: "缺少 storageNodeId 参数" },
      { status: 400 },
    );
  }

  if (!relativePath) {
    return NextResponse.json(
      { error: "缺少 relativePath 参数" },
      { status: 400 },
    );
  }

  const normalizedUploadPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedUploadPath.ok) {
    return NextResponse.json(
      { error: normalizedUploadPath.reason },
      { status: 400 },
    );
  }

  if (!isUploadLike(file)) {
    return NextResponse.json({ error: "缺少上传文件" }, { status: 400 });
  }

  const storageNode = await prisma.storageNode.findUnique({
    where: { id: storageNodeId },
    select: {
      id: true,
      name: true,
      driver: true,
      basePath: true,
      host: true,
      port: true,
      username: true,
      server: {
        select: {
          host: true,
          port: true,
          username: true,
          connectionType: true,
          password: true,
          sshKey: { select: { privateKey: true } },
        },
      },
    },
  });

  if (!storageNode || !["LOCAL", "SFTP"].includes(storageNode.driver)) {
    return NextResponse.json(
      { error: "仅支持上传到 LOCAL 或 SFTP 存储节点" },
      { status: 400 },
    );
  }

  let normalizedRelativePath: string;
  let absolutePath: string | null = null;
  let remotePath: string | null = null;

  try {
    if (storageNode.driver === "LOCAL") {
      ({ normalizedRelativePath, absolutePath } = resolveManagedLocalPath(
        storageNode.basePath,
        normalizedUploadPath.path,
      ));
    } else {
      normalizedRelativePath = normalizedUploadPath.path;
      remotePath = normalizeRemoteTargetPath(
        storageNode.basePath,
        normalizedRelativePath,
      );
    }
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "非法路径" },
      { status: 400 },
    );
  }

  const fileBuffer = Buffer.from(await file.arrayBuffer());
  const byteSize =
    typeof file.size === "number" &&
    Number.isFinite(file.size) &&
    file.size >= 0
      ? file.size
      : fileBuffer.byteLength;
  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId,
    relativePath: normalizedRelativePath,
    operation: "write",
    writeBytes: byteSize,
  });
  if (!accessDecision.allowed) {
    return NextResponse.json(
      { error: accessDecision.reason ?? "缺少存储写入授权" },
      { status: 403 },
    );
  }
  const mimeType = file.type || null;
  const fileName = path.posix.basename(normalizedRelativePath);

  if (storageNode.driver === "LOCAL") {
    if (!absolutePath) {
      return NextResponse.json(
        { error: "本机存储路径解析失败" },
        { status: 400 },
      );
    }
    const parentDir = path.dirname(absolutePath);
    await mkdir(parentDir, { recursive: true });
    await writeFile(absolutePath, fileBuffer);
  } else {
    if (!remotePath) {
      return NextResponse.json(
        { error: "远端存储路径解析失败" },
        { status: 400 },
      );
    }
    let credentials: ReturnType<typeof resolveStorageSshCredentials>;
    try {
      credentials = resolveStorageSshCredentials(storageNode);
    } catch (error) {
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "连接凭据不可用" },
        { status: 400 },
      );
    }
    const remoteParent = path.posix.dirname(remotePath);
    try {
      await createRemoteDirectory({
        ...credentials,
        remotePath: remoteParent,
        recursive: true,
      });
      await writeRemoteFile({
        ...credentials,
        remotePath,
        content: fileBuffer,
      });
    } catch (error) {
      logError("[/api/storage/local] sftp upload error:", error);
      return NextResponse.json(
        { error: error instanceof Error ? error.message : "远端上传失败" },
        { status: 502 },
      );
    }
  }

  const existingEntry = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId,
      relativePath: normalizedRelativePath,
    },
    select: {
      id: true,
    },
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
        storageNodeId,
        name: fileName,
        entryType: "FILE",
        mimeType,
        size: BigInt(byteSize),
        relativePath: normalizedRelativePath,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    storageNodeId,
    relativePath: normalizedRelativePath,
    size: byteSize,
  });
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read", errorMessage: "读取本机文件失败" },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      return handleGet(request, session);
    },
  );
}

export async function POST(request: Request) {
  return withApiRoute(
    request,
    {
      permission: "storage:write",
      rateLimit: GENERAL_WRITE_LIMIT,
      errorMessage: "上传文件失败",
    },
    async ({ session }) => {
      if (!session)
        return NextResponse.json({ error: "未认证" }, { status: 401 });
      return handlePost(request, session);
    },
  );
}
