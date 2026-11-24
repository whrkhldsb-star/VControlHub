import { Prisma } from "@prisma/client";
/**
 * WebDAV storage adapter over VControlHub FileEntry + LOCAL/SFTP backends.
 *
 * URL shape (served by route handlers):
 *   /api/webdav/{storageNodeId}/[...path]
 *
 * Supported methods: OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY
 * Auth: Bearer API token or Basic (password = API token) with storage scopes.
 */
import { openRepresentation, putConditionsPass } from "./representation";
import { copyVersion, rollbackPublishedCopy } from "@/lib/storage/copy-rollback";
import { moveMeasurement } from "@/lib/storage/move-capacity";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { lockStorageFileOverwrite } from "@/lib/storage/file-overwrite-lock";
import { hasCaseInsensitiveLocalPaths, isWindowsStorageBasePath } from "@/lib/storage/path-utils";
import { createWebDavClient, WebDavHttpError } from "@/lib/storage/webdav-client";
import { WEBDAV_STAGE_PREFIX } from "@/lib/storage/staging-paths";
import { writeFileIndex } from "@/lib/storage/file-write-index";
import { validateStorageFileIndex } from "@/lib/storage/schema";
import { createLogger } from "@/lib/logging";
import { config } from "@/lib/config/env";
import {
  BusinessError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import { assertCanonicalWritePath, assertNotRecycled } from "@/lib/storage/archive-access";
import { releaseStorageQuotaGuard } from "@/lib/storage/access-control";

const webdavLogger = createLogger("webdav:handler");
import {
  deleteBackingObject,
  moveBackingObject,
  renameBackingObject,
  statBackingObject,
} from "@/lib/storage/fs-backend";
import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  copyStorageFile,
  writeStorageFileFromLocalPath,
} from "@/lib/storage/file-content";
import { readStorageUploadMaxBytes } from "@/lib/upload/limits";
import { assertUploadDiskReserve, MediaUploadError } from "@/lib/upload/service";
import { uploadTmpDir } from "@/lib/runtime/work-dirs";
import { WEBDAV_PUT_STAGING_PREFIX } from "@/lib/upload/staging";
import {
  createFileEntry,
} from "@/lib/storage/service-entries";
import { purgeFileEntryVersionDirectories, snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import { guessContentType } from "@/lib/http/mime-types";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { RequestBodyTooLargeError } from "@/lib/http/request-body";
import { parseStorageRange } from "@/lib/storage/streaming";

import { buildPropFindMultistatus, parseDepth, type PropFindItem } from "./xml";
import { t } from "@/lib/i18n/service-translations";
import {
  MAX_PROPFIND_CHILDREN,
  buildWebDavHref,
  ensureDirectoryIndexAndBacking,
  entryName,
  escapeLikePrefix,
  findEntry,
  listDirectChildren,
  loadNode,
  normalizeWebDavRelativePath,
  parentRelativePath,
  requireAccess,
  toPropFindItem,
  type WebDavContext,
} from "./handler-internals";
import { moveSharePaths } from "@/lib/share-link/follow-path";

export { normalizeWebDavRelativePath, type WebDavContext } from "./handler-internals";

export const WEBDAV_ALLOW_HEADER = "OPTIONS, PROPFIND, PROPPATCH, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY";
/** What a resource that already exists allows: everything but MKCOL. */
const WEBDAV_ALLOW_HEADER_FOR_MAPPED_URL = WEBDAV_ALLOW_HEADER.replace("MKCOL, ", "");

export async function handleWebDavOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: WEBDAV_ALLOW_HEADER,
      DAV: "1",
      "MS-Author-Via": "DAV",
      "Accept-Ranges": "bytes",
    },
  });
}

/** PROPPATCH: dead properties are not stored; verify write access and target existence before reporting 207. */
export async function handleWebDavPropPatch(ctx: WebDavContext): Promise<Response> {
  await requireAccess(ctx.session, ctx.storageNodeId, ctx.relativePath, "write");
  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const caseInsensitive = isCaseInsensitiveNode(node);
  await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "write", node.driver, caseInsensitive);
  if (ctx.relativePath) {
    const entry = await findEntry(ctx.storageNodeId, ctx.relativePath, caseInsensitive);
    if (!entry) return new Response("Not Found", { status: 404 });
  }
  const href = buildWebDavHref(ctx.storageNodeId, ctx.relativePath, false).replace(/&/g, "&amp;").replace(/</g, "&lt;");
  const body = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:"><D:response><D:href>${href}</D:href><D:propstat><D:prop/><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response></D:multistatus>`;
  return new Response(body, { status: 207, headers: { "Content-Type": "application/xml; charset=utf-8" } });
}
export async function handleWebDavPropFind(
  ctx: WebDavContext,
  depthHeader: string | null,
): Promise<Response> {
  const depth = parseDepth(depthHeader);
  if (depth === "infinity") {
    return new Response("Depth: infinity is not supported", { status: 403 });
  }

  await requireAccess(ctx.session, ctx.storageNodeId, ctx.relativePath, "read");
  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const caseInsensitive = isCaseInsensitiveNode(node);
  await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "read", node.driver, caseInsensitive);
  const items: PropFindItem[] = [];
  let listParent: string | null = null;

  if (!ctx.relativePath) {
    items.push({
      href: buildWebDavHref(ctx.storageNodeId, "", true),
      displayName: node.name,
      isCollection: true,
      lastModified: new Date(),
    });
    if (depth === 1) listParent = "";
  } else {
    const entry = await findEntry(ctx.storageNodeId, ctx.relativePath, caseInsensitive);
    if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
    const item = toPropFindItem(ctx.storageNodeId, entry);
    if (entry.entryType === "FILE") {
      const opened = await openRepresentation(node, ctx.relativePath);
      try {
        item.etag = opened.etag;
        item.contentLength = opened.size;
        item.lastModified = opened.lastModified;
      } finally { await opened.close(); }
    }
    items.push(item);
    if (depth === 1 && entry.entryType === "DIRECTORY") {
      listParent = entry.relativePath;
    }
  }

  if (listParent !== null) {
    const children = await listDirectChildren(ctx.storageNodeId, listParent, MAX_PROPFIND_CHILDREN, caseInsensitive);
    if (children.truncated) {
      // A silently short multistatus is worse than an error: sync clients read a
      // missing entry as a remote deletion.
      return new Response(
        t("backend.webdav.collectionTooLargeToList", {
          limit: String(MAX_PROPFIND_CHILDREN),
        }),
        { status: 507, headers: { "Content-Type": "text/plain; charset=utf-8" } },
      );
    }
    for (const child of children.rows) {
      items.push(toPropFindItem(ctx.storageNodeId, child));
    }
  }

  const xml = buildPropFindMultistatus(items);
  return new Response(xml, {
    status: 207,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      DAV: "1",
    },
  });
}

