/**
 * WebDAV storage adapter over VControlHub FileEntry + LOCAL/SFTP backends.
 *
 * URL shape (served by route handlers):
 *   /api/webdav/{storageNodeId}/[...path]
 *
 * Supported methods: OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY
 * Auth: Bearer API token or Basic (password = API token) with storage scopes.
 */
import { createHash } from "node:crypto";

import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import {
  BusinessError,
  ConflictError,
  NotFoundError,
  ValidationError,
} from "@/lib/errors";
import { assertStorageAccess } from "@/lib/storage/access-control";
import {
  createManagedFolder,
  deleteBackingObject,
  renameBackingObject,
} from "@/lib/storage/fs-backend";
import {
  readStorageFileBuffer,
  writeStorageFileBuffer,
  type StorageFileNode,
  storageFileNodeSelect,
} from "@/lib/storage/file-content";
import {
  createFileEntry,
  softDeleteFileEntry,
} from "@/lib/storage/service-entries";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";
import { snapshotFileVersionBeforeOverwrite } from "@/lib/storage/file-versions";
import { guessContentType } from "@/lib/http/mime-types";

import { buildPropFindMultistatus, parseDepth, type PropFindItem } from "./xml";

const MAX_WEBDAV_PUT_BYTES = 100 * 1024 * 1024;

export type WebDavContext = {
  session: SessionPayload;
  storageNodeId: string;
  relativePath: string; // "" for root
  requestUrl: URL;
};

function encodeHrefPath(segments: string[]): string {
  return segments.map((s) => encodeURIComponent(s)).join("/");
}

export function buildWebDavHref(storageNodeId: string, relativePath: string, isCollection: boolean): string {
  const base = `/api/webdav/${encodeURIComponent(storageNodeId)}`;
  const cleaned = relativePath.replace(/^\/+|\/+$/g, "");
  if (!cleaned) return `${base}/`;
  const href = `${base}/${encodeHrefPath(cleaned.split("/"))}`;
  return isCollection ? `${href}/` : href;
}

export function normalizeWebDavRelativePath(raw: string | string[] | undefined): string {
  const joined = Array.isArray(raw) ? raw.join("/") : (raw ?? "");
  const decoded = joined
    .split("/")
    .map((part) => {
      try {
        return decodeURIComponent(part);
      } catch {
        return part;
      }
    })
    .join("/");
  if (!decoded || decoded === "/") return "";
  const normalized = normalizeStorageRelativePath(decoded);
  if (!normalized.ok) {
    throw new ValidationError(normalized.reason);
  }
  return normalized.path;
}

/**
 * Load a WebDAV-capable StorageNode. Always team-scopes via session so
 * storage:manage-node (break-glass on assertStorageAccess) cannot open
 * another team's node by id after list/CRUD were team-scoped.
 */
