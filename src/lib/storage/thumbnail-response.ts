/**
 * Thumbnails for image files on a storage node, shared by the media library
 * (`/api/media/[id]/thumbnail`) and the file browser
 * (`/api/files/[id]/thumbnail`). Callers look the item up and authorize the
 * read; this module caches, reads the source (local disk or SFTP, capped at
 * 32 MiB), resizes it with sharp and answers with a JPEG or a placeholder.
 */
import { apiCopy } from "@/lib/i18n/api-copy";
import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";

import { Client } from "ssh2";
import { NextResponse } from "next/server";

import { connectSsh } from "@/lib/ssh/client";
import { createLogger } from "@/lib/logging";
import { thumbnailCacheRoot } from "@/lib/media/thumbnail-cache";
import { resolveManagedLocalPath } from "@/lib/storage/managed-path";
import {
  normalizeRemoteTargetPath,
  toClientStorageError,
} from "@/lib/storage/remote-path";
import { ValidationError } from "@/lib/errors";
import { assertRemotePathContained } from "@/lib/storage/remote-containment";
import {
  resolveStorageSshCredentials,
  type StorageSshCredentialNode,
} from "@/lib/storage/ssh-credentials";
import { apiError } from "@/lib/http/api-error";
import { getErrorMessage } from "@/lib/http/error-message";

const logger = createLogger("storage:thumbnail");

// Per-storage-node circuit breaker: when an SFTP node has timed out N times in
// a short window, short-circuit subsequent thumbnail requests so a dead remote
// host can't take the whole gallery hostage. The breaker resets on its own
// after `BREAKER_COOLDOWN_MS`, so when the host comes back, thumbnails resume.
const BREAKER_FAILURE_THRESHOLD = 1;
const BREAKER_COOLDOWN_MS = 120_000;
type BreakerState = { failures: number; openedAt: number };
const nodeBreaker = new Map<string, BreakerState>();
const thumbnailGenerationInFlight = new Map<
  string,
  Promise<Buffer | NextResponse>
>();

function isBreakerOpen(nodeId: string): boolean {
  const state = nodeBreaker.get(nodeId);
  if (!state) return false;
  if (state.failures < BREAKER_FAILURE_THRESHOLD) return false;
  if (Date.now() - state.openedAt > BREAKER_COOLDOWN_MS) {
    nodeBreaker.delete(nodeId);
    return false;
  }
  return true;
}

function noteBreakerFailure(nodeId: string) {
  const state = nodeBreaker.get(nodeId) ?? { failures: 0, openedAt: 0 };
  state.failures += 1;
  if (state.failures >= BREAKER_FAILURE_THRESHOLD && state.openedAt === 0) {
    state.openedAt = Date.now();
  }
  nodeBreaker.set(nodeId, state);
}

function noteBreakerSuccess(nodeId: string) {
  if (nodeBreaker.has(nodeId)) nodeBreaker.delete(nodeId);
}

