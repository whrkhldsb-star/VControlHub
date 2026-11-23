import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import type { Readable } from "node:stream";
import path from "node:path";
import { isStorageStagingPath } from "./staging-paths";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { apiCopy } from "@/lib/i18n/api-copy";
import { hasCaseInsensitiveLocalPaths, isWindowsStorageBasePath } from "./path-utils";

/** A relative path in the form the file index stores: no leading, trailing or doubled slashes, no "." segments. */
export function normalizeIndexedPath(relativePath: string): string {
  return path.posix.normalize(relativePath).replace(/^\/+|\/+$/g, "").replace(/^\.$/, "");
}

export function indexedAncestors(relativePath: string) {
  const parts = relativePath.split("/");
  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

/**
 * The recycle bin's part of `relativePath`: whether the path itself, or a folder above it, is in the bin
 * (`onPath`), and the binned entries below it (`below`). Soft delete only changes the index; the bytes stay on
 * disk, so every operation that reads the disk for the user has to ask.
 */
export async function recycledAround(storageNodeId: string, rawRelativePath: string, driver?: string): Promise<{ onPath: boolean; below: string[] }> {
  // The index stores normalized paths, while the disk and tar accept "photos/" or "dir//a.zip": compared raw,
  // those spellings matched no bin entry and brought deleted files back through compress, extract and preview.
  const relativePath = normalizeIndexedPath(rawRelativePath);
  const ancestors = indexedAncestors(relativePath);
  const insensitive = hasCaseInsensitiveLocalPaths(driver);
  const mode = insensitive ? { mode: "insensitive" as const } : {};
  const key = (path: string) => insensitive ? path.toLowerCase() : path;
  const deleted = await prisma.fileEntry.findMany({
    where: {
      storageNodeId,
      isDeleted: true,
      OR: [
        { relativePath: { in: ancestors, ...mode } },
        { relativePath: { startsWith: escapeLikeLiteral(`${relativePath}/`), ...mode } },
      ],
    },
    select: { relativePath: true },
    take: 10001,
  });
  if (deleted.length > 10000) throw new ValidationError(apiCopy("apiCopy.files.op.entries"));
  return {
    onPath: deleted.some((entry) => ancestors.some(ancestor => key(ancestor) === key(entry.relativePath))),
    below: deleted.filter((entry) => key(entry.relativePath).startsWith(key(relativePath) + "/")).map((entry) => entry.relativePath),
  };
}

/** The outer query aliases its current FileEntry (or effective media path) as e. */
export const noRecycledAncestorSql = Prisma.sql`NOT EXISTS (
  SELECT 1 FROM file_entries bin WHERE bin."storageNodeId" = e."storageNodeId"
    AND bin."isDeleted" AND (starts_with(e."relativePath", bin."relativePath" || '/')
      OR (
        EXISTS (
          SELECT 1 FROM "StorageNode" n
          LEFT JOIN servers s ON s.id = n."serverId"
          WHERE n.id = e."storageNodeId" AND (
            ${process.platform === "win32" ? Prisma.sql`n.driver = 'LOCAL' OR` : Prisma.empty}
            (n.driver = 'SFTP' AND (s."operatingSystem" = 'WINDOWS' OR n."basePath" ~ '^/?[A-Za-z]:(/|\\|$)'))
          )
        )
        AND (lower(e."relativePath") = lower(bin."relativePath") OR starts_with(lower(e."relativePath"), lower(bin."relativePath") || '/'))
      ))
)`;

/** Never create another index row for an existing Windows filename or ambiguous parent. */
export async function assertCanonicalWritePath(nodeId: string, relativePath: string, driver: string) {
  if (!hasCaseInsensitiveLocalPaths(driver)) return;
  const ancestors = indexedAncestors(relativePath);
  const rows = await prisma.fileEntry.findMany({
    where: { storageNodeId: nodeId, relativePath: { in: ancestors, mode: "insensitive" } },
    select: { relativePath: true },
  });
  if (rows.some(row => !ancestors.includes(row.relativePath))) {
    throw new ConflictError(apiCopy("apiCopy.files.op.changed"));
  }
}

async function resolveCaseInsensitiveRecycle(
  storageNodeId: string,
  driver?: string,
  windowsOpenSsh?: boolean,
): Promise<boolean> {
  if (windowsOpenSsh !== undefined) {
    if (windowsOpenSsh) return true;
    if (driver !== undefined) return hasCaseInsensitiveLocalPaths(driver);
  } else if (driver !== undefined && driver !== "SFTP") {
    return hasCaseInsensitiveLocalPaths(driver);
  }
  const storageNodeModel = prisma.storageNode as
    | {
        findUnique?: typeof prisma.storageNode.findUnique;
        findFirst?: typeof prisma.storageNode.findFirst;
      }
    | undefined;
  const node = storageNodeModel?.findUnique
    ? await storageNodeModel.findUnique({
        where: { id: storageNodeId },
        select: {
          driver: true,
          basePath: true,
          server: { select: { operatingSystem: true } },
        },
      })
    : storageNodeModel?.findFirst
      ? await storageNodeModel.findFirst({
          where: { id: storageNodeId },
          select: {
            driver: true,
            basePath: true,
            server: { select: { operatingSystem: true } },
          },
        })
      : undefined;
  if (node === undefined) {
    return Boolean(windowsOpenSsh) || hasCaseInsensitiveLocalPaths(driver);
  }
  if (!node) {
    return true;
  }
  const effectiveDriver = driver ?? node.driver;
  const sftpWindows =
    effectiveDriver === "SFTP" &&
    (windowsOpenSsh ??
      (node.server?.operatingSystem === "WINDOWS" ||
        (typeof node.basePath === "string" && isWindowsStorageBasePath(node.basePath))));
  return hasCaseInsensitiveLocalPaths(effectiveDriver) || sftpWindows;
}

/** A recycled ancestor hides a read target and reserves a write destination. */
export async function assertNotRecycled(
  storageNodeId: string, relativePath: string, operation: "read" | "write" = "read", driver?: string,
  windowsOpenSsh?: boolean,
): Promise<void> {
  const caseInsensitive = await resolveCaseInsensitiveRecycle(storageNodeId, driver, windowsOpenSsh);
  const normalized = normalizeIndexedPath(relativePath);
  if (isStorageStagingPath(caseInsensitive ? normalized.toLowerCase() : normalized)) {
    throw new NotFoundError(apiCopy("apiCopy.files.op.missing"));
  }
  const deleted = await prisma.fileEntry.findFirst({
    where: {
      storageNodeId, isDeleted: true,
      relativePath: {
        in: indexedAncestors(normalized),
        ...(caseInsensitive ? { mode: "insensitive" } : {}),
      },
    },
    select: { id: true },
  });
  if (!deleted) return;
  if (operation === "write") throw new ConflictError(t("backend.webdav.destinationHeldByRecycleBin", { path: `/${relativePath}` }));
  throw new NotFoundError(apiCopy("apiCopy.files.op.missing"));
}

/**
 * Open a folder archive without the recycle bin's contents. Both public shares
 * and authenticated downloads must use this gate. Exclusions are literal
 * archive member paths; a deleted directory excludes its subtree.
 *
 * The deletion list is one consistent read taken before tar starts. The node's
 * file-operation lock is not held while the archive streams: it was, which
 * made every delete, move, restore and other folder download on the node fail
 * as busy for as long as one download ran, and pinned one of the few
 * advisory-lock connections per download. A tree changed under a running tar
 * makes tar exit non-zero, which fails the download (archive-stream) rather
 * than handing over a wrong archive; a file deleted after the list was read
 * may still be in it, as it would be in a download started a moment earlier.
 */
export async function openManagedArchive(input: {
  storageNodeId: string;
  relativePath: string;
  caseInsensitive?: boolean;
  signal: AbortSignal;
  open: (
    excluded: string[],
  ) => NodeJS.ReadableStream | Promise<NodeJS.ReadableStream>;
}): Promise<NodeJS.ReadableStream> {
  input.signal.throwIfAborted();
  const relativePath = normalizeIndexedPath(input.relativePath);
  const pathKey = (value: string) => input.caseInsensitive ? value.toLowerCase() : value;
  if (isStorageStagingPath(pathKey(relativePath))) throw new NotFoundError(apiCopy("apiCopy.files.op.missing"));
  const parts = relativePath.split("/");
  const ancestors = indexedAncestors(relativePath);
  const mode = input.caseInsensitive ? { mode: "insensitive" as const } : {};
  const deleted = await prisma.fileEntry.findMany({
    where: {
      storageNodeId: input.storageNodeId,
      isDeleted: true,
      OR: [
        { relativePath: { in: ancestors, ...mode } },
        { relativePath: { startsWith: escapeLikeLiteral(`${relativePath}/`), ...mode } },
      ],
    },
    select: { relativePath: true },
    take: 10001,
  });
  if (deleted.length > 10000)
    throw new ValidationError(apiCopy("apiCopy.files.op.entries"));
  const ancestorKeys = new Set(ancestors.map(pathKey));
  if (deleted.some((entry) => ancestorKeys.has(pathKey(entry.relativePath))))
    throw new NotFoundError(apiCopy("apiCopy.files.op.missing"));
  const name = path.posix.basename(relativePath);
  const excluded = deleted.map((entry) => {
    const child = entry.relativePath.split("/");
    if (child.length <= parts.length || pathKey(child.slice(0, parts.length).join("/")) !== pathKey(relativePath))
      throw new ValidationError(apiCopy("apiCopy.files.op.invalid"));
    return [name, ...child.slice(parts.length)].join("/");
  });
  input.signal.throwIfAborted();
  const stream = (await input.open(excluded)) as Readable;
  const abort = () => {
    stream.destroy();
  };
  const finish = () => input.signal.removeEventListener("abort", abort);
  stream.once("end", finish);
  stream.once("error", finish);
  stream.once("close", finish);
  input.signal.addEventListener("abort", abort, { once: true });
  if (input.signal.aborted) abort();
  return stream;
}