export async function handleWebDavGetHead(
  ctx: WebDavContext,
  method: "GET" | "HEAD",
): Promise<Response> {
  await requireAccess(ctx.session, ctx.storageNodeId, ctx.relativePath, "read");
  if (!ctx.relativePath) {
    await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "read");
    return new Response("WebDAV collection root", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const caseInsensitive = isCaseInsensitiveNode(node);
  await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "read", node.driver, caseInsensitive);
  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath, caseInsensitive);
  if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
  if (entry.entryType === "DIRECTORY") {
    return new Response("Collection", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const contentType =
    entry.mimeType ||
    guessContentType(entry.name) ||
    "application/octet-stream";
  const read = () => serveFileRepresentation(node, ctx, method, contentType);
  try {
    return await read();
  } catch (error) {
    // A pinned upstream GET can lose its version between stat and opening the stream.
    // No response headers have been sent. Recalculate the range once using the new revision.
    if (!(error instanceof ConflictError || (error instanceof WebDavHttpError && (error.status === 412 || error.status === 416)))) throw error;
    await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "read", node.driver);
    return read();
  }
}

async function serveFileRepresentation(
  node: Awaited<ReturnType<typeof loadNode>>, ctx: WebDavContext, method: "GET" | "HEAD", contentType: string,
) {
  const opened = await openRepresentation(node, ctx.relativePath);
  let handedOff = false;
  try {
    const fileSize = opened.size;
    const validator = ctx.ifRange?.trim();
    const rangeMatches = ctx.ifRange == null || validator === opened.etag ||
      (opened.lastModified !== undefined && validator === opened.lastModified.toUTCString());
    const range = parseStorageRange(rangeMatches ? ctx.rangeHeader ?? null : null, fileSize);
    if (range instanceof Response) return range;
    const headers: Record<string, string> = {
      "Content-Type": contentType,
      "Content-Length": String(fileSize === 0 ? 0 : range.end - range.start + 1),
      "Accept-Ranges": "bytes",
      // The type comes from whoever uploaded the file. Opened in a browser that
      // holds cached Basic credentials for this origin, an uploaded HTML or SVG
      // would run with the application's cookies: never sniff, never script
      // (same as every other file response, see buildStorageStreamHeaders).
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    };
    headers.ETag = opened.etag;
    if (opened.lastModified) headers["Last-Modified"] = opened.lastModified.toUTCString();

    if (range.status === 206) headers["Content-Range"] = `bytes ${range.start}-${range.end}/${fileSize}`;
    if (method === "HEAD") return new Response(null, { status: range.status, headers });
    const stream = await opened.stream(range.status === 206 ? { start: range.start, end: range.end } : undefined);
    const response = new Response(nodeStreamToWeb(stream), { status: range.status, headers });
    stream.once("close", () => { void opened.close().catch(error => webdavLogger.warn("WebDAV read cleanup failed", { error })); });
    handedOff = true;
    return response;
  } finally { if (!handedOff) await opened.close(); }
}

