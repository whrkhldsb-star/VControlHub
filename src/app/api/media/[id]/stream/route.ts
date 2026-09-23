import { apiCopy } from "@/lib/i18n/api-copy";
import { getServerLocale } from "@/lib/i18n/translations";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { NextResponse } from "next/server";
import { Client } from "ssh2";
import { z } from "zod";

import { connectSsh, readRemoteFile } from "@/lib/ssh/client";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { createLogger } from "@/lib/logging";
import { getMediaItem } from "@/lib/media/service";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { storageAccessDeniedCopy } from "@/lib/storage/access-denied";
import {
  normalizeStorageRelativePath,
  resolveStoragePathWithinBase,
} from "@/lib/storage/path-utils";
import {
  normalizeRemoteTargetPath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import {
  parseStorageRange,
  storageStreamResponse,
  type StorageByteRange,
} from "@/lib/storage/streaming";
import { resolveStorageSshCredentials } from "@/lib/storage/ssh-credentials";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { AuthError, ValidationError, isAppError } from "@/lib/errors";

import { apiError } from "@/lib/http/api-error";
export const dynamic = "force-dynamic";

const logger = createLogger("api:media:stream");

/**
 * A live SFTP read that stops producing bytes must not hold the SSH client and
 * the HTTP response open forever — the socket can stay healthy while the remote
 * side never sends another byte. Reset on every chunk, so a slow-but-advancing
 * transfer of a large video is never killed. Same budget as the SFTP service
 * and the download relay.
 */
const STREAM_IDLE_TIMEOUT_MS = 120_000;

function resolveManagedLocalPath(basePath: string, relativePath: string) {
  const normalizedPath = normalizeStorageRelativePath(relativePath);
  if (!normalizedPath.ok) throw new Error(normalizedPath.reason);
  const resolved = resolveStoragePathWithinBase(basePath, normalizedPath.path);
  if (!resolved.ok) throw new ValidationError(resolved.reason);
  return {
    normalizedRelativePath: normalizedPath.path,
    absolutePath: resolved.path,
  };
}

function openSftpStream(
  client: Client,
  remotePath: string,
  rangeHeader: string | null,
) {
  return new Promise<{
    stream: import("stream").Readable;
    stat: { size: number };
    range: StorageByteRange;
  }>((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) return reject(statErr);
        if (!stats.isFile())
          return reject(new Error("Target is not a playable file"));
        const range = parseStorageRange(rangeHeader, stats.size);
        if (range instanceof Response)
          return reject(
            Object.assign(new Error("Range Not Satisfiable"), {
              response: range,
            }),
          );
        const stream = sftp.createReadStream(remotePath, {
          start: range.start,
          end: range.end,
        });
        resolve({
          stream: stream as import("stream").Readable,
          stat: { size: stats.size },
          range,
        });
      });
    });
  });
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(
    request,
    {
      permission: "storage:read",
      rateLimit: GENERAL_READ_LIMIT,
      errorMessage: apiCopy("apiCopy.failed.to.read.media.b0e4a112"),
    },
    async ({ session }) => {
      if (!session) throw new AuthError(apiCopy("apiCopy.not.authenticated.76d1efbe"));
      const locale = await getServerLocale();
      const { id } = await params;
      const { download } = parseSearchParams(
        request,
        z.object({
          download: z
            .string()
            .optional()
            .transform((value) => value === "1"),
        }),
      );
      const item = await getMediaItem(id, session ?? undefined, {
        includeCredentials: true,
      });
      if (!item || !item.storageNode)
        return apiError({
          code: "NOT_FOUND",
          message: apiCopy("apiCopy.media.not.found.287cb4d8"),
          status: 404,
        });

      const node = item.storageNode;
      // Normalize once and authorize once — on the NORMALIZED path. The
      // previous flow ran a first ACL on the raw stored path and a second one
      // after normalization, doubling every node/grant lookup per request (and
      // authorizing the pre-normalization path in the first pass).
      const normalizedRelative = normalizeStorageRelativePath(item.relativePath);
      if (!normalizedRelative.ok) {
        return NextResponse.json(
          toClientStorageError(
            apiCopy("apiCopy.requested.path.exceeds.storage.node.root.directory.d786fee2"),
          ),
          { status: 400 },
        );
      }
      const accessDecision = await assertStorageAccess({
        session,
        storageNodeId: node.id,
        relativePath: normalizedRelative.path,
        operation: "read",
      });
      if (!accessDecision.allowed) {
        return apiError({
          code: "FORBIDDEN",
          message: storageAccessDeniedCopy(accessDecision.reason, locale),
          status: 403,
        });
      }

      if (node.driver === "LOCAL") {
        let localPath: string;
        try {
          ({ absolutePath: localPath } = resolveManagedLocalPath(
            node.basePath,
            normalizedRelative.path,
          ));
          const fileStat = await stat(localPath);
          if (!fileStat.isFile())
            return apiError({
              code: "VALIDATION_FAILED",
              message: apiCopy("apiCopy.target.is.not.a.playable.file.a829624f"),
              status: 400,
            });
          const range = parseStorageRange(
            request.headers.get("range"),
            fileStat.size,
          );
          if (range instanceof Response) return range;
          const stream = createReadStream(localPath, {
            start: range.start,
            end: range.end,
          });
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
          return apiError({
            code: "NOT_FOUND",
            message: apiCopy("apiCopy.file.not.found.or.temporarily.cannot.be.read.3cc644d2"),
            status: 404,
          });
        }
      }

      if (node.driver !== "SFTP") {
        return apiError({
          code: "VALIDATION_FAILED",
          message: apiCopy("apiCopy.this.storage.node.does.not.support.media.streaming.48198857"),
          status: 400,
        });
      }

      let normalizedRemotePath: string;
      try {
        normalizedRemotePath = normalizeRemoteTargetPath(
          node.basePath,
          normalizedRelative.path,
        );
      } catch {
        return NextResponse.json(
          toClientStorageError(
            apiCopy("apiCopy.requested.path.exceeds.storage.node.root.directory.d786fee2"),
          ),
          { status: 400 },
        );
      }

      const connectionCredentials = (() => {
        try {
          return resolveStorageSshCredentials(node);
        } catch (error) {
          return error instanceof Error
            ? error
            : new Error(
                "Missing remote host address or connection credentials, cannot connect",
              );
        }
      })();
      if (connectionCredentials instanceof Error) {
        return apiError({
          code: "VALIDATION_FAILED",
          message: connectionCredentials.message,
          status: 400,
        });
      }

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
            contentType: item.mimeType,
            fileName: item.name,
            fileSize: buffer.length,
            download,
          });
        }
        client = await connectSsh({
          host: connectionCredentials.host,
          port: connectionCredentials.port,
          username: connectionCredentials.username,
          privateKey: connectionCredentials.privateKey,
          password: connectionCredentials.password,
          readyTimeout: 15000,
          timeout: 10000,
        });
        const {
          stream,
          stat: remoteStat,
          range,
        } = await openSftpStream(
          client,
          normalizedRemotePath,
          request.headers.get("range"),
        );
        // `nodeStreamToWeb` destroys the Node stream when the browser cancels
        // the response, which lands here — so this is also the disconnect path.
        let idleTimer: NodeJS.Timeout | null = null;
        const releaseClient = () => {
          if (idleTimer) {
            clearTimeout(idleTimer);
            idleTimer = null;
          }
          client?.end();
          client = null;
        };
        const armIdleTimer = () => {
          if (idleTimer) clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            logger.warn("remote media stream stalled, tearing down", {
              id,
              nodeId: node.id,
              idleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
            });
            stream.destroy(
              new Error(
                `SFTP media stream stalled (no data for ${STREAM_IDLE_TIMEOUT_MS / 1000}s)`,
              ),
            );
          }, STREAM_IDLE_TIMEOUT_MS);
        };
        const response = storageStreamResponse({
          stream,
          range,
          contentType: item.mimeType,
          fileName: item.name,
          fileSize: remoteStat.size,
          download,
        });
        // Attach only after the response exists: adding a `data` listener puts
        // the stream into flowing mode, so doing it first would let chunks be
        // emitted before `nodeStreamToWeb` has subscribed and drop them.
        stream.on("data", armIdleTimer);
        stream.on("close", releaseClient);
        stream.on("error", releaseClient);
        armIdleTimer();
        return response;
      } catch (error) {
        client?.end();
        const maybeResponse = (error as { response?: Response }).response;
        if (maybeResponse) return maybeResponse;
        // Typed errors already carry the real reason and status — the agent-only
        // read path throws BusinessError("agent-only reads are limited to 5 MB")
        // at 422, and flattening that into the generic 502 below told the user
        // the node could not be reached when in fact the file was simply too
        // large for that transport. Let withApiRoute render them as-is.
        if (isAppError(error)) throw error;
        logger.error("read remote media stream failed", error, {
          id,
          nodeId: node.id,
        });
        return NextResponse.json(
          toClientStorageError(
            "Failed to fetch remote media, please check if the file exists or the node can be connected",
          ),
          { status: 502 },
        );
      }
    },
  );
}
