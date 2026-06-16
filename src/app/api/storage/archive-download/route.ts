import { stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";
import type { Client } from "ssh2";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { createLogger } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import {
  archiveStreamResponse,
  closeSshClientOnStreamEnd,
  connectArchiveSsh,
  safeArchiveName,
  streamLocalTarGz,
  streamRemoteTarGz,
} from "@/lib/storage/archive-stream";
import { normalizeStorageRelativePath, resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { normalizeRemoteTargetPath, toClientStorageError } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";
import { storageFileQuerySchema } from "@/lib/storage/schema";

import { AuthError, NotFoundError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const logger = createLogger("api:storage:archive-download");

type DirectoryEntry = {
  id: string;
  name: string;
  relativePath: string;
  entryType: string;
  mimeType: string | null;
  storageNode: {
    id: string;
    name: string;
    driver: string;
    basePath: string;
    host: string | null;
    port: number | null;
    username: string | null;
    server: {
      host: string;
      port: number;
      username: string;
      connectionType: string;
      password: string | null;
      sshKey: { privateKey: string } | null;
    } | null;
  };
};

function isDirectoryEntry(entry: DirectoryEntry) {
  return entry.entryType === "DIRECTORY" || entry.mimeType === "inode/directory";
}

async function findDirectoryEntry(nodeId: string, relativePath: string) {
  return prisma.fileEntry.findFirst({
    where: {
      storageNodeId: nodeId,
      relativePath,
      isDeleted: false,
    },
    include: {
      storageNode: {
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
      },
    },
  }) as Promise<DirectoryEntry | null>;
}

export async function GET(request: Request) {
  return withApiRoute(request, { permission: "storage:read" }, async ({ session }) => {
    if (!session) {
      throw new AuthError("未认证");
    }

    const url = new URL(request.url);
    const { nodeId, path: requestedPath } = parseSearchParams(
      request,
      storageFileQuerySchema,
    );

    if (!nodeId) {
      throw new ValidationError("缺少 nodeId 参数");
    }
    if (!requestedPath) {
      throw new ValidationError("缺少 path 参数");
    }

    const normalizedPath = normalizeStorageRelativePath(requestedPath);
    if (!normalizedPath.ok) {
      throw new ValidationError(normalizedPath.reason);
    }

    const entry = await findDirectoryEntry(nodeId, normalizedPath.path);
    if (!entry) {
      throw new NotFoundError("目录条目不存在");
    }
    if (!isDirectoryEntry(entry)) {
      throw new ValidationError("目标不是目录");
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

    const archiveName = safeArchiveName(entry.name);

    if (entry.storageNode.driver === "LOCAL") {
      const resolved = resolveStoragePathWithinBase(entry.storageNode.basePath, entry.relativePath);
      if (!resolved.ok) {
        throw new ValidationError(resolved.reason);
      }
      const directoryStat = await stat(resolved.path).catch(() => null);
      if (!directoryStat?.isDirectory()) {
        throw new NotFoundError("本机目录不存在或不可读取");
      }
      const stream = streamLocalTarGz(resolved.path, path.basename(resolved.path));
      return archiveStreamResponse(stream, archiveName);
    }

    if (entry.storageNode.driver !== "SFTP") {
      throw new ValidationError("该存储节点暂不支持目录下载");
    }

    const credentials = (() => {
      try {
        return resolveStorageSshCredentials(entry.storageNode);
      } catch (error) {
        return error instanceof Error ? error : new Error("缺少远端连接凭据");
      }
    })();
    if (credentials instanceof Error) {
      throw new ValidationError(credentials.message);
    }

    let client: Client | null = null;
    try {
      const remotePath = normalizeRemoteTargetPath(entry.storageNode.basePath, entry.relativePath);
      client = await connectArchiveSsh({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        privateKey: credentials.privateKey,
        password: credentials.password,
        readyTimeout: 15000,
        timeout: 10000,
      });
      const stream = await streamRemoteTarGz(client, remotePath);
      closeSshClientOnStreamEnd(stream, client);
      client = null;
      return archiveStreamResponse(stream, archiveName);
    } catch (error) {
      client?.end();
      logger.error("archive download failed", error, { nodeId: entry.storageNode.id });
      return NextResponse.json(toClientStorageError("目录归档下载失败"), { status: 502 });
    }
  });
}