export async function handleWebDavPut(
  ctx: WebDavContext,
  request: Request,
): Promise<Response> {
  if (!ctx.relativePath) {
    throw new ValidationError(t("backend.webdav.cannotPutToCollectionRoot"));
  }
  // The body streams to a temp file (A4-16): buffering it capped PUT at 100 MiB
  // and cost that much memory per concurrent upload. The limit is the storage
  // upload setting, the same as every other upload path.
  const maxBytes = await readStorageUploadMaxBytes();
  const temporaryPath = path.join(uploadTmpDir(), `${WEBDAV_PUT_STAGING_PREFIX}${randomUUID()}.tmp`);
  let size = 0;
  const tooLarge = () => new Response(
    t("backend.storageHardening.webdav.payloadTooLarge", { max: `${Math.round(maxBytes / (1024 * 1024))}MB` }),
    { status: 413 },
  );
  const declaredHeader = request.headers.get("content-length")?.trim() ?? "";
  // Absent for a chunked upload (Finder), which has no length to compare with.
  const declared = /^\d+$/.test(declaredHeader) ? Number(declaredHeader) : null;
  const metadata = {
    storageNodeId: ctx.storageNodeId,
    relativePath: ctx.relativePath,
    mimeType: request.headers.get("content-type") || guessContentType(entryName(ctx.relativePath)),
  };
  const DISK_RESERVE_CHECK_INTERVAL_BYTES = 16 * 1024 * 1024;
  try {
    if (declared !== null && declared > maxBytes) throw new RequestBodyTooLargeError(maxBytes);
    validateStorageFileIndex({ ...metadata, size: declared ?? 0 });
    // Fail fast on missing/foreign-tenant nodes, denied write grants/quotas, and low hub disk space
    // before opening a staging file in uploadTmpDir().
    await loadNode(ctx.storageNodeId, ctx.session);
    const preflightAccess = await requireAccess(
      ctx.session,
      ctx.storageNodeId,
      ctx.relativePath,
      "write",
      declared ?? 0,
    );
    await releaseStorageQuotaGuard(preflightAccess);
    await assertUploadDiskReserve(declared ?? 0);
    await mkdir(uploadTmpDir(), { recursive: true, mode: 0o700 });
    let nextReserveCheck = DISK_RESERVE_CHECK_INTERVAL_BYTES;
    const guard = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        size += chunk.length;
        if (size > maxBytes) {
          callback(new RequestBodyTooLargeError(maxBytes));
          return;
        }
        if (declared === null && size >= nextReserveCheck) {
          nextReserveCheck += DISK_RESERVE_CHECK_INTERVAL_BYTES;
          void assertUploadDiskReserve(0).then(
            () => callback(null, chunk),
            (error) => callback(error instanceof Error ? error : new Error(String(error))),
          );
          return;
        }
        callback(null, chunk);
      },
    });
    const source = request.body
      ? Readable.fromWeb(request.body as import("node:stream/web").ReadableStream<Uint8Array>)
      : Readable.from([]);
    await pipeline(source, guard, createWriteStream(temporaryPath, { flags: "wx", mode: 0o600 }));
    // A body that ended early is not the file: storing it and answering 201
    // told the client its upload was complete. This happened to every PUT over
    // 10 MB while the proxy ran on this route (Next passed on only the first
    // megabytes of the body, and ended the stream cleanly), and anything else
    // that shortens a body on the way here must fail the same way.
    if (declared !== null && size !== declared) {
      throw new ValidationError(t("backend.webdav.incompleteRequestBody", { received: String(size), declared: String(declared) }));
    }
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    if (error instanceof RequestBodyTooLargeError) return tooLarge();
    if (error instanceof MediaUploadError && error.code === "insufficient_storage") {
      return new Response(error.message, {
        status: 507,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
    throw error;
  }

  let putAccess: Awaited<ReturnType<typeof requireAccess>> | undefined;
  let releaseOverwrite: (() => Promise<void>) | undefined;
  try {
    putAccess = await requireAccess(
      ctx.session,
      ctx.storageNodeId,
      ctx.relativePath,
      "write",
      size,
    );
    releaseOverwrite = await lockStorageFileOverwrite(ctx.storageNodeId, ctx.relativePath);
    const node = await loadNode(ctx.storageNodeId, ctx.session);
    const caseInsensitive = isCaseInsensitiveNode(node);
    await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "write", node.driver, caseInsensitive);
    await assertCanonicalWritePath(ctx.storageNodeId, ctx.relativePath, node.driver, caseInsensitive);
    const existing = await findEntry(ctx.storageNodeId, ctx.relativePath, caseInsensitive);
    const physical = await statBackingObject({ storageNode: node, relativePath: ctx.relativePath });
    const match = request.headers.get("if-match"), none = request.headers.get("if-none-match");
    const conditional = match !== null || none !== null;
    let expectedVersion: string | null | undefined;
    if (conditional) {
      const current = physical && !physical.isDirectory ? await openRepresentation(node, ctx.relativePath) : null;
      try {
        if (!putConditionsPass(request.headers, Boolean(physical), current?.etag ?? null)) return new Response(null, { status: 412 });
        if (physical && node.driver === "WEBDAV" && !current?.backingVersion) return new Response(null, { status: 412 });
        expectedVersion = physical ? current?.backingVersion : null;
        if (physical && node.driver === "SFTP") expectedVersion = [physical.size, physical.lastModifiedMs].join(":");
      } finally { await current?.close(); }
    }
    if (existing?.entryType === "DIRECTORY" || physical?.isDirectory) {
      throw new ConflictError(
        t("backend.webdav.cannotOverwriteACollectionWithAFile"),
      );
    }

    const payload = validateStorageFileIndex({ ...metadata, size });

    const parentPath = parentRelativePath(ctx.relativePath);
    if (parentPath) {
      await ensureDirectoryIndexAndBacking({
        session: ctx.session,
        node,
        storageNodeId: ctx.storageNodeId,
        relativePath: parentPath,
      });
    }

    if (existing) {
      await snapshotFileVersionBeforeOverwrite({
        fileEntryId: existing.id,
        userId: ctx.session.userId,
        reason: "UPLOAD",
        note: "WebDAV PUT overwrite",
      }).catch(() => undefined);
    }

    const rollbackIndex = await writeFileIndex(payload, existing);
    let created = !physical;
    try {
      await writeStorageFileFromLocalPath(node, ctx.relativePath, temporaryPath, {
        expectedVersion, onPublished: value => { created = value; },
      });
    } catch (error) {
      await rollbackIndex().catch(rollbackError =>
        webdavLogger.error("WebDAV PUT index rollback failed", { error, rollbackError, relativePath: ctx.relativePath }));
      if (conditional && (error instanceof ConflictError || (error instanceof WebDavHttpError && error.status === 412))) return new Response(null, { status: 412 });
      throw error;
    }

    return new Response(null, {
      status: created ? 201 : 204,
      headers: {
        Location: buildWebDavHref(ctx.storageNodeId, ctx.relativePath, false),
      },
    });
  } finally {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    await releaseOverwrite?.();
    if (putAccess) await releaseStorageQuotaGuard(putAccess);
  }
}