// Inline SVG placeholder rendered as PNG-ish data so <Image> can show a
// graceful tile when a remote node is down. Using an SVG keeps the response
// tiny (<1 KB) and avoids a sharp call when we already know we can't reach
// the source.
function placeholderResponse(
  kind: "offline" | "unsupported" = "offline",
): NextResponse {
  const palette =
    kind === "offline"
      ? {
          bg: "#1e293b",
          fg: "#64748b",
          icon: "📡",
          label: "Temporarily unavailable",
        }
      : { bg: "#1e293b", fg: "#64748b", icon: "📄", label: "No preview" };
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 320" width="320" height="320">
	<rect width="320" height="320" fill="${palette.bg}"/>
	<text x="160" y="160" font-size="64" text-anchor="middle" dominant-baseline="central">${palette.icon}</text>
	<text x="160" y="230" font-size="20" fill="${palette.fg}" text-anchor="middle" font-family="sans-serif">${palette.label}</text>
</svg>`;
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // `private` for the same reason the real thumbnail responses below are:
      // this is an authenticated per-media URL, and a shared cache holding a
      // `public` entry for it would answer other viewers from it. It also keeps
      // a transient node outage from being pinned for everyone — `max-age=60`
      // on a failure state meant one blip cached a broken tile for a minute.
      // 10s is enough to absorb a burst of tiles in one gallery render.
      "Cache-Control": "private, max-age=10",
      "X-Thumbnail-Placeholder": kind,
    },
  });
}

const THUMB_SIZE = 320;
// We deliberately skip video frame extraction here: extracting a still frame
// requires shipping ffmpeg into the runtime image. For the v1 thumbnail layer
// we only optimize image media, where the win is largest (galleries with many
// large originals). Video tiles fall back to a generic poster on the client.

function thumbnailKey(input: {
  id: string;
  size: number;
  updatedAt: string | Date | null | undefined;
  relativePath: string;
}): string {
  const updated = input.updatedAt
    ? typeof input.updatedAt === "string"
      ? input.updatedAt
      : input.updatedAt.toISOString()
    : "";
  const hash = createHash("sha1")
    .update(`${input.id}|${input.size}|${updated}|${input.relativePath}`)
    .digest("hex");
  return `${hash}.jpg`;
}

/** A whole JPEG: starts with SOI (FF D8) and ends with EOI (FF D9). */
function isCompleteJpeg(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
}

async function getCachedThumbnail(filePath: string): Promise<Buffer | null> {
  try {
    const info = await stat(filePath);
    if (!info.isFile() || info.size === 0) return null;
    const cached = await readFile(filePath);
    // Writes are atomic now, but a cache file cut short by an earlier version
    // (disk full) would otherwise be served as a hit until it aged out.
    if (!isCompleteJpeg(cached)) {
      await rm(filePath, { force: true }).catch(() => undefined);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

async function generateThumbnailFromBuffer(buffer: Buffer): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp(buffer, { failOn: "none" })
    .rotate()
    .resize({
      width: THUMB_SIZE,
      height: THUMB_SIZE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 78, progressive: true, mozjpeg: false })
    .toBuffer();
}

function runSingleFlight<T>(
  map: Map<string, Promise<T>>,
  key: string,
  task: () => Promise<T>,
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = task().finally(() => {
    map.delete(key);
  });
  map.set(key, promise);
  return promise;
}

function readLocalIntoBuffer(
  absolutePath: string,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    const stream = createReadStream(absolutePath);
    stream.on("data", (chunk: string | Buffer) => {
      const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      total += buf.length;
      if (total > maxBytes) {
        stream.destroy(new Error("THUMBNAIL_SOURCE_TOO_LARGE"));
        return;
      }
      chunks.push(buf);
    });
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", (err) => reject(err));
  });
}

function readRemoteIntoBuffer(
  client: Client,
  remotePath: string,
  maxBytes: number,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) return reject(err);
      sftp.stat(remotePath, (statErr, stats) => {
        if (statErr) return reject(statErr);
        if (!stats.isFile())
          return reject(new Error("Target is not a readable file"));
        if (stats.size > maxBytes) {
          return reject(new Error("THUMBNAIL_SOURCE_TOO_LARGE"));
        }
        // Cap while streaming too — stat can be stale/wrong if the remote
        // grows between stat and read (or lies about size).
        const stream = sftp.createReadStream(remotePath);
        const chunks: Buffer[] = [];
        let total = 0;
        stream.on("data", (chunk: Buffer) => {
          total += chunk.length;
          if (total > maxBytes) {
            stream.destroy(new Error("THUMBNAIL_SOURCE_TOO_LARGE"));
            return;
          }
          chunks.push(chunk);
        });
        stream.on("end", () => resolve(Buffer.concat(chunks)));
        stream.on("error", (e: Error) => reject(e));
      });
    });
  });
}


/** The storage node fields a thumbnail read needs (see mediaStreamItemSelect). */
export type ThumbnailSourceNode = StorageSshCredentialNode & {
  id: string;
  driver: string;
  basePath: string;
};

/**
 * Serve the thumbnail of an image the caller has already found and
 * authorized. `relativePath` must be normalized; `id` and `updatedAt` key the
 * cache, so an edited or replaced file gets a fresh thumbnail.
 */
export async function respondWithStorageThumbnail(input: {
  id: string;
  updatedAt?: Date | string | null;
  relativePath: string;
  node: ThumbnailSourceNode;
  /**
   * false: answer an unreachable or unsupported source with 503 instead of
   * the placeholder tile, so the caller's <img> can fall back to its own icon.
   */
  placeholder?: boolean;
}): Promise<NextResponse> {
  const unavailable = (kind: "offline" | "unsupported") =>
    input.placeholder === false
      ? apiError({ code: "INTERNAL_ERROR", message: apiCopy("apiCopy.failed.to.generate.thumbnail.06deb9b6"), status: 503 })
      : placeholderResponse(kind);
  const cacheRoot = thumbnailCacheRoot();
  const cacheFile = path.join(
    cacheRoot,
    thumbnailKey({
      id: input.id,
      size: THUMB_SIZE,
      updatedAt: input.updatedAt ?? null,
      relativePath: input.relativePath,
    }),
  );

  const cached = await getCachedThumbnail(cacheFile);
  if (cached) {
    return new NextResponse(new Uint8Array(cached), {
      headers: {
        "Content-Type": "image/jpeg",
        "Content-Length": String(cached.length),
        "Cache-Control": "private, max-age=3600",
        "X-Thumbnail-Cache": "hit",
      },
    });
  }

  const { node } = input;
  const id = input.id;
  // Thumbnail input is always small enough to buffer; cap source reads at 32MB
  // to avoid pulling 4GB videos into memory if the client somehow asks for a
  // /thumbnail of a non-image (defense-in-depth — we already guarded by mime).
  const MAX_SOURCE_BYTES = 32 * 1024 * 1024;

  let sourceBuffer!: Buffer;
  const generate = async () => {
    // The breaker is about node reachability, so only a failure to connect
    // may trip it. Once the handshake succeeds the host is demonstrably
    // alive and a per-file error (missing file, not a regular file, a read
    // that blows the size cap) must not blank out every other tile on that
    // node for the whole cooldown.
    let sftpConnected = false;
    try {
      if (node.driver === "LOCAL") {
        const absolutePath = resolveManagedLocalPath(
          node.basePath,
          input.relativePath,
        ).absolutePath;
        sourceBuffer = await readLocalIntoBuffer(
          absolutePath,
          MAX_SOURCE_BYTES,
        );
      } else if (node.driver === "SFTP") {
        if (isBreakerOpen(node.id)) {
          return unavailable("offline");
        }
        let normalizedRemotePath: string;
        try {
          normalizedRemotePath = normalizeRemoteTargetPath(
            node.basePath,
            input.relativePath,
          );
        } catch {
          return NextResponse.json(
            toClientStorageError(
              apiCopy("apiCopy.requested.path.exceeds.storage.node.root.directory.d786fee2"),
            ),
            { status: 400 },
          );
        }
        const credentials = (() => {
          try {
            return resolveStorageSshCredentials(node);
          } catch (e) {
            return e instanceof Error
              ? e
              : new Error(
                  "Missing remote host address or connection credentials",
                );
          }
        })();
        if (credentials instanceof Error) {
          return apiError({
            code: "VALIDATION_FAILED",
            message: credentials.message,
            status: 400,
          });
        }
        try {
          normalizedRemotePath = await assertRemotePathContained(credentials, node.basePath, normalizedRemotePath);
        } catch (error) {
          if (error instanceof ValidationError) {
            return NextResponse.json(toClientStorageError(error.message), { status: 400 });
          }
          throw error;
        }
        const client = await connectSsh({
          host: credentials.host,
          port: credentials.port,
          username: credentials.username,
          hostKeySha256: credentials.hostKeySha256,
          // Fail closed on unpinned SFTP nodes, matching the terminal and
          // command channels — this path sends the stored credential.
          enforceHostKeyPin: true,
          agentServerId: credentials.agentServerId,
          privateKey: credentials.privateKey,
          passphrase: credentials.passphrase,
          password: credentials.password,
          readyTimeout: 5000,
          timeout: 5000,
        });
        sftpConnected = true;
        noteBreakerSuccess(node.id);
        try {
          sourceBuffer = await readRemoteIntoBuffer(
            client,
            normalizedRemotePath,
            MAX_SOURCE_BYTES,
          );
        } finally {
          client.end();
        }
      } else {
        return unavailable("unsupported");
      }
    } catch (error) {
      const message = getErrorMessage(error, "Unknown error");
      if (message === "THUMBNAIL_SOURCE_TOO_LARGE") {
        return apiError({
          code: "REQUEST_ENTITY_TOO_LARGE",
          message: apiCopy("apiCopy.original.image.is.too.large.cannot.generate.thumbnail.3728da55"),
          status: 413,
        });
      }
      // Only an unreachable node trips the circuit breaker — the next
      // gallery render won't try it again until the cooldown elapses.
      if (node.driver === "SFTP" && !sftpConnected) {
        noteBreakerFailure(node.id);
      }
      logger.error("thumbnail read source failed", error, {
        id,
        nodeId: node.id,
      });
      // Return a tiny inline placeholder image instead of an error so the
      // gallery shows a graceful "unavailable" tile instead of broken-image
      // icons or hung requests.
      return unavailable("offline");
    }

    let thumbnail: Buffer;
    try {
      thumbnail = await generateThumbnailFromBuffer(sourceBuffer);
    } catch (error) {
      logger.error("thumbnail generate failed", error, { id });
      throw new Error("THUMBNAIL_GENERATION_FAILED");
    }

    // Write aside, then rename into place: a partial write (disk full)
    // straight into the cache name was served as a "hit" from then on.
    const partial = `${cacheFile}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      await mkdir(cacheRoot, { recursive: true });
      await writeFile(partial, thumbnail);
      await rename(partial, cacheFile);
    } catch (error) {
      await rm(partial, { force: true }).catch(() => undefined);
      logger.warn("thumbnail cache write failed", {
        error,
        id,
        cacheFile,
      });
    }
    return thumbnail;
  };

  let thumbnail: Buffer;
  try {
    const result = await runSingleFlight(
      thumbnailGenerationInFlight,
      cacheFile,
      generate,
    );
    // Concurrent requests for one file share this result. A response body can
    // be read once: handing the same placeholder to every caller left all
    // but the first with "Body has already been read". Each gets a copy.
    if (result instanceof NextResponse) return new NextResponse(result.clone().body, { status: result.status, headers: result.headers });
    thumbnail = result;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message === "THUMBNAIL_GENERATION_FAILED"
    ) {
      return apiError({
        code: "INTERNAL_ERROR",
        message: apiCopy("apiCopy.failed.to.generate.thumbnail.06deb9b6"),
        status: 500,
      });
    }
    throw error;
  }

  return new NextResponse(new Uint8Array(thumbnail), {
    headers: {
      "Content-Type": "image/jpeg",
      "Content-Length": String(thumbnail.length),
      "Cache-Control": "private, max-age=3600",
      "X-Thumbnail-Cache": "miss",
    },
  });
}
