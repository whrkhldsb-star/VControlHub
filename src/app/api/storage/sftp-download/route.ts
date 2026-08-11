import path from "node:path";
import { Readable } from "node:stream";
import { guessContentType } from "@/lib/http/mime-types";

import { Client } from "ssh2";
import { NextResponse } from "next/server";
import { connectSsh, readRemoteFile, type SshConnectionParams } from "@/lib/ssh/client";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";

import { createLogger } from "@/lib/logging";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { getSftpNodeConnection } from "@/lib/storage/sftp-node";
import {
  normalizeRemoteTargetPath,
  normalizeRemoteRelativePath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import { contentDownloadQuerySchema } from "@/lib/storage/schema";
import { prisma } from "@/lib/db";
import { parseStorageRange, storageStreamResponse, type StorageByteRange } from "@/lib/storage/streaming";

import { AuthError, ValidationError } from "@/lib/errors";
import { getServerLocale, t } from "@/lib/i18n/translations";
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
  const locale = await getServerLocale();
  return withApiRoute(
    request,
    { permission: "storage:read" },
    async ({ session }) => {
      if (!session)
        throw new AuthError(t("api.auth.sessionExpired", locale));

      const { nodeId, path: remotePath, download } = parseSearchParams(
        request,
        contentDownloadQuerySchema,
      );

      if (!nodeId) {
        return NextResponse.json(
          { error: t("api.storage.missingNodeId", locale) },
          { status: 400 },
        );
      }

      if (!remotePath) {
        throw new ValidationError(t("api.storage.missingPath", locale));
      }

      const { node, credentials: connectionCredentials } = await getSftpNodeConnection(nodeId, session);

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
          { error: accessDecision.reason ?? t("api.storage.accessDenied", locale) },
          { status: 403 },
        );
      }

	  const indexedEntry = await prisma.fileEntry.findFirst({
		where: { storageNodeId: node.id, relativePath: normalizedRelativePath },
		select: { isDeleted: true },
	  });
	  if (indexedEntry?.isDeleted) {
		return NextResponse.json(
		  { error: t("api.storage.fileUnavailable", locale) },
		  { status: 404 },
		);
	  }

      const fileName = path.basename(normalizedRemotePath);
      const contentType = guessContentType(fileName);

      let client: Client | null = null;

      try {
        if (connectionCredentials.agentServerId && !connectionCredentials.privateKey && !connectionCredentials.password) {
          const buffer = await readRemoteFile({ ...connectionCredentials, remotePath: normalizedRemotePath });
          const range = parseStorageRange(request.headers.get("range"), buffer.length);
          if (range instanceof Response) return range;
          const selected = buffer.subarray(range.start, range.end + 1);
          return storageStreamResponse({
            stream: Readable.from(selected),
            range,
            fileName,
            fileSize: buffer.length,
            contentType,
            download,
          });
        }
        const config: SshConnectionParams = {
          host: connectionCredentials.host,
          port: connectionCredentials.port,
          username: connectionCredentials.username,
          privateKey: connectionCredentials.privateKey,
          password: connectionCredentials.password,
          hostKeySha256: connectionCredentials.hostKeySha256,
          agentServerId: connectionCredentials.agentServerId,
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
            t("api.storage.sftp.downloadFailed", locale),
          ),
          { status: 502 },
        );
      }
    },
  );
}
