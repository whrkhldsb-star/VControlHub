/**
 * WebDAV storage adapter over VControlHub FileEntry + LOCAL/SFTP backends.
 *
 * URL shape (served by route handlers):
 *   /api/webdav/{storageNodeId}/[...path]
 *
 * Supported methods: OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY
 * Auth: Bearer API token or Basic (password = API token) with storage scopes.
 */
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
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
} from "@/lib/storage/fs-backend";
import {
  readStorageFileBuffer,
  streamStorageFile,
  writeStorageFileBuffer,
} from "@/lib/storage/file-content";
import {
  createFileEntry,
  softDeleteFileEntry,
} from "@/lib/storage/service-entries";
import { snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import { guessContentType } from "@/lib/http/mime-types";
import { nodeStreamToWeb } from "@/lib/http/node-to-web-stream";
import { parseStorageRange } from "@/lib/storage/streaming";

import { buildPropFindMultistatus, parseDepth, type PropFindItem } from "./xml";
import { t } from "@/lib/i18n/translations";
import {
  FILE_ENTRY_PAGE_SIZE,
  buildWebDavHref,
  ensureDirectoryIndexAndBacking,
  entryName,
  findEntry,
  forEachFileEntryPage,
  isDirectChildOf,
  isRootDirectChild,
  loadNode,
  normalizeWebDavRelativePath,
  parentRelativePath,
  requireAccess,
  toPropFindItem,
  weakEtag,
  type WebDavContext,
} from "./handler-internals";

export {
  buildWebDavHref,
  normalizeWebDavRelativePath,
  type WebDavContext,
} from "./handler-internals";

const MAX_WEBDAV_PUT_BYTES = 100 * 1024 * 1024;
export async function handleWebDavOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      Allow: "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY",
      DAV: "1, 2",
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

  if (!ctx.relativePath) {
    items.push({
      href: buildWebDavHref(ctx.storageNodeId, "", true),
      displayName: node.name,
      isCollection: true,
      lastModified: new Date(),
    });
    if (depth === 1) {
      const children = await prisma.fileEntry.findMany({
        where: {
          storageNodeId: ctx.storageNodeId,
          isDeleted: false,
          OR: [
            { parentId: null },
            // root children by path depth 1
          ],
        },
        orderBy: [{ entryType: "asc" }, { name: "asc" }, { id: "asc" }],
        take: FILE_ENTRY_PAGE_SIZE,
      });
      for (const child of children) {
        if (!isRootDirectChild(child)) continue;
        items.push(toPropFindItem(ctx.storageNodeId, child));
      }
    }
  } else {
    const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
    if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
    items.push(toPropFindItem(ctx.storageNodeId, entry));
    if (depth === 1 && entry.entryType === "DIRECTORY") {
      const children = await prisma.fileEntry.findMany({
        where: {
          storageNodeId: ctx.storageNodeId,
          isDeleted: false,
          OR: [
            { parentId: entry.id },
            {
              relativePath: { startsWith: `${entry.relativePath}/` },
            },
          ],
        },
        orderBy: [{ entryType: "asc" }, { name: "asc" }, { id: "asc" }],
        take: FILE_ENTRY_PAGE_SIZE,
      });
      for (const child of children) {
        if (!isDirectChildOf(child, entry.relativePath)) continue;
        items.push(toPropFindItem(ctx.storageNodeId, child));
      }
    }
  }

  const xml = buildPropFindMultistatus(items);
  return new Response(xml, {
    status: 207,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      DAV: "1, 2",
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
      ? (await streamStorageFile(node, ctx.relativePath)).size
      : Number(entry.size);
  const range = parseStorageRange(ctx.rangeHeader ?? null, fileSize);
  if (range instanceof Response) return range;
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(fileSize === 0 ? 0 : range.end - range.start + 1),
    "Accept-Ranges": "bytes",
  };
  const etag = weakEtag(entry);
  if (etag) headers.ETag = etag;
  if (entry.updatedAt) headers["Last-Modified"] = entry.updatedAt.toUTCString();

  if (method === "HEAD") {
    if (range.status === 206) {
      headers["Content-Range"] = `bytes ${range.start}-${range.end}/${fileSize}`;
    }
    return new Response(null, { status: range.status, headers });
  }
  const streamed = await streamStorageFile(
    node,
    ctx.relativePath,
    range.status === 206 ? range : undefined,
  );
  headers["Content-Length"] = String(range.end - range.start + 1);
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
  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > MAX_WEBDAV_PUT_BYTES) {
    return new Response("Payload too large (max 100MB)", { status: 413 });
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

  if (entry.entryType === "DIRECTORY") {
    // Paginate until exhausted — a single take:5000 left overflow children as live index rows.
    await forEachFileEntryPage(
      (cursorId) =>
        prisma.fileEntry.findMany({
          where: {
            storageNodeId: ctx.storageNodeId,
            isDeleted: false,
            relativePath: { startsWith: `${entry.relativePath}/` },
          },
          select: { id: true, relativePath: true, entryType: true },
          orderBy: { id: "asc" },
          take: FILE_ENTRY_PAGE_SIZE,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        }),
      async (children) => {
        // delete deepest paths first for backing store within the page
        const ordered = [...children].sort(
          (a, b) => b.relativePath.length - a.relativePath.length,
        );
        for (const child of ordered) {
          await deleteBackingObject({
            storageNode: node,
            relativePath: child.relativePath,
            isDirectory: child.entryType === "DIRECTORY",
            tolerateMissing: true,
          }).catch((err) => {
            webdavLogger.warn(
              "WebDAV DELETE: backing delete failed for child",
              err,
              { relativePath: child.relativePath },
            );
          });
          await softDeleteFileEntry({ fileEntryId: child.id });
        }
      },
    );
  }

  await deleteBackingObject({
    storageNode: node,
    relativePath: entry.relativePath,
    isDirectory: entry.entryType === "DIRECTORY",
    tolerateMissing: true,
  }).catch((err) => {
    webdavLogger.warn("WebDAV DELETE: backing delete failed for entry", err, {
      relativePath: entry.relativePath,
    });
  });
  await softDeleteFileEntry({ fileEntryId: entry.id });

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
  // Refuse cross-origin Destination (clients may send absolute URLs).
  if (destUrl.origin !== requestUrl.origin) {
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
    throw new ConflictError(
      t("backend.webdav.destinationExistsAndOverwriteIsF"),
    );
  }

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  if (existingDest) {
    await deleteBackingObject({
      storageNode: node,
      relativePath: destPath,
      isDirectory: existingDest.entryType === "DIRECTORY",
      tolerateMissing: true,
    }).catch(() => undefined);
    await softDeleteFileEntry({ fileEntryId: existingDest.id });
  }

  await renameBackingObject({
    storageNode: node,
    oldRelativePath: ctx.relativePath,
    newRelativePath: destPath,
  });

  // update index for entry + descendants
  const oldPrefix = entry.relativePath;
  const newPrefix = destPath;
  await prisma.fileEntry.update({
    where: { id: entry.id },
    data: {
      relativePath: destPath,
      name: entryName(destPath),
    },
  });

  if (entry.entryType === "DIRECTORY") {
    // Paginate all descendants so MOVE cannot leave old relativePath prefixes.
    await forEachFileEntryPage(
      (cursorId) =>
        prisma.fileEntry.findMany({
          where: {
            storageNodeId: ctx.storageNodeId,
            isDeleted: false,
            relativePath: { startsWith: `${oldPrefix}/` },
          },
          select: { id: true, relativePath: true },
          orderBy: { id: "asc" },
          take: FILE_ENTRY_PAGE_SIZE,
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
        }),
      async (descendants) => {
        for (const child of descendants) {
          const nextPath = `${newPrefix}${child.relativePath.slice(oldPrefix.length)}`;
          await prisma.fileEntry.update({
            where: { id: child.id },
            data: {
              relativePath: nextPath,
              name: entryName(nextPath),
            },
          });
        }
      },
    );
  }

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
  await requireAccess(ctx.session, ctx.storageNodeId, destPath, "write");

  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (!entry) throw new NotFoundError(t("backend.webdav.resourceNotFound"));
  if (entry.entryType === "DIRECTORY") {
    throw new BusinessError(
      t("backend.webdav.copyOfCollectionsIsNotSupportedCopyFiles"),
    );
  }

  const existingDest = await findEntry(ctx.storageNodeId, destPath);
  const overwrite =
    (request.headers.get("overwrite") ?? "T").toUpperCase() !== "F";
  if (existingDest && !overwrite) {
    throw new ConflictError(
      t("backend.webdav.destinationExistsAndOverwriteIsF"),
    );
  }

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const buffer = await readStorageFileBuffer(node, ctx.relativePath);
  const destName = entryName(destPath);
  const destMime = entry.mimeType || undefined;

  if (existingDest) {
    // Overwrite must update the live FileEntry (unique on storageNodeId+relativePath).
    // Calling createFileEntry here would ConflictError after the backing write succeeded.
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
    await writeStorageFileBuffer(node, destPath, buffer);
    await prisma.fileEntry.update({
      where: { id: existingDest.id },
      data: {
        name: destName,
        mimeType: destMime || null,
        size: BigInt(buffer.byteLength),
        entryType: "FILE",
        isDeleted: false,
      },
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
    await writeStorageFileBuffer(node, destPath, buffer);
    await createFileEntry({
      storageNodeId: ctx.storageNodeId,
      name: destName,
      entryType: "FILE",
      relativePath: destPath,
      mimeType: destMime,
      size: buffer.byteLength,
    });
  }

  return new Response(null, {
    status: existingDest ? 204 : 201,
    headers: {
      Location: buildWebDavHref(ctx.storageNodeId, destPath, false),
    },
  });
}