export async function handleWebDavMkcol(ctx: WebDavContext): Promise<Response> {
  if (!ctx.relativePath) {
    throw new ValidationError(t("backend.webdav.cannotMkcolAtRoot"));
  }
  await requireAccess(
    ctx.session,
    ctx.storageNodeId,
    ctx.relativePath,
    "write",
  );
  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const caseInsensitive = isCaseInsensitiveNode(node);
  await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "write", node.driver, caseInsensitive);
  const existing = await findEntry(ctx.storageNodeId, ctx.relativePath, caseInsensitive);
  if (existing) {
    // RFC 4918 §9.3.1: MKCOL on a mapped URL is 405. A 409 means "an
    // intermediate collection is missing", and clients act on the difference:
    // a sync client that creates its folders on every run (Joplin, rclone
    // mkdir) takes 405 as "already there" and 409 as a failure.
    return new Response(t("backend.webdav.resourceAlreadyExists"), {
      status: 405,
      headers: { Allow: WEBDAV_ALLOW_HEADER_FOR_MAPPED_URL, "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  await ensureDirectoryIndexAndBacking({
    session: ctx.session,
    node,
    storageNodeId: ctx.storageNodeId,
    relativePath: ctx.relativePath,
  });

  return new Response(null, {
    status: 201,
    headers: {
      Location: buildWebDavHref(ctx.storageNodeId, ctx.relativePath, true),
    },
  });
}

export async function handleWebDavDelete(
  ctx: WebDavContext, headers = new Headers(),
): Promise<Response> {
  if (!ctx.relativePath) {
    throw new ValidationError(t("backend.webdav.cannotDeleteCollectionRoot"));
  }
  await requireAccess(
    ctx.session,
    ctx.storageNodeId,
    ctx.relativePath,
    "delete",
  );
  const release = await lockStorageFileOverwrite(ctx.storageNodeId, ctx.relativePath);
  try {
    return await deleteLockedWebDavEntry(ctx, headers);
  } finally {
    await release();
  }
}

async function deleteLockedWebDavEntry(ctx: WebDavContext, headers: Headers): Promise<Response> {
  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const caseInsensitive = isCaseInsensitiveNode(node);
  await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "write", node.driver, caseInsensitive);
  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath, caseInsensitive);
  const conditional = headers.has("if-match") || headers.has("if-none-match");
  let expected: string | undefined;
  if (conditional) {
    const physical = await statBackingObject({ storageNode: node, relativePath: ctx.relativePath });
    const opened = physical && !physical.isDirectory ? await openRepresentation(node, ctx.relativePath) : null;
    try {
      if (!putConditionsPass(headers, Boolean(physical), opened?.etag ?? null)) return new Response(null, { status: 412 });
      if (!physical) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
      expected = opened?.backingVersion ?? opened?.etag;
      if (opened && node.driver === "WEBDAV" && !opened.backingVersion) return new Response(null, { status: 412 });
    } finally { await opened?.close(); }
  }
  if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));

  const destParent = parentRelativePath(entry.relativePath);
  const stagedPath = `${destParent ? `${destParent}/` : ""}${WEBDAV_STAGE_PREFIX}delete-${randomUUID()}.staged`;

  const withVersions = await versionOwnersAt(ctx.storageNodeId, entry.relativePath, undefined, caseInsensitive);

  // Stage the whole tree away from the live path first so a later index failure
  // can restore the original bytes instead of leaving unindexed orphans.
  if (node.driver === "WEBDAV" && expected) {
    try { await createWebDavClient(node).rename(entry.relativePath, stagedPath, false, undefined, expected); }
    catch (error) {
      if (error instanceof WebDavHttpError && error.status === 412) return new Response(null, { status: 412 });
      throw error;
    }
  } else {
    await renameBackingObject({ storageNode: node, oldRelativePath: entry.relativePath, newRelativePath: stagedPath });
  }

  // WebDAV DELETE is permanent, as clients present it ("permanently delete"),
  // and its bytes are removed below. Its rows used to go to the recycle bin
  // with a batch id, where they could never be restored (the bytes were gone)
  // — and a folder's earlier recycle-bin files lost their bytes too. Like the
  // file manager's permanent delete, the subtree's rows (recycle-bin ones
  // included) and their version history go with it.
  try {
    // Verify the object actually staged. A rename preserves the local inode and SFTP snapshot bytes.
    if (expected && node.driver !== "WEBDAV") {
      const staged = await openRepresentation(node, stagedPath);
      try {
        if ((staged.backingVersion ?? staged.etag) !== expected) throw new BusinessError(apiCopy("apiCopy.files.op.changed"), undefined, 412);
      } finally { await staged.close(); }
    }
    await prisma.$transaction(async (tx) => {
      const where = { storageNodeId: ctx.storageNodeId, relativePath: entry.relativePath, isDeleted: false,
        id: entry.id, updatedAt: entry.updatedAt };
      const { count } = await tx.fileEntry.deleteMany({ where });
      if (count !== 1) throw new ConflictError(apiCopy("apiCopy.files.op.changed"));
      if (entry.entryType === "DIRECTORY") {
        await tx.fileEntry.deleteMany({
          where: {
            storageNodeId: ctx.storageNodeId,
            relativePath: { startsWith: escapeLikeLiteral(`${entry.relativePath}/`), ...(caseInsensitive ? { mode: "insensitive" as const } : {}) },
          },
        });
      }
      await revokeSharesAt(tx, ctx.storageNodeId, entry.relativePath, caseInsensitive);
    });
  } catch (databaseError) {
    try {
      if (await statBackingObject({ storageNode: node, relativePath: entry.relativePath })) {
        throw new ConflictError(apiCopy("apiCopy.files.op.changed"));
      }
      await moveBackingObject({ storageNode: node, oldRelativePath: stagedPath, newRelativePath: entry.relativePath });
    } catch (rollbackError) {
      webdavLogger.error("WebDAV DELETE rollback failed", { databaseError, rollbackError, stagedPath });
    }
    throw databaseError;
  }

  await deleteBackingObject({
    storageNode: node,
    relativePath: stagedPath,
    isDirectory: entry.entryType === "DIRECTORY",
    tolerateMissing: true,
  }).catch((error) => {
    webdavLogger.warn("WebDAV DELETE staged cleanup failed", {
      stagedPath,
      error,
    });
  });
  // Only once the rows are gone: a failed transaction above put the bytes back
  // and must find their history intact.
  await purgeFileEntryVersionDirectories(ctx.storageNodeId, withVersions);

  return new Response(null, { status: 204 });
}

function destinationRelativePath(
  storageNodeId: string,
  destinationHeader: string | null,
  requestUrl: URL,
): string {
  if (!destinationHeader)
    throw new ValidationError(t("backend.webdav.destinationHeaderRequired"));
  let destUrl: URL;
  try {
    destUrl = new URL(destinationHeader, requestUrl.origin);
  } catch {
    throw new ValidationError(t("backend.webdav.invalidDestinationHeader"));
  }
  // Next/proxies can expose an internal origin here. Only the explicitly
  // configured public site is an additional trusted origin, never forwarded headers.
  let publicOrigin: string | undefined;
  const publicBaseUrl = config.app.baseUrl;
  if (publicBaseUrl) {
    try {
      const publicUrl = new URL(publicBaseUrl);
      if (["http:", "https:"].includes(publicUrl.protocol)) publicOrigin = publicUrl.origin;
    } catch { /* Invalid optional configuration must not broaden accepted origins. */ }
  }
  if (destUrl.origin !== requestUrl.origin && destUrl.origin !== publicOrigin) {
    throw new ValidationError(
      t("backend.webdav.destinationMustStayOnTheSameOrigin"),
    );
  }
  // Require a path boundary after the node id so nodeId "abc" cannot match
  // "/api/webdav/abc-evil/..." (prefix IDOR across storage nodes).
  const base = `/api/webdav/${encodeURIComponent(storageNodeId)}`;
  // Also accept unencoded id segment (route params are raw ids).
  const baseRaw = `/api/webdav/${storageNodeId}`;
  const pathName = destUrl.pathname;
  const matchesBase = (b: string) =>
    pathName === b || pathName === `${b}/` || pathName.startsWith(`${b}/`);
  if (!matchesBase(base) && !matchesBase(baseRaw)) {
    throw new ValidationError(
      t("backend.webdav.destinationMustStayOnTheSameStorageNode"),
    );
  }
  const rest = pathName.startsWith(`${base}/`)
    ? pathName.slice(`${base}/`.length)
    : pathName.startsWith(`${baseRaw}/`)
      ? pathName.slice(`${baseRaw}/`.length)
      : pathName === base ||
          pathName === `${base}/` ||
          pathName === baseRaw ||
          pathName === `${baseRaw}/`
        ? ""
        : null;
  if (rest === null)
    throw new ValidationError(t("backend.webdav.invalidDestinationPath"));
  return normalizeWebDavRelativePath(rest);
}

