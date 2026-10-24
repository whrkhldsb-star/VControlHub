/**
 * WebDAV storage adapter over VControlHub FileEntry + LOCAL/SFTP backends.
 *
 * URL shape (served by route handlers):
 *   /api/webdav/{storageNodeId}/[...path]
 *
 * Supported methods: OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY
 * Auth: Bearer API token or Basic (password = API token) with storage scopes.
 */
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { config } from "@/lib/config/env";
import {
  BusinessError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { releaseStorageQuotaGuard } from "@/lib/storage/access-control";

const webdavLogger = createLogger("webdav:handler");
import {
  deleteBackingObject,
  renameBackingObject,
  statBackingObject,
} from "@/lib/storage/fs-backend";
import {
  copyStorageFile,
  deleteStorageFileBuffer,
  streamStorageFile,
  writeStorageFileBuffer,
} from "@/lib/storage/file-content";
import {
  createFileEntry,
} from "@/lib/storage/service-entries";
import { purgeFileEntryVersionDirectories, snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import { guessContentType } from "@/lib/http/mime-types";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import {
  readRequestBodyBuffer,
  RequestBodyTooLargeError,
} from "@/lib/http/request-body";
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
  weakEtag,
  type WebDavContext,
} from "./handler-internals";
import { moveSharePaths } from "@/lib/share-link/follow-path";

export { normalizeWebDavRelativePath, type WebDavContext } from "./handler-internals";

const MAX_WEBDAV_PUT_BYTES = 100 * 1024 * 1024;

/**
 * Size of a stored object whose FileEntry has no `size` recorded.
 *
 * `streamStorageFile` is the only size source, and it opens a handle (a LOCAL
 * read stream, or an SSH client for SFTP) that the caller owns — probing without
 * closing leaked one per request.
 */
async function probeStorageFileSize(
  node: Parameters<typeof statBackingObject>[0]["storageNode"],
  relativePath: string,
): Promise<number> {
  // Metadata only. Opening a read stream for its size, then closing the SSH
  // connection at once, failed the stream's pending SFTP open; the stream
  // reported that as an 'error' event nobody listened to, which is thrown
  // and ends the process.
  const stat = await statBackingObject({ storageNode: node, relativePath });
  if (!stat) throw new ValidationError(t("backend.webdav.fileNotFound"));
  return stat.size;
}
export async function handleWebDavOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY",
      DAV: "1",
      "MS-Author-Via": "DAV",
      "Accept-Ranges": "bytes",
    },
  });
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
    const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
    if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
    items.push(toPropFindItem(ctx.storageNodeId, entry));
    if (depth === 1 && entry.entryType === "DIRECTORY") {
      listParent = entry.relativePath;
    }
  }

  if (listParent !== null) {
    const children = await listDirectChildren(ctx.storageNodeId, listParent);
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
    return new Response("WebDAV collection root", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
  if (entry.entryType === "DIRECTORY") {
    return new Response("Collection", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const contentType =
    entry.mimeType ||
    guessContentType(entry.name) ||
    "application/octet-stream";
  const fileSize =
    entry.size == null
      ? await probeStorageFileSize(node, ctx.relativePath)
      : Number(entry.size);
  const range = parseStorageRange(ctx.rangeHeader ?? null, fileSize);
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
  const etag = weakEtag(entry);
  if (etag) headers.ETag = etag;
  if (entry.updatedAt) headers["Last-Modified"] = entry.updatedAt.toUTCString();

  if (method === "HEAD") {
    if (range.status === 206) {
      headers["Content-Range"] =
        `bytes ${range.start}-${range.end}/${fileSize}`;
    }
    return new Response(null, { status: range.status, headers });
  }
  const streamed = await streamStorageFile(
    node,
    ctx.relativePath,
    range.status === 206 ? range : undefined,
  );
  headers["Content-Length"] = String(fileSize === 0 ? 0 : range.end - range.start + 1);
  if (range.status === 206)
    headers["Content-Range"] = `bytes ${range.start}-${range.end}/${fileSize}`;
  const response = new Response(nodeStreamToWeb(streamed.stream), {
    status: range.status,
    headers,
  });
  const closeAwareStream = streamed.stream as NodeJS.ReadableStream & {
    once?: (event: string, listener: () => void) => void;
  };
  closeAwareStream.once?.("close", streamed.close);
  closeAwareStream.once?.("error", streamed.close);
  return response;
}

export async function handleWebDavPut(
  ctx: WebDavContext,
  request: Request,
): Promise<Response> {
  if (!ctx.relativePath) {
    throw new ValidationError(t("backend.webdav.cannotPutToCollectionRoot"));
  }
  let body: Buffer;
  try {
    body = await readRequestBodyBuffer(request, MAX_WEBDAV_PUT_BYTES);
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) {
      return new Response(
        t("backend.storageHardening.webdav.payloadTooLarge", {
          max: `${Math.round(MAX_WEBDAV_PUT_BYTES / (1024 * 1024))}MB`,
        }),
        { status: 413 },
      );
    }
    throw error;
  }

  const putAccess = await requireAccess(
    ctx.session,
    ctx.storageNodeId,
    ctx.relativePath,
    "write",
    body.byteLength,
  );

  try {
    const node = await loadNode(ctx.storageNodeId, ctx.session);
    const existing = await findEntry(ctx.storageNodeId, ctx.relativePath);
    if (existing?.entryType === "DIRECTORY") {
      throw new ConflictError(
        t("backend.webdav.cannotOverwriteACollectionWithAFile"),
      );
    }

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
    } else {
      // A recycle-bin file at this path still has its bytes there (file-manager
      // delete is index-only). Keep them as a version of the revived entry
      // before overwriting; if that is impossible, refuse instead of
      // destroying them.
      const recycled = await prisma.fileEntry.findFirst({
        where: { storageNodeId: ctx.storageNodeId, relativePath: ctx.relativePath, isDeleted: true, entryType: "FILE" },
        select: { id: true },
      });
      if (recycled && await statBackingObject({ storageNode: node, relativePath: ctx.relativePath })) {
        const version = await snapshotFileVersionBeforeOverwrite({
          fileEntryId: recycled.id,
          userId: ctx.session.userId,
          reason: "UPLOAD",
          note: "WebDAV PUT over a recycle-bin file",
          includeDeleted: true,
        }).catch(() => null);
        if (!version) {
          throw new ConflictError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${ctx.relativePath}` }));
        }
      }
    }

    await writeStorageFileBuffer(node, ctx.relativePath, body);
    const name = entryName(ctx.relativePath);
    const mimeType =
      request.headers.get("content-type") || guessContentType(name);
    const indexData = {
      name,
      mimeType: mimeType || null,
      size: BigInt(body.byteLength),
      entryType: "FILE" as const,
      isDeleted: false as const,
      // A revived recycle-bin row must leave its delete batch, or a later
      // batch restore would treat this live file as part of it.
      deleteBatchId: null,
    };

    // Prefer unique-key lookup (includes soft-deleted) so concurrent PUTs converge.
    const indexRow =
      existing ??
      (await prisma.fileEntry.findFirst({
        where: {
          storageNodeId: ctx.storageNodeId,
          relativePath: ctx.relativePath,
        },
        select: { id: true },
      }));

    if (indexRow) {
      await prisma.fileEntry.update({
        where: { id: indexRow.id },
        data: indexData,
      });
    } else {
      try {
        await createFileEntry({
          storageNodeId: ctx.storageNodeId,
          name,
          entryType: "FILE",
          relativePath: ctx.relativePath,
          mimeType: mimeType || undefined,
          size: body.byteLength,
        });
      } catch (error) {
        // Concurrent first-time PUT: createFileEntry may ConflictError on unique key.
        // Blob already written — update winner's index instead of failing the PUT.
        const code =
          typeof error === "object" && error && "code" in error
            ? String((error as { code?: string }).code)
            : "";
        const isConflict =
          code === "P2002" ||
          error instanceof ConflictError ||
          /Unique constraint|already exists|pathAlreadyExists/i.test(
            String(error),
          );
        if (!isConflict) throw error;
        const raced = await prisma.fileEntry.findFirst({
          where: {
            storageNodeId: ctx.storageNodeId,
            relativePath: ctx.relativePath,
          },
          select: { id: true },
        });
        if (!raced) throw error;
        await prisma.fileEntry.update({
          where: { id: raced.id },
          data: indexData,
        });
      }
    }

    return new Response(null, {
      status: existing ? 204 : 201,
      headers: {
        Location: buildWebDavHref(ctx.storageNodeId, ctx.relativePath, false),
      },
    });
  } finally {
    await releaseStorageQuotaGuard(putAccess);
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
  const existing = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (existing)
    throw new ConflictError(t("backend.webdav.resourceAlreadyExists"));

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const parentPath = parentRelativePath(ctx.relativePath);
  if (parentPath) {
    await ensureDirectoryIndexAndBacking({
      session: ctx.session,
      node,
      storageNodeId: ctx.storageNodeId,
      relativePath: parentPath,
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
  ctx: WebDavContext,
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
  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const destParent = parentRelativePath(entry.relativePath);
  const stagedPath = `${destParent ? `${destParent}/` : ""}.vcontrolhub-webdav-delete-${randomUUID()}.staged`;

  // Stage the whole tree away from the live path first so a later index failure
  // can restore the original bytes instead of leaving unindexed orphans.
  await renameBackingObject({
    storageNode: node,
    oldRelativePath: entry.relativePath,
    newRelativePath: stagedPath,
  });

  // WebDAV DELETE is permanent, as clients present it ("permanently delete"),
  // and its bytes are removed below. Its rows used to go to the recycle bin
  // with a batch id, where they could never be restored (the bytes were gone)
  // — and a folder's earlier recycle-bin files lost their bytes too. Like the
  // file manager's permanent delete, the subtree's rows (recycle-bin ones
  // included) and their version history go with it.
  const withVersions = await versionOwnersAt(ctx.storageNodeId, entry.relativePath);

  try {
    await prisma.$transaction(async (tx) => {
      await dropRowsAt(tx, ctx.storageNodeId, entry.relativePath);
      await revokeSharesAt(tx, ctx.storageNodeId, entry.relativePath);
    });
  } catch (databaseError) {
    await renameBackingObject({
      storageNode: node,
      oldRelativePath: stagedPath,
      newRelativePath: entry.relativePath,
    }).catch((rollbackError) => {
      webdavLogger.error("WebDAV DELETE rollback failed", {
        databaseError,
        rollbackError,
        stagedPath,
      });
    });
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
async function recycledRowsAt(storageNodeId: string, relativePath: string) {
  return prisma.fileEntry.findMany({
    where: {
      storageNodeId,
      isDeleted: true,
      OR: [{ relativePath }, { relativePath: { startsWith: escapeLikeLiteral(`${relativePath}/`) } }],
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
function rowsAtOrBelow(relativePath: string) {
  return { OR: [{ relativePath }, { relativePath: { startsWith: escapeLikeLiteral(`${relativePath}/`) } }] };
}

/**
 * Entries at or below `relativePath` that have version blobs, listed before
 * their rows are dropped: the blobs are removed once the drop has committed.
 */
async function versionOwnersAt(storageNodeId: string, relativePath: string, except?: string): Promise<string[]> {
  const rows = await prisma.fileVersion.findMany({
    where: { fileEntry: { storageNodeId, ...rowsAtOrBelow(relativePath), ...(except ? { id: { not: except } } : {}) } },
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
) {
  await tx.fileEntry.deleteMany({
    where: { storageNodeId, ...rowsAtOrBelow(relativePath), ...(except ? { id: { not: except } } : {}) },
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
) {
  await tx.shareLink.updateMany({
    where: {
      storageNodeId,
      revokedAt: null,
      OR: [{ path: relativePath }, { path: { startsWith: escapeLikeLiteral(`${relativePath}/`) } }],
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
  await requireAccess(ctx.session, ctx.storageNodeId, destPath, "write");

  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
  const existingDest = await findEntry(ctx.storageNodeId, destPath);
  const overwrite =
    (request.headers.get("overwrite") ?? "T").toUpperCase() !== "F";
  if (existingDest && !overwrite) {
    // RFC 4918 §9.8.5 / §9.9.4: 412, not 409 — clients read 409 as
    // "an ancestor collection is missing".
    throw new BusinessError(
      t("backend.webdav.destinationExistsAndOverwriteIsF"),
      undefined,
      412,
    );
  }

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  // Refuse before any byte moves if a recycled file still lives at (or under)
  // the destination; recycle-bin rows without bytes are dropped below.
  await assertRecycledBytesSafe(node, await recycledRowsAt(ctx.storageNodeId, destPath));
  // A file moved onto a file replaces its content, as PUT and COPY do (and as
  // an editor's atomic save means it): the destination keeps its entry — its
  // versions, the replaced content now one of them, favourites and links —
  // and the moved file's own row goes.
  const replacedFile = existingDest?.entryType === "FILE" && entry.entryType === "FILE" ? existingDest : null;
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
    ...(await versionOwnersAt(ctx.storageNodeId, destPath, replacedFile?.id)),
    ...(replacedFile ? [entry.id] : []),
  ];
  const destParent = parentRelativePath(destPath);
  const stagedDestPath = existingDest
    ? `${destParent ? `${destParent}/` : ""}.vcontrolhub-webdav-${randomUUID()}.staged`
    : null;
  if (stagedDestPath) {
    await renameBackingObject({
      storageNode: node,
      oldRelativePath: destPath,
      newRelativePath: stagedDestPath,
    });
  }

  try {
    await renameBackingObject({
      storageNode: node,
      oldRelativePath: ctx.relativePath,
      newRelativePath: destPath,
    });
  } catch (error) {
    if (stagedDestPath) {
      await renameBackingObject({
        storageNode: node,
        oldRelativePath: stagedDestPath,
        newRelativePath: destPath,
      }).catch(() => undefined);
    }
    throw error;
  }

  // update index for entry + descendants
  const oldPrefix = entry.relativePath;
  const newPrefix = destPath;
  try {
    await prisma.$transaction(async (tx) => {
      // Whatever held the destination goes first: it holds the unique
      // (storageNodeId, relativePath) slot the moved entry takes.
      await dropRowsAt(tx, ctx.storageNodeId, destPath, replacedFile?.id);
      if (replacedFile) {
        await tx.fileEntry.delete({ where: { id: entry.id } });
        await tx.fileEntry.update({
          where: { id: replacedFile.id },
          data: { mimeType: entry.mimeType, size: entry.size },
        });
      } else {
        // Links to a replaced resource must not serve what moves in.
        await revokeSharesAt(tx, ctx.storageNodeId, destPath);
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
      });
      if (entry.entryType !== "DIRECTORY") return;
      // Rewrite every descendant's path (and its basename) in ONE statement.
      // The previous per-row loop issued one UPDATE round-trip per child while
      // holding the transaction — a directory with thousands of entries kept
      // the index locked for the whole walk. The root row is updated first so
      // the unique constraint reserves the target prefix before descendants.
      // Backslashes are escape metacharacters in regexp_replace's replacement.
      // The prefix length is counted by PostgreSQL (code points): JavaScript's
      // UTF-16 length counts an emoji twice and cut a character off every
      // descendant. The ::text cast keeps substring's integer form (an
      // untyped parameter picked the regex form, which returned NULL).
      const replacementPrefix = newPrefix.replace(/\\/g, "\\\\");
      await tx.$executeRaw`
        UPDATE file_entries
        SET "relativePath" = ${replacementPrefix} || substring("relativePath" from length(${oldPrefix}::text) + 1),
            "name" = regexp_replace(
              ${replacementPrefix} || substring("relativePath" from length(${oldPrefix}::text) + 1),
              '^.*/', ''
            ),
            "updatedAt" = (now() AT TIME ZONE 'UTC')
        WHERE "storageNodeId" = ${ctx.storageNodeId}
          AND "relativePath" LIKE ${`${escapeLikePrefix(`${oldPrefix}/`)}%`} ESCAPE '\\'
      `;
      // Recycle-bin descendants included: their bytes moved with the directory.
    });
  } catch (databaseError) {
    const rollbackErrors: unknown[] = [];
    await renameBackingObject({
      storageNode: node,
      oldRelativePath: destPath,
      newRelativePath: ctx.relativePath,
    }).catch((error) => rollbackErrors.push(error));
    if (stagedDestPath) {
      await renameBackingObject({
        storageNode: node,
        oldRelativePath: stagedDestPath,
        newRelativePath: destPath,
      }).catch((error) => rollbackErrors.push(error));
    }
    if (rollbackErrors.length)
      webdavLogger.error("WebDAV MOVE rollback failed", {
        databaseError,
        rollbackErrors,
      });
    throw databaseError;
  }
  if (stagedDestPath) {
    await deleteBackingObject({
      storageNode: node,
      relativePath: stagedDestPath,
      isDirectory: existingDest!.entryType === "DIRECTORY",
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
    status: existingDest ? 204 : 201,
    headers: {
      Location: buildWebDavHref(
        ctx.storageNodeId,
        destPath,
        entry.entryType === "DIRECTORY",
      ),
    },
  });
}

export async function handleWebDavCopy(
  ctx: WebDavContext,
  request: Request,
): Promise<Response> {
  if (!ctx.relativePath)
    throw new ValidationError(t("backend.webdav.cannotCopyCollectionRoot"));
  await requireAccess(ctx.session, ctx.storageNodeId, ctx.relativePath, "read");
  const destPath = destinationRelativePath(
    ctx.storageNodeId,
    request.headers.get("destination"),
    ctx.requestUrl,
  );
  if (!destPath)
    throw new ValidationError(t("backend.webdav.invalidDestination"));

  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
  if (entry.entryType === "DIRECTORY") {
    throw new BusinessError(
      t("backend.webdav.copyOfCollectionsIsNotSupportedCopyFiles"),
    );
  }

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  // COPY writes a second full copy of the bytes, so the destination grant has to
  // be checked against that size. Without `writeBytes` neither `maxFileBytes` nor
  // `quotaBytes` is evaluated at all (assertStorageAccess skips both), which let
  // a read+write grant duplicate its way past its own capacity limit.
  const sourceBytes =
    entry.size == null
      ? await probeStorageFileSize(node, ctx.relativePath)
      : Number(entry.size);
  const copyAccess = await requireAccess(
    ctx.session,
    ctx.storageNodeId,
    destPath,
    "write",
    sourceBytes,
  );
  try {
    return await performWebDavCopy({
      ctx,
      request,
      entry,
      node,
      destPath,
    });
  } finally {
    await releaseStorageQuotaGuard(copyAccess);
  }
}

async function performWebDavCopy(input: {
  ctx: WebDavContext;
  request: Request;
  entry: { id: string; entryType: string; mimeType: string | null };
  node: Awaited<ReturnType<typeof loadNode>>;
  destPath: string;
}): Promise<Response> {
  const { ctx, request, entry, node, destPath } = input;
  const existingDest = await findEntry(ctx.storageNodeId, destPath);
  const overwrite =
    (request.headers.get("overwrite") ?? "T").toUpperCase() !== "F";
  if (existingDest && !overwrite) {
    // RFC 4918 §9.8.5 / §9.9.4: 412, not 409 — clients read 409 as
    // "an ancestor collection is missing".
    throw new BusinessError(
      t("backend.webdav.destinationExistsAndOverwriteIsF"),
      undefined,
      412,
    );
  }

  // A recycled file at the destination keeps its bytes there; never copy over it.
  const recycledAtDest = existingDest ? [] : await recycledRowsAt(ctx.storageNodeId, destPath);
  await assertRecycledBytesSafe(node, recycledAtDest);

  const destName = entryName(destPath);
  const destMime = entry.mimeType || undefined;
  let copiedSize = 0;
  let stagedDestPath: string | null = null;
  let promoted = false;
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
      const destParent = parentRelativePath(destPath);
      stagedDestPath = `${destParent ? `${destParent}/` : ""}.vcontrolhub-webdav-copy-${randomUUID()}.staged`;
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

    const copied = await copyStorageFile(node, ctx.relativePath, destPath);
    copiedSize = copied.size;
    promoted = true;

    if (existingDest) {
      await prisma.fileEntry.update({
        where: { id: existingDest.id },
        data: {
          name: destName,
          mimeType: destMime || null,
          size: BigInt(copiedSize),
          entryType: "FILE",
          isDeleted: false,
        },
      });
    } else {
      // Recycle rows without bytes still hold the unique slot.
      if (recycledAtDest.length) {
        droppedVersionOwners = await versionOwnersAt(ctx.storageNodeId, destPath);
        await dropRowsAt(prisma, ctx.storageNodeId, destPath);
        await revokeSharesAt(prisma, ctx.storageNodeId, destPath);
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
    if (promoted) {
      await deleteStorageFileBuffer(node, destPath).catch(() => undefined);
    }
    if (stagedDestPath) {
      await renameBackingObject({
        storageNode: node,
        oldRelativePath: stagedDestPath,
        newRelativePath: destPath,
      }).catch(() => undefined);
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
    status: existingDest ? 204 : 201,
    headers: {
      Location: buildWebDavHref(ctx.storageNodeId, destPath, false),
    },
  });
}
