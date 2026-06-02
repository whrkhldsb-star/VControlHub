import { stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

import { Client, type ConnectConfig } from "ssh2";
import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { buildContentDisposition } from "@/lib/http/content-disposition";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { createLogger } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { normalizeStorageRelativePath, resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { normalizeRemoteTargetPath, toClientStorageError } from "@/lib/storage/remote-path";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

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

function safeArchiveName(name: string) {
  const base = path.basename(name).replace(/[^\w.\-\u4e00-\u9fff]+/g, "-");
  return `${base || "folder"}.tar.gz`;
}

function isDirectoryEntry(entry: DirectoryEntry) {
  return entry.entryType === "DIRECTORY" || entry.mimeType === "inode/directory";
}

function streamLocalTarGz(directoryPath: string, entryName: string) {
  const tar = spawn("tar", ["-czf", "-", "-C", path.dirname(directoryPath), "--", entryName], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  tar.stderr.on("data", (chunk) => {
    logger.warn("local archive tar stderr", { message: String(chunk).slice(0, 500) });
  });
  return tar.stdout;
}

function shellQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function connectSsh(config: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const client = new Client();
    client.on("ready", () => resolve(client));
    client.on("error", (err) => reject(err));
    client.connect(config);
  });
}

function streamRemoteTarGz(client: Client, remoteDirectoryPath: string) {
  return new Promise<NodeJS.ReadableStream>((resolve, reject) => {
    const parent = path.posix.dirname(remoteDirectoryPath);
    const name = path.posix.basename(remoteDirectoryPath);
    const command = `tar -czf - -C ${shellQuote(parent)} -- ${shellQuote(name)}`;
    client.exec(command, (err, stream) => {
      if (err) return reject(err);
      stream.stderr.on("data", (chunk: Buffer) => {
        logger.warn("remote archive tar stderr", { message: chunk.toString("utf8").slice(0, 500) });
      });
      resolve(stream);
    });
  });
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
      return NextResponse.json({ error: "未认证" }, { status: 401 });
    }

    const url = new URL(request.url);
    const nodeId = url.searchParams.get("nodeId")?.trim();
    const requestedPath = url.searchParams.get("path");

    if (!nodeId) {
      return NextResponse.json({ error: "缺少 nodeId 参数" }, { status: 400 });
    }
    if (!requestedPath) {
      return NextResponse.json({ error: "缺少 path 参数" }, { status: 400 });
    }

    const normalizedPath = normalizeStorageRelativePath(requestedPath);
    if (!normalizedPath.ok) {
      return NextResponse.json({ error: normalizedPath.reason }, { status: 400 });
    }

    const entry = await findDirectoryEntry(nodeId, normalizedPath.path);
    if (!entry) {
      return NextResponse.json({ error: "目录条目不存在" }, { status: 404 });
    }
    if (!isDirectoryEntry(entry)) {
      return NextResponse.json({ error: "目标不是目录" }, { status: 400 });
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

    const headers = new Headers();
    headers.set("content-type", "application/gzip");
    headers.set("cache-control", "private, no-store");
    headers.set("content-disposition", buildContentDisposition("attachment", safeArchiveName(entry.name)));

    if (entry.storageNode.driver === "LOCAL") {
      const resolved = resolveStoragePathWithinBase(entry.storageNode.basePath, entry.relativePath);
      if (!resolved.ok) {
        return NextResponse.json({ error: resolved.reason }, { status: 400 });
      }
      const directoryStat = await stat(resolved.path).catch(() => null);
      if (!directoryStat?.isDirectory()) {
        return NextResponse.json({ error: "本机目录不存在或不可读取" }, { status: 404 });
      }
      const stream = streamLocalTarGz(resolved.path, path.basename(resolved.path));
      return new Response(nodeStreamToWeb(stream), { status: 200, headers });
    }

    if (entry.storageNode.driver !== "SFTP") {
      return NextResponse.json({ error: "该存储节点暂不支持目录下载" }, { status: 400 });
    }

    const credentials = (() => {
      try {
        return resolveStorageSshCredentials(entry.storageNode);
      } catch (error) {
        return error instanceof Error ? error : new Error("缺少远端连接凭据");
      }
    })();
    if (credentials instanceof Error) {
      return NextResponse.json({ error: credentials.message }, { status: 400 });
    }

    let client: Client | null = null;
    try {
      const remotePath = normalizeRemoteTargetPath(entry.storageNode.basePath, entry.relativePath);
      client = await connectSsh({
        host: credentials.host,
        port: credentials.port,
        username: credentials.username,
        privateKey: credentials.privateKey,
        password: credentials.password,
        readyTimeout: 15000,
        timeout: 10000,
      });
      const stream = await streamRemoteTarGz(client, remotePath);
      stream.on("close", () => {
        client?.end();
        client = null;
      });
      stream.on("error", () => {
        client?.end();
        client = null;
      });
      return new Response(nodeStreamToWeb(stream), { status: 200, headers });
    } catch (error) {
      client?.end();
      logger.error("archive download failed", error, { nodeId: entry.storageNode.id });
      return NextResponse.json(toClientStorageError("目录归档下载失败"), { status: 502 });
    }
  });
}