/**
 * Recycle-bin rows at `relativePath` (and below it). A file-manager delete is
 * index-only — the bytes of a recycled file stay at its path until purged — so
 * any WebDAV write there would silently destroy them, and the row still holds
 * the unique (storageNodeId, relativePath) slot.
 */
function isCaseInsensitiveNode(node: { driver: string; basePath?: string | null; server?: { operatingSystem?: string | null } | null }) {
  return hasCaseInsensitiveLocalPaths(node.driver)
    || (node.driver === "SFTP" && (node.server?.operatingSystem === "WINDOWS" || Boolean(node.basePath && isWindowsStorageBasePath(node.basePath))));
}

async function recycledRowsAt(storageNodeId: string, relativePath: string, caseInsensitive = false) {
  return prisma.fileEntry.findMany({
    where: {
      storageNodeId,
      isDeleted: true,
      ...rowsAtOrBelow(relativePath, caseInsensitive),
    },
    select: { id: true, relativePath: true, entryType: true },
    take: 10_001,
  });
}

/** 409 when a recycled file still has bytes where the write would land. */
async function assertRecycledBytesSafe(
  node: Awaited<ReturnType<typeof loadNode>>,
  rows: Array<{ relativePath: string; entryType: string }>,
) {
  if (rows.length > 10_000) {
    throw new ConflictError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${rows[0]!.relativePath}` }));
  }
  for (const row of rows) {
    if (row.entryType !== "FILE") continue;
    if (await statBackingObject({ storageNode: node, relativePath: row.relativePath })) {
      throw new ConflictError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${row.relativePath}` }));
    }
  }
}

/** Index rows at `relativePath` and below it. */
function rowsAtOrBelow(relativePath: string, caseInsensitive = false) {
  const exact = caseInsensitive ? { equals: relativePath, mode: "insensitive" as const } : relativePath;
  const mode = caseInsensitive ? { mode: "insensitive" as const } : {};
  return { OR: [{ relativePath: exact }, { relativePath: { startsWith: escapeLikeLiteral(`${relativePath}/`), ...mode } }] };
}

/**
 * Entries at or below `relativePath` that have version blobs, listed before
 * their rows are dropped: the blobs are removed once the drop has committed.
 */
async function versionOwnersAt(storageNodeId: string, relativePath: string, except?: string, caseInsensitive = false): Promise<string[]> {
  const rows = await prisma.fileVersion.findMany({
    where: { fileEntry: { storageNodeId, ...rowsAtOrBelow(relativePath, caseInsensitive), ...(except ? { id: { not: except } } : {}) } },
    select: { fileEntryId: true },
    distinct: ["fileEntryId"],
  });
  return rows.map((row) => row.fileEntryId);
}

/**
 * Drop every index row at `relativePath` or below it: what a DELETE removes,
 * or what an overwrite replaces (recycle-bin rows whose bytes are already gone
 * included), in one statement. Overwritten rows used to be soft-deleted under
 * a tombstone prefix: in the recycle bin they could never be restored (their
 * bytes were gone), their history was unreachable (a deleted entry lists no
 * versions), and their version blobs stayed on disk. `except` keeps the row of
 * a file replaced in place.
 */
async function dropRowsAt(
  tx: Pick<typeof prisma, "fileEntry">,
  storageNodeId: string,
  relativePath: string,
  except?: string,
  caseInsensitive = false,
) {
  await tx.fileEntry.deleteMany({
    where: { storageNodeId, ...rowsAtOrBelow(relativePath, caseInsensitive), ...(except ? { id: { not: except } } : {}) },
  });
}

/**
 * Revoke the live shares of what was at `relativePath` or below it, so that
 * none serves whatever is later put there. A share of an enclosing folder
 * stays: unlike a recycle-bin delete, the bytes are gone, not hidden.
 */
async function revokeSharesAt(
  tx: Pick<typeof prisma, "shareLink">,
  storageNodeId: string,
  relativePath: string,
  caseInsensitive = false,
) {
  const exact = caseInsensitive ? { equals: relativePath, mode: "insensitive" as const } : relativePath;
  const mode = caseInsensitive ? { mode: "insensitive" as const } : {};
  await tx.shareLink.updateMany({
    where: {
      storageNodeId,
      revokedAt: null,
      OR: [{ path: exact }, { path: { startsWith: escapeLikeLiteral(`${relativePath}/`), ...mode } }],
    },
    data: { revokedAt: new Date() },
  });
}

