import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";

import { Client, type ConnectConfig } from "ssh2";
import { NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/require-session";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { createLogger } from "@/lib/logging";
import { getMediaItem } from "@/lib/media/service";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { expandStorageBasePath, normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { normalizeRemoteRelativePath, normalizeRemoteTargetPath, toClientStorageError } from "@/lib/storage/remote-path";
import { parseStorageRange, storageStreamResponse, type StorageByteRange } from "@/lib/storage/streaming";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

import { apiError } from "@/lib/http/api-error";
export const dynamic = "force-dynamic";

const logger = createLogger("api:media:stream");

function resolveManagedLocalPath(basePath: string, relativePath: string) {
  const normalizedPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedPath.ok) throw new Error(normalizedPath.reason);
  const allowedRoot = path.resolve(expandStorageBasePath(basePath));
  const absolutePath = path.resolve(allowedRoot, normalizedPath.path);
  const relativeToRoot = path.relative(allowedRoot, absolutePath);
  if (relativeToRoot.startsWith("..") || path.isAbsolute(relativeToRoot)) throw new Error("非法路径");
  return { normalizedRelativePath: normalizedPath.path, absolutePath };
}

function connectSsh(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("ready", () => resolve(client));
    client.on("error", (err) => reject(err));
    client.connect(config);
  });
}

function openSftpStream(client: Client, remotePath: string, rangeHeader: string | null) {
  return new Promise<{ stream: import("stream").Readable; stat: { size: number }; range: StorageByteRange }>((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) return reject(statErr);
        if (!stats.isFile()) return reject(new Error("目标不是可播放文件"));
        const range = parseStorageRange(rangeHeader, stats.size);
        if (range instanceof Response) return reject(Object.assign(new Error("Range Not Satisfiable"), { response: range }));
        const stream = sftp.createReadStream(remotePath, { start: range.start, end: range.end });
        resolve({ stream: stream as import("stream").Readable, stat: { size: stats.size }, range });
      });
    });
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession("/media");
  if (!sessionHasPermission(session, "storage:read")) {
    return apiError({ code: "FORBIDDEN", message: "缺少存储读取权限", status: 403 });
  }

  const { id } = await params;
  const url = new URL(request.url);
  const download = url.searchParams.get("download") === "1";
  const item = await getMediaItem(id);
  if (!item || !item.storageNode) return apiError({ code: "NOT_FOUND", message: "媒体不存在", status: 404 });

  const node = item.storageNode;
  const accessDecision = await assertStorageAccess({
    session,
    storageNodeId: node.id,
    relativePath: item.relativePath,
    operation: "read",
  });
  if (!accessDecision.allowed) {
    return apiError({ code: "FORBIDDEN", message: accessDecision.reason ?? "缺少存储访问授权", status: 403 });
  }

  if (node.driver === "LOCAL") {
    let localPath: string;
    try {
      ({ absolutePath: localPath } = resolveManagedLocalPath(node.basePath, item.relativePath));
      const fileStat = await stat(localPath);
      if (!fileStat.isFile()) return apiError({ code: "VALIDATION_FAILED", message: "目标不是可播放文件", status: 400 });
      const range = parseStorageRange(request.headers.get("range"), fileStat.size);
      if (range instanceof Response) return range;
      const stream = createReadStream(localPath, { start: range.start, end: range.end });
      return storageStreamResponse({
        stream,
        range,
        contentType: item.mimeType,
        fileName: item.name,
        fileSize: fileStat.size,
        download,
      });
    } catch (error) {
      logger.error("read local media stream failed", error, { id });
      return apiError({ code: "NOT_FOUND", message: "文件不存在或暂时无法读取", status: 404 });
    }
  }

  if (node.driver !== "SFTP") {
    return apiError({ code: "VALIDATION_FAILED", message: "该存储节点暂不支持媒体流播放", status: 400 });
  }

  let normalizedRemotePath: string;
  let normalizedRelativePath: string;
  try {
    normalizedRemotePath = normalizeRemoteTargetPath(node.basePath, item.relativePath);
    normalizedRelativePath = normalizeRemoteRelativePath(item.relativePath);
  } catch {
    return NextResponse.json(toClientStorageError("请求路径超出存储节点根目录"), { status: 400 });
  }

  const remoteAccess = await assertStorageAccess({
    session,
    storageNodeId: node.id,
    relativePath: normalizedRelativePath,
    operation: "read",
  });
  if (!remoteAccess.allowed) {
    return apiError({ code: "FORBIDDEN", message: remoteAccess.reason ?? "缺少存储访问授权", status: 403 });
  }

  const connectionCredentials = (() => {
    try {
      return resolveStorageSshCredentials(node);
    } catch (error) {
      return error instanceof Error ? error : new Error("缺少远端主机地址或连接凭据，无法连接");
    }
  })();
  if (connectionCredentials instanceof Error) {
    return apiError({ code: "VALIDATION_FAILED", message: connectionCredentials.message, status: 400 });
  }

  let client: Client | null = null;
  try {
    client = await connectSsh({
      host: connectionCredentials.host,
      port: connectionCredentials.port,
      username: connectionCredentials.username,
      privateKey: connectionCredentials.privateKey,
      password: connectionCredentials.password,
      readyTimeout: 15000,
      timeout: 10000,
    });
    const { stream, stat: remoteStat, range } = await openSftpStream(client, normalizedRemotePath, request.headers.get("range"));
    stream.on("close", () => {
      client?.end();
      client = null;
    });
    stream.on("error", () => {
      client?.end();
      client = null;
    });
    return storageStreamResponse({
      stream,
      range,
      contentType: item.mimeType,
      fileName: item.name,
      fileSize: remoteStat.size,
      download,
    });
  } catch (error) {
    client?.end();
    const maybeResponse = (error as { response?: Response }).response;
    if (maybeResponse) return maybeResponse;
    logger.error("read remote media stream failed", error, { id, nodeId: node.id });
    return NextResponse.json(toClientStorageError("获取远端媒体失败，请检查文件是否存在或节点是否可连接"), { status: 502 });
  }
}