async function loadNode(
  storageNodeId: string,
  session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<StorageFileNode & { name: string }> {
  const node = await prisma.storageNode.findFirst({
    where: {
      id: storageNodeId,
      ...teamWhere(session),
    },
    select: { ...storageFileNodeSelect, name: true },
  });
  if (!node || !["LOCAL", "SFTP"].includes(node.driver)) {
    throw new NotFoundError("Storage node not found or not WebDAV-capable");
  }
  return node as StorageFileNode & { name: string };
}

async function requireAccess(
  session: SessionPayload,
  storageNodeId: string,
  relativePath: string,
  operation: "read" | "write" | "delete",
  writeBytes?: number,
) {
  const decision = await assertStorageAccess({
    session,
    storageNodeId,
    relativePath: relativePath || "",
    operation,
    writeBytes,
  });
  if (!decision.allowed) {
    throw new BusinessError(decision.reason ?? "Storage access denied");
  }
}

function parentRelativePath(relativePath: string): string {
  if (!relativePath) return "";
  const idx = relativePath.lastIndexOf("/");
  return idx <= 0 ? "" : relativePath.slice(0, idx);
}

function entryName(relativePath: string): string {
  if (!relativePath) return "";
  const idx = relativePath.lastIndexOf("/");
  return idx < 0 ? relativePath : relativePath.slice(idx + 1);
}

async function findEntry(storageNodeId: string, relativePath: string) {
  if (!relativePath) return null;
  return prisma.fileEntry.findFirst({
    where: {
      storageNodeId,
      relativePath,
      isDeleted: false,
    },
  });
}

function weakEtag(input: { id?: string | null; size?: bigint | number | null; updatedAt?: Date | null }): string | null {
  if (!input.id && input.size == null && !input.updatedAt) return null;
  const basis = `${input.id ?? ""}:${input.size?.toString() ?? ""}:${input.updatedAt?.getTime() ?? ""}`;
  const hash = createHash("sha1").update(basis).digest("hex").slice(0, 16);
  return `W/"${hash}"`;
}


async function ensureDirectoryIndexAndBacking(input: {
  session: SessionPayload;
  node: StorageFileNode & { name?: string };
  storageNodeId: string;
  relativePath: string;
}) {
  if (!input.relativePath) return;
  const segments = input.relativePath.split("/").filter(Boolean);
  let built = "";
  for (const segment of segments) {
    built = built ? `${built}/${segment}` : segment;
    const existing = await findEntry(input.storageNodeId, built);
    if (existing) {
      if (existing.entryType !== "DIRECTORY") {
        throw new ConflictError(`Path component is a file: ${built}`);
      }
      continue;
    }
    await requireAccess(input.session, input.storageNodeId, built, "write");
    try {
      await createManagedFolder({
        storageNode: input.node,
        relativePath: built,
      });
    } catch (error) {
      // LOCAL recursive=false fails if parent missing — create with recursive via LOCAL path
      if (input.node.driver === "LOCAL") {
        const { mkdir } = await import("node:fs/promises");
        const { resolveStoragePathWithinBase } = await import("@/lib/storage/path-utils");
        const resolved = resolveStoragePathWithinBase(input.node.basePath, built);
        if (!resolved.ok) throw new ValidationError(resolved.reason);
        await mkdir(resolved.path, { recursive: true });
      } else {
        throw error;
      }
    }
    await createFileEntry({
      storageNodeId: input.storageNodeId,
      name: segment,
      entryType: "DIRECTORY",
      relativePath: built,
    });
  }
}

export async function handleWebDavOptions(): Promise<Response> {
  return new Response(null, {
    status: 204,
    headers: {
      Allow:
        "OPTIONS, PROPFIND, GET, HEAD, PUT, DELETE, MKCOL, MOVE, COPY",
      DAV: "1, 2",
      "MS-Author-Via": "DAV",
      "Accept-Ranges": "bytes",
    },
  });
}

export async function handleWebDavPropFind(ctx: WebDavContext, depthHeader: string | null): Promise<Response> {
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
        orderBy: [{ entryType: "asc" }, { name: "asc" }],
        take: 2000,
      });
      for (const child of children) {
        const depthOf = child.relativePath.split("/").filter(Boolean).length;
        if (depthOf !== 1) continue;
        items.push({
          href: buildWebDavHref(
            ctx.storageNodeId,
            child.relativePath,
            child.entryType === "DIRECTORY",
          ),
          displayName: child.name,
          isCollection: child.entryType === "DIRECTORY",
          contentLength: child.size == null ? null : Number(child.size),
          contentType: child.mimeType,
          lastModified: child.updatedAt,
          etag: weakEtag(child),
        });
      }
    }
  } else {
    const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
    if (!entry) throw new NotFoundError("Resource not found");
    items.push({
      href: buildWebDavHref(
        ctx.storageNodeId,
        entry.relativePath,
        entry.entryType === "DIRECTORY",
      ),
      displayName: entry.name,
      isCollection: entry.entryType === "DIRECTORY",
      contentLength: entry.size == null ? null : Number(entry.size),
      contentType: entry.mimeType,
      lastModified: entry.updatedAt,
      etag: weakEtag(entry),
    });
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
        orderBy: [{ entryType: "asc" }, { name: "asc" }],
        take: 2000,
      });
      const prefix = `${entry.relativePath}/`;
      for (const child of children) {
        if (!child.relativePath.startsWith(prefix)) continue;
        const rest = child.relativePath.slice(prefix.length);
        if (!rest || rest.includes("/")) continue;
        items.push({
          href: buildWebDavHref(
            ctx.storageNodeId,
            child.relativePath,
            child.entryType === "DIRECTORY",
          ),
          displayName: child.name,
          isCollection: child.entryType === "DIRECTORY",
          contentLength: child.size == null ? null : Number(child.size),
          contentType: child.mimeType,
          lastModified: child.updatedAt,
          etag: weakEtag(child),
        });
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
  if (!entry) throw new NotFoundError("Resource not found");
  if (entry.entryType === "DIRECTORY") {
    return new Response("Collection", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const buffer = await readStorageFileBuffer(node, ctx.relativePath);
  const contentType =
    entry.mimeType || guessContentType(entry.name) || "application/octet-stream";
  const headers: Record<string, string> = {
    "Content-Type": contentType,
    "Content-Length": String(buffer.byteLength),
    "Accept-Ranges": "bytes",
  };
  const etag = weakEtag(entry);
  if (etag) headers.ETag = etag;
  if (entry.updatedAt) headers["Last-Modified"] = entry.updatedAt.toUTCString();

  if (method === "HEAD") {
    return new Response(null, { status: 200, headers });
  }
  return new Response(new Uint8Array(buffer), { status: 200, headers });
}

export async function handleWebDavPut(ctx: WebDavContext, request: Request): Promise<Response> {
  if (!ctx.relativePath) {
    throw new ValidationError("Cannot PUT to collection root");
  }
  const body = Buffer.from(await request.arrayBuffer());
  if (body.byteLength > MAX_WEBDAV_PUT_BYTES) {
    return new Response("Payload too large (max 100MB)", { status: 413 });
  }

  await requireAccess(
    ctx.session,
    ctx.storageNodeId,
    ctx.relativePath,
    "write",
    body.byteLength,
  );

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const existing = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (existing?.entryType === "DIRECTORY") {
    throw new ConflictError("Cannot overwrite a collection with a file");
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
  const mimeType = request.headers.get("content-type") || guessContentType(name);

  if (existing) {
    await prisma.fileEntry.update({
      where: { id: existing.id },
      data: {
        name,
        mimeType: mimeType || null,
        size: BigInt(body.byteLength),
        entryType: "FILE",
        isDeleted: false,
      },
    });
  } else {
    await createFileEntry({
      storageNodeId: ctx.storageNodeId,
      name,
      entryType: "FILE",
      relativePath: ctx.relativePath,
      mimeType: mimeType || undefined,
      size: body.byteLength,
    });
  }

  return new Response(null, {
    status: existing ? 204 : 201,
    headers: {
      Location: buildWebDavHref(ctx.storageNodeId, ctx.relativePath, false),
    },
  });
}

export async function handleWebDavMkcol(ctx: WebDavContext): Promise<Response> {
  if (!ctx.relativePath) {
    throw new ValidationError("Cannot MKCOL at root");
  }
  await requireAccess(ctx.session, ctx.storageNodeId, ctx.relativePath, "write");
  const existing = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (existing) throw new ConflictError("Resource already exists");

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

export async function handleWebDavDelete(ctx: WebDavContext): Promise<Response> {
  if (!ctx.relativePath) {
    throw new ValidationError("Cannot DELETE collection root");
  }
  await requireAccess(ctx.session, ctx.storageNodeId, ctx.relativePath, "delete");
  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (!entry) throw new NotFoundError("Resource not found");

  const node = await loadNode(ctx.storageNodeId, ctx.session);

  if (entry.entryType === "DIRECTORY") {
    const children = await prisma.fileEntry.findMany({
      where: {
        storageNodeId: ctx.storageNodeId,
        isDeleted: false,
        relativePath: { startsWith: `${entry.relativePath}/` },
      },
      select: { id: true, relativePath: true, entryType: true },
      take: 5000,
    });
    // delete deepest paths first for backing store
    const ordered = [...children].sort(
      (a, b) => b.relativePath.length - a.relativePath.length,
    );
    for (const child of ordered) {
      await deleteBackingObject({
        storageNode: node,
        relativePath: child.relativePath,
        isDirectory: child.entryType === "DIRECTORY",
        tolerateMissing: true,
      }).catch(() => undefined);
      await softDeleteFileEntry({ fileEntryId: child.id });
    }
  }

  await deleteBackingObject({
    storageNode: node,
    relativePath: entry.relativePath,
    isDirectory: entry.entryType === "DIRECTORY",
    tolerateMissing: true,
  }).catch(() => undefined);
  await softDeleteFileEntry({ fileEntryId: entry.id });

  return new Response(null, { status: 204 });
}

function destinationRelativePath(
  storageNodeId: string,
  destinationHeader: string | null,
  requestUrl: URL,
): string {
  if (!destinationHeader) throw new ValidationError("Destination header required");
  let destUrl: URL;
  try {
    destUrl = new URL(destinationHeader, requestUrl.origin);
  } catch {
    throw new ValidationError("Invalid Destination header");
  }
  const prefix = `/api/webdav/${storageNodeId}/`;
  const pathName = destUrl.pathname;
  if (!pathName.startsWith(`/api/webdav/${storageNodeId}`)) {
    throw new ValidationError("Destination must stay on the same storage node");
  }
  const rest = pathName.startsWith(prefix)
    ? pathName.slice(prefix.length)
    : pathName === `/api/webdav/${storageNodeId}` || pathName === `/api/webdav/${storageNodeId}/`
      ? ""
      : null;
  if (rest === null) throw new ValidationError("Invalid Destination path");
  return normalizeWebDavRelativePath(rest);
}

export async function handleWebDavMove(ctx: WebDavContext, request: Request): Promise<Response> {
  if (!ctx.relativePath) throw new ValidationError("Cannot MOVE collection root");
  await requireAccess(ctx.session, ctx.storageNodeId, ctx.relativePath, "write");
  const destPath = destinationRelativePath(
    ctx.storageNodeId,
    request.headers.get("destination"),
    ctx.requestUrl,
  );
  if (!destPath) throw new ValidationError("Invalid Destination");
  await requireAccess(ctx.session, ctx.storageNodeId, destPath, "write");

  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (!entry) throw new NotFoundError("Resource not found");
  const existingDest = await findEntry(ctx.storageNodeId, destPath);
  const overwrite = (request.headers.get("overwrite") ?? "T").toUpperCase() !== "F";
  if (existingDest && !overwrite) {
    throw new ConflictError("Destination exists and Overwrite is F");
  }

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  if (existingDest) {
    await deleteBackingObject({ storageNode: node, relativePath: destPath, isDirectory: existingDest.entryType === "DIRECTORY", tolerateMissing: true }).catch(() => undefined);
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
    const descendants = await prisma.fileEntry.findMany({
      where: {
        storageNodeId: ctx.storageNodeId,
        isDeleted: false,
        relativePath: { startsWith: `${oldPrefix}/` },
      },
      select: { id: true, relativePath: true },
      take: 5000,
    });
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

export async function handleWebDavCopy(ctx: WebDavContext, request: Request): Promise<Response> {
  if (!ctx.relativePath) throw new ValidationError("Cannot COPY collection root");
  await requireAccess(ctx.session, ctx.storageNodeId, ctx.relativePath, "read");
  const destPath = destinationRelativePath(
    ctx.storageNodeId,
    request.headers.get("destination"),
    ctx.requestUrl,
  );
  if (!destPath) throw new ValidationError("Invalid Destination");
  await requireAccess(ctx.session, ctx.storageNodeId, destPath, "write");

  const entry = await findEntry(ctx.storageNodeId, ctx.relativePath);
  if (!entry) throw new NotFoundError("Resource not found");
  if (entry.entryType === "DIRECTORY") {
    throw new BusinessError("COPY of collections is not supported; copy files individually");
  }

  const existingDest = await findEntry(ctx.storageNodeId, destPath);
  const overwrite = (request.headers.get("overwrite") ?? "T").toUpperCase() !== "F";
  if (existingDest && !overwrite) {
    throw new ConflictError("Destination exists and Overwrite is F");
  }

  const node = await loadNode(ctx.storageNodeId, ctx.session);
  const buffer = await readStorageFileBuffer(node, ctx.relativePath);
  if (existingDest) {
    await snapshotFileVersionBeforeOverwrite({
      fileEntryId: existingDest.id,
      userId: ctx.session.userId,
      reason: "UPLOAD",
      note: "WebDAV COPY overwrite",
    }).catch(() => undefined);
  }
  await writeStorageFileBuffer(node, destPath, buffer);
  await createFileEntry({
    storageNodeId: ctx.storageNodeId,
    name: entryName(destPath),
    entryType: "FILE",
    relativePath: destPath,
    mimeType: entry.mimeType || undefined,
    size: buffer.byteLength,
  });

  return new Response(null, {
    status: existingDest ? 204 : 201,
    headers: {
      Location: buildWebDavHref(ctx.storageNodeId, destPath, false),
    },
  });
}