export async function handleWebDavMove(
  ctx: WebDavContext,
  request: Request,
): Promise<Response> {
  if (!ctx.relativePath)
    throw new ValidationError(t("backend.webdav.cannotMoveCollectionRoot"));
  await requireAccess(
    ctx.session,
    ctx.storageNodeId,
    ctx.relativePath,
    "write",
  );
  const destPath = destinationRelativePath(
    ctx.storageNodeId,
    request.headers.get("destination"),
    ctx.requestUrl,
  );
  if (!destPath)
    throw new ValidationError(t("backend.webdav.invalidDestination"));
  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const caseInsensitive = isCaseInsensitiveNode(node);
  const windows = node.driver === "LOCAL" ? process.platform === "win32" :
    node.server?.operatingSystem === "WINDOWS" || (node.driver === "SFTP" && isWindowsStorageBasePath(node.basePath));
  const sourcePath = normalizeWebDavRelativePath(ctx.relativePath, { alreadyDecoded: true });
  const source = windows ? sourcePath.toLowerCase() : sourcePath;
  const destination = windows ? destPath.toLowerCase() : destPath;
  if (source === destination || destination.startsWith(source + "/") || source.startsWith(destination + "/")) {
    throw new ValidationError(t("backend.webdav.invalidDestination"));
  }
  const admittedEntry = await findEntry(ctx.storageNodeId, ctx.relativePath, caseInsensitive);
  if (!admittedEntry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
  const movedBytes = admittedEntry.size ?? BigInt(0);
  const destinationAccess = await requireAccess(ctx.session, ctx.storageNodeId, destPath, "write", movedBytes, {
    largestFileBytes: movedBytes, movedFrom: ctx.relativePath, measureMove: moveMeasurement(node, admittedEntry),
  });
  let releaseOverwrite: (() => Promise<void>) | undefined;
  try {
  releaseOverwrite = await lockStorageFileOverwrite(ctx.storageNodeId, destPath, ctx.relativePath);
  await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "write");
  await assertNotRecycled(ctx.storageNodeId, destPath, "write");
  // Quota guards precede overwrite locks on every upload. Re-read the source
  // under the lock so a replacement while waiting cannot use stale admission.
  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath, caseInsensitive);
  if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
  if (entry.id !== admittedEntry.id || entry.entryType !== admittedEntry.entryType ||
      entry.size !== admittedEntry.size || entry.updatedAt?.getTime() !== admittedEntry.updatedAt?.getTime()) {
    throw new ConflictError(apiCopy("apiCopy.files.op.changed"));
  }
  const existingDest = await findEntry(ctx.storageNodeId, destPath, caseInsensitive);
  const overwrite =
    (request.headers.get("overwrite") ?? "T").toUpperCase() !== "F";
  const unindexed = existingDest ? null : await statBackingObject({ storageNode: node, relativePath: destPath });
  if (!overwrite && (existingDest || unindexed)) {
    // RFC 4918 §9.8.5 / §9.9.4: 412, not 409 — clients read 409 as
    // "an ancestor collection is missing".
    throw new BusinessError(
      t("backend.webdav.destinationExistsAndOverwriteIsF"),
      undefined,
      412,
    );
  }

  // Refuse before any byte moves if a recycled file still lives at (or under)
  // the destination; recycle-bin rows without bytes are dropped below.
  await assertRecycledBytesSafe(node, await recycledRowsAt(ctx.storageNodeId, destPath, caseInsensitive));
  // A file moved onto a file replaces its content, as PUT and COPY do (and as
  // an editor's atomic save means it): the destination keeps its entry — its
  // versions, the replaced content now one of them, favourites and links —
  // and the moved file's own row goes.
  const replacedFile = existingDest?.entryType === "FILE" && entry.entryType === "FILE" ? existingDest : null;
  // Anything else at the destination (a folder, or a file under a moved folder) is deleted outright,
  // versions included: that is a delete, and a client that may only write must not do it by way of Overwrite.
  if ((existingDest && !replacedFile) || unindexed?.isDirectory) {
    await requireAccess(ctx.session, ctx.storageNodeId, destPath, "delete");
  }
  if (replacedFile) {
    await snapshotFileVersionBeforeOverwrite({
      fileEntryId: replacedFile.id,
      userId: ctx.session.userId,
      reason: "UPLOAD",
      note: "WebDAV MOVE overwrite",
    }).catch(() => undefined);
  }
  // Listed before anything changes; the blobs go once the rows have.
  const droppedVersionOwners = [
    ...(await versionOwnersAt(ctx.storageNodeId, destPath, replacedFile?.id, caseInsensitive)),
    ...(replacedFile ? [entry.id] : []),
  ];
  const destParent = parentRelativePath(destPath);
  const stagedDestPath = existingDest || unindexed
    ? `${destParent ? `${destParent}/` : ""}${WEBDAV_STAGE_PREFIX}${randomUUID()}.staged`
    : null;
  const recoveryPaths = { storageNodeId: ctx.storageNodeId, sourcePath: ctx.relativePath, destPath, stagedDestPath };
  async function restore(from: string, to: string) {
    if (await statBackingObject({ storageNode: node, relativePath: to })) {
      throw new ConflictError(t("backend.storage.pathAlreadyExists", { path: to }));
    }
    await moveBackingObject({ storageNode: node, oldRelativePath: from, newRelativePath: to });
  }
  async function rollback(error: unknown, moved: boolean) {
    try {
      if (moved) await restore(destPath, ctx.relativePath);
      if (stagedDestPath) await restore(stagedDestPath, destPath);
    } catch (rollbackError) {
      webdavLogger.error("WebDAV MOVE rollback failed", { ...recoveryPaths, error, rollbackError });
    }
  }

  await destinationAccess.verifyMove?.();
  if (stagedDestPath) {
    try {
      await renameBackingObject({ storageNode: node, oldRelativePath: destPath, newRelativePath: stagedDestPath });
    } catch (error) {
      // A remote server may commit the rename before its reply is lost.
      webdavLogger.error("WebDAV MOVE could not confirm destination staging", { ...recoveryPaths, error });
      throw error;
    }
  }

  try {
    const publish = overwrite ? renameBackingObject : moveBackingObject;
    await publish({
      storageNode: node,
      oldRelativePath: ctx.relativePath,
      newRelativePath: destPath,
    });
  } catch (error) {
    if (stagedDestPath) await rollback(error, false);
    throw error;
  }

  // update index for entry + descendants
  const oldPrefix = entry.relativePath;
  const newPrefix = destPath;
  try {
    await prisma.$transaction(async (tx) => {
      // Whatever held the destination goes first: it holds the unique
      // (storageNodeId, relativePath) slot the moved entry takes.
      await dropRowsAt(tx, ctx.storageNodeId, destPath, replacedFile?.id, caseInsensitive);
      if (replacedFile) {
        await tx.fileEntry.delete({ where: { id: entry.id } });
        await tx.fileEntry.update({
          where: { id: replacedFile.id },
          // The kept row describes the moved file from now on, checksum included.
          data: { mimeType: entry.mimeType, size: entry.size, checksumSha256: entry.checksumSha256 },
        });
      } else {
        // Links to a replaced resource must not serve what moves in.
        await revokeSharesAt(tx, ctx.storageNodeId, destPath, caseInsensitive);
        await tx.fileEntry.update({
          where: { id: entry.id },
          data: { relativePath: destPath, name: entryName(destPath) },
        });
      }
      // Shares follow the moved entry, as they do in the file manager.
      await moveSharePaths(tx, {
        storageNodeId: ctx.storageNodeId,
        oldPath: entry.relativePath,
        newPath: destPath,
        isDirectory: entry.entryType === "DIRECTORY",
        caseInsensitive,
      });
      if (entry.entryType !== "DIRECTORY") return;
      // Rewrite every descendant's path (and its basename) in ONE statement.
      // The previous per-row loop issued one UPDATE round-trip per child while
      // holding the transaction — a directory with thousands of entries kept
      // the index locked for the whole walk. The root row is updated first so
      // the unique constraint reserves the target prefix before descendants.
      // The prefix length is counted by PostgreSQL (code points): JavaScript's
      // UTF-16 length counts an emoji twice and cut a character off every
      // descendant. The ::text cast keeps substring's integer form (an
      // untyped parameter picked the regex form, which returned NULL).
      // The new prefix is concatenated as it is; regexp_replace only strips the directories off the result, so
      // nothing in the prefix is read as a pattern or a replacement (and storage paths refuse "\" anyway).
      await tx.$executeRaw`
        UPDATE file_entries
        SET "relativePath" = ${newPrefix} || substring("relativePath" from length(${oldPrefix}::text) + 1),
            "name" = regexp_replace(
              ${newPrefix} || substring("relativePath" from length(${oldPrefix}::text) + 1),
              '^.*/', ''
            ),
            "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE "storageNodeId" = ${ctx.storageNodeId}
          AND ${caseInsensitive
            ? Prisma.sql`lower("relativePath") LIKE ${`${escapeLikePrefix(`${oldPrefix.toLowerCase()}/`)}%`} ESCAPE '\\'`
            : Prisma.sql`"relativePath" LIKE ${`${escapeLikePrefix(`${oldPrefix}/`)}%`} ESCAPE '\\'`}
      `;
      // Recycle-bin descendants included: their bytes moved with the directory.
    });
  } catch (databaseError) {
    await rollback(databaseError, true);
    throw databaseError;
  }
  if (stagedDestPath) {
    await deleteBackingObject({
      storageNode: node,
      relativePath: stagedDestPath,
      isDirectory: existingDest?.entryType === "DIRECTORY" || Boolean(unindexed?.isDirectory),
      tolerateMissing: true,
    }).catch((error) =>
      webdavLogger.warn("WebDAV MOVE staged cleanup failed", {
        stagedDestPath,
        error,
      }),
    );
  }
  await purgeFileEntryVersionDirectories(ctx.storageNodeId, droppedVersionOwners);

  return new Response(null, {
    status: existingDest || unindexed ? 204 : 201,
    headers: {
      Location: buildWebDavHref(
        ctx.storageNodeId,
        destPath,
        entry.entryType === "DIRECTORY",
      ),
    },
  });
  } finally { await releaseOverwrite?.(); await releaseStorageQuotaGuard(destinationAccess); }
}

