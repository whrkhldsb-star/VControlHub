import path from "node:path";

import { Client, type ConnectConfig } from "ssh2";
import { NextResponse } from "next/server";
import { connectSsh } from "@/lib/ssh/client";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import {
  normalizeRemoteTargetPath,
  normalizeRemoteRelativePath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import { contentDownloadQuerySchema } from "@/lib/storage/schema";
import { parseStorageRange, storageStreamResponse, type StorageByteRange } from "@/lib/storage/streaming";

import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
const logger = createLogger("api:storage:sftp-download");

export const dynamic = "force-dynamic";

function guessContentType(fileName: string): string {
  const ext = path.extname(fileName).toLowerCase();
  if ([".jpg", ".jpeg"].includes(ext)) return "image/jpeg";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".bmp") return "image/bmp";
  if (ext === ".ico") return "image/x-icon";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mkv") return "video/x-matroska";
  if (ext === ".avi") return "video/x-msvideo";
  if (ext === ".mp3") return "audio/mpeg";
  if (ext === ".wav") return "audio/wav";
  if (ext === ".ogg") return "audio/ogg";
  if (ext === ".flac") return "audio/flac";
  if (ext === ".aac") return "audio/aac";
  if (ext === ".pdf") return "application/pdf";
  if (ext === ".txt") return "text/plain; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".xml") return "application/xml; charset=utf-8";
  if (ext === ".html" || ext === ".htm") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "application/javascript; charset=utf-8";
  if (ext === ".zip") return "application/zip";
  if (ext === ".tar") return "application/x-tar";
  if (ext === ".gz") return "application/gzip";
  if (ext === ".7z") return "application/x-7z-compressed";
  return "application/octet-stream";
}

function getSftpStream(
  client: Client,
  remotePath: string,
  rangeHeader: string | null,
): Promise<{ stream: import("stream").Readable; stat: { size: number }; range: StorageByteRange } | Response> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);

      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) return reject(statErr);
        if (!stats.isFile()) return reject(new Error("目标不是可下载文件"));

        const range = parseStorageRange(rangeHeader, stats.size);
        if (range instanceof Response) return resolve(range);
        const streamOptions = range.status === 206 ? { start: range.start, end: range.end } : undefined;
        const readStream = sftp.createReadStream(remotePath, streamOptions);
        resolve({
          stream: readStream as import("stream").Readable,
          stat: { size: stats.size },
          range,
        });
      });
    });
  });
}

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "storage:read" },
    async ({ session }) => {
      if (!session)
        throw new AuthError("未认证");

      const _url = new URL(request.url);
      const { nodeId, path: remotePath, download } = parseSearchParams(
        request,
        contentDownloadQuerySchema,
      );

      if (!nodeId) {
        return NextResponse.json(
          { error: "缺少 nodeId 参数" },
          { status: 400 },
        );
      }

      if (!remotePath) {
        throw new ValidationError("缺少 path 参数");
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
        throw new NotFoundError("存储节点不存在");
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
        normalizedRemotePath = normalizeRemoteTargetPath(
          node.basePath,
          remotePath,
        );
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

      const fileName = path.basename(normalizedRemotePath);
      const contentType = guessContentType(fileName);

      let client: Client | null = null;

      try {
        const config: ConnectConfig = {
          host: connectionCredentials.host,
          port: connectionCredentials.port,
          username: connectionCredentials.username,
          privateKey: connectionCredentials.privateKey,
          password: connectionCredentials.password,
          readyTimeout: 15000,
          timeout: 10000,
        };

        client = await connectSsh(config);
        const streamResult = await getSftpStream(
          client,
          normalizedRemotePath,
          request.headers.get("range"),
        );
        if (streamResult instanceof Response) {
          client.end();
          client = null;
          return streamResult;
        }
        const { stream: nodeStream, stat, range } = streamResult;

        const closeClient = () => {
          client?.end();
          client = null;
        };
        nodeStream.once("close", closeClient);
        nodeStream.once("error", closeClient);

        return storageStreamResponse({
          stream: nodeStream,
          range,
          fileName,
          fileSize: stat.size,
          contentType,
          download,
        });
      } catch (error) {
        // 确保出错时关闭连接
        client?.end();

        logger.error("read remote file for download failed", error, { nodeId });
        return NextResponse.json(
          toClientStorageError(
            "获取远端文件失败，请检查文件是否存在或节点是否可连接",
          ),
          { status: 502 },
        );
      }
    },
  );
}
