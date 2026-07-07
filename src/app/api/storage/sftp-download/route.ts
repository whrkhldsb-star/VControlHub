import path from "node:path";
import { guessContentType } from "@/lib/http/mime-types";

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
        if (!stats.isFile()) return reject(new Error("TargetnotiscanDownloadFile"));

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
        throw new AuthError("Not authenticated");

      const _url = new URL(request.url);
      const { nodeId, path: remotePath, download } = parseSearchParams(
        request,
        contentDownloadQuerySchema,
      );

      if (!nodeId) {
        return NextResponse.json(
          { error: "Missing nodeId Parameter" },
          { status: 400 },
        );
      }

      if (!remotePath) {
        throw new ValidationError("Missing path Parameter");
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
        throw new NotFoundError("Storage node not found");
      }

      if (node.driver !== "SFTP") {
        return NextResponse.json(
          { error: "This Node is Not SFTP type" },
          { status: 400 },
        );
      }

      const connectionCredentials = (() => {
        try {
          return resolveStorageSshCredentials(node);
        } catch (error) {
          return error instanceof Error
            ? error
            : new Error("Missing remote host address or connection credentials, cannot connect");
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
          toClientStorageError("Requested path exceeds storage node root directory"),
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
          { error: accessDecision.reason ?? "Missing storage access authorization" },
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
            "failed to fetch remote file, please check if the file exists or the node can be connected",
          ),
          { status: 502 },
        );
      }
    },
  );
}