export async function handleWebDavCopy(
  ctx: WebDavContext,
  request: Request,
): Promise<Response> {
  if (!ctx.relativePath)
    throw new ValidationError(t("backend.webdav.cannotCopyCollectionRoot"));
  await requireAccess(ctx.session, ctx.storageNodeId, ctx.relativePath, "read");
  await assertNotRecycled(ctx.storageNodeId, ctx.relativePath, "read");
  const destPath = destinationRelativePath(
    ctx.storageNodeId,
    request.headers.get("destination"),
    ctx.requestUrl,
  );
  if (!destPath)
    throw new ValidationError(t("backend.webdav.invalidDestination"));

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const caseInsensitive = isCaseInsensitiveNode(node);
  const normalizedSource = normalizeWebDavRelativePath(ctx.relativePath, { alreadyDecoded: true });
  if (caseInsensitive ? destPath.toLowerCase() === normalizedSource.toLowerCase() : destPath === normalizedSource) {
    throw new ValidationError(t("backend.storage.copySourceDestinationMustDiffer"));
  }

  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath, caseInsensitive);
  if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
  if (entry.entryType === "DIRECTORY") {
    throw new BusinessError(
      t("backend.webdav.copyOfCollectionsIsNotSupportedCopyFiles"),
    );
  }
  await requireAccess(ctx.session, ctx.storageNodeId, destPath, "write");
  await assertNotRecycled(ctx.storageNodeId, destPath, "write");
  const parent = parentRelativePath(destPath);
  const staged = [parent, WEBDAV_STAGE_PREFIX + randomUUID() + ".staged"].filter(Boolean).join("/");
  let copyAccess: Awaited<ReturnType<typeof requireAccess>> | undefined;
  let releaseOverwrite: (() => Promise<void>) | undefined;
  let stagedCopy = false;
  try {
    const sourceLock = await lockStorageFileOverwrite(ctx.storageNodeId, destPath, ctx.relativePath);
    let size: number;
    try {
      await assertNotRecycled(ctx.storageNodeId, ctx.relativePath);
      await assertNotRecycled(ctx.storageNodeId, destPath, "write");
      if (request.headers.get("overwrite")?.toUpperCase() === "F" &&
          (await findEntry(ctx.storageNodeId, destPath, isCaseInsensitiveNode(node)) || await statBackingObject({ storageNode: node, relativePath: destPath }))) {
        throw new BusinessError(t("backend.webdav.destinationExistsAndOverwriteIsF"), undefined, 412);
      }
      size = (await copyStorageFile(node, ctx.relativePath, staged, false)).size;
      stagedCopy = true;
    } finally { await sourceLock(); }
    validateStorageFileIndex({ storageNodeId: ctx.storageNodeId, relativePath: destPath, mimeType: entry.mimeType, size });
    copyAccess = await requireAccess(ctx.session, ctx.storageNodeId, destPath, "write", size);
    releaseOverwrite = await lockStorageFileOverwrite(ctx.storageNodeId, destPath);
    await assertNotRecycled(ctx.storageNodeId, destPath, "write");
    return await performWebDavCopy({ ctx, request, entry, node, destPath, staged, size });
  } finally {
    if (stagedCopy) await deleteBackingObject({ storageNode: node, relativePath: staged, isDirectory: false, tolerateMissing: true })
      .catch(error => webdavLogger.warn("Could not clean up staged COPY", { error }));
    await releaseOverwrite?.();
    await releaseStorageQuotaGuard(copyAccess);
  }
}

async function performWebDavCopy(input: {
  ctx: WebDavContext;
  request: Request;
  entry: { id: string; entryType: string; mimeType: string | null };
  node: Awaited<ReturnType<typeof loadNode>>;
  destPath: string;
  staged: string;
  size: number;
}): Promise<Response> {
  const { ctx, request, entry, node, destPath, staged, size: copiedSize } = input;
  const existingDest = await findEntry(ctx.storageNodeId, destPath, isCaseInsensitiveNode(node));
  const overwrite =
    (request.headers.get("overwrite") ?? "T").toUpperCase() !== "F";
  const unindexed = existingDest ? null : await statBackingObject({ storageNode: node, relativePath: destPath });
  if (!overwrite && (existingDest || unindexed)) {
    // RFC 4918 §9.8.5 / §9.9.4: 412, not 409 — clients read 409 as
    // "an ancestor collection is missing".
    throw new BusinessError(
      t("backend.webdav.destinationExistsAndOverwriteIsF"),
      undefined,
      412,
    );
  }

  if (unindexed?.isDirectory) throw new ConflictError(t("backend.webdav.cannotOverwriteACollectionWithAFile"));
  // A recycled file at the destination keeps its bytes there; never copy over it.
  const recycledAtDest = existingDest ? [] : await recycledRowsAt(ctx.storageNodeId, destPath, isCaseInsensitiveNode(node));
  await assertRecycledBytesSafe(node, recycledAtDest);

  const destName = entryName(destPath);
  const destMime = entry.mimeType || undefined;
  let stagedDestPath: string | null = null;
  let promoted = false;
  let publishedVersion: string | null = null;
  let droppedVersionOwners: string[] = [];

  try {
    if (existingDest) {
      if (existingDest.entryType === "DIRECTORY") {
        throw new ConflictError(
          t("backend.webdav.cannotOverwriteACollectionWithAFile"),
        );
      }
      await snapshotFileVersionBeforeOverwrite({
        fileEntryId: existingDest.id,
        userId: ctx.session.userId,
        reason: "UPLOAD",
        note: "WebDAV COPY overwrite",
      }).catch(() => undefined);
    }
    if (existingDest || unindexed) {
      const destParent = parentRelativePath(destPath);
      stagedDestPath = `${destParent ? `${destParent}/` : ""}${WEBDAV_STAGE_PREFIX}copy-${randomUUID()}.staged`;
      await renameBackingObject({
        storageNode: node,
        oldRelativePath: destPath,
        newRelativePath: stagedDestPath,
      });
    } else {
      const parentPath = parentRelativePath(destPath);
      if (parentPath) {
        await ensureDirectoryIndexAndBacking({
          session: ctx.session,
          node,
          storageNodeId: ctx.storageNodeId,
          relativePath: parentPath,
        });
      }
    }

    publishedVersion = await copyVersion(node, staged);
    await moveBackingObject({ storageNode: node, oldRelativePath: staged, newRelativePath: destPath });
    promoted = true;

    if (existingDest) {
      await prisma.fileEntry.update({
        where: { id: existingDest.id },
        data: {
          name: destName,
          mimeType: destMime || null,
          size: BigInt(copiedSize),
          // As the file manager's copy: the replaced bytes' checksum goes, the copy is not hashed.
          checksumSha256: null,
          entryType: "FILE",
          isDeleted: false,
        },
      });
    } else {
      // Recycle rows without bytes still hold the unique slot.
      if (recycledAtDest.length) {
        droppedVersionOwners = await versionOwnersAt(ctx.storageNodeId, destPath, undefined, isCaseInsensitiveNode(node));
        await dropRowsAt(prisma, ctx.storageNodeId, destPath, undefined, isCaseInsensitiveNode(node));
        await revokeSharesAt(prisma, ctx.storageNodeId, destPath, isCaseInsensitiveNode(node));
      }
      await createFileEntry({
        storageNodeId: ctx.storageNodeId,
        name: destName,
        entryType: "FILE",
        relativePath: destPath,
        mimeType: destMime,
        size: copiedSize,
      });
    }
  } catch (error) {
    try {
      if (promoted) await rollbackPublishedCopy(node, destPath, publishedVersion);
      if (stagedDestPath) await moveBackingObject({ storageNode: node, oldRelativePath: stagedDestPath, newRelativePath: destPath });
    } catch (rollbackError) {
      webdavLogger.error("WebDAV COPY requires reconciliation", { destPath, stagedDestPath, error, rollbackError });
      throw new ConflictError(apiCopy("apiCopy.files.op.recovery", { v0: stagedDestPath ?? staged, v1: destPath, v2: apiCopy("apiCopy.files.op.changed") }));
    }
    throw error;
  }

  if (stagedDestPath) {
    await deleteBackingObject({
      storageNode: node,
      relativePath: stagedDestPath,
      isDirectory: false,
      tolerateMissing: true,
    }).catch((error) =>
      webdavLogger.warn("WebDAV COPY staged cleanup failed", {
        stagedDestPath,
        error,
      }),
    );
  }
  await purgeFileEntryVersionDirectories(ctx.storageNodeId, droppedVersionOwners);

  return new Response(null, {
    status: existingDest || unindexed ? 204 : 201,
    headers: {
      Location: buildWebDavHref(ctx.storageNodeId, destPath, false),
    },
  });
}
