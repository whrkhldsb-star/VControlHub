import { createHash } from "node:crypto";

import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { BusinessError, ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";
import { assertStorageAccess } from "@/lib/storage/access-control";
import { createManagedFolder } from "@/lib/storage/fs-backend";
import { type StorageFileNode, storageFileNodeSelect } from "@/lib/storage/file-content";
import { normalizeStorageRelativePath, resolveStoragePathWithinBase } from "@/lib/storage/path-utils";
import { createFileEntry } from "@/lib/storage/service-entries";
import type { PropFindItem } from "./xml";

export const FILE_ENTRY_PAGE_SIZE = 5000;

export type WebDavContext = {
  session: SessionPayload;
  storageNodeId: string;
  relativePath: string;
  requestUrl: URL;
};

export type WebDavFileEntryItem = {
  id?: string | null;
  name: string;
  relativePath: string;
  entryType: string;
  size?: bigint | number | null;
  mimeType?: string | null;
  updatedAt?: Date | null;
};

export async function forEachFileEntryPage<T extends { id: string }>(
  query: (cursorId: string | undefined) => Promise<T[]>,
  visit: (rows: T[]) => Promise<void>,
): Promise<void> {
  let cursorId: string | undefined;
  for (;;) {
    const rows = await query(cursorId);
    if (rows.length === 0) break;
    await visit(rows);
    if (rows.length < FILE_ENTRY_PAGE_SIZE) break;
    cursorId = rows[rows.length - 1]!.id;
  }
}

function encodeHrefPath(segments: string[]): string {
  return segments.map((segment) => encodeURIComponent(segment)).join("/");
}

export function buildWebDavHref(
  storageNodeId: string,
  relativePath: string,
  isCollection: boolean,
): string {
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
  if (!normalized.ok) throw new ValidationError(normalized.reason);
  return normalized.path;
}

export async function loadNode(
  storageNodeId: string,
  session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<StorageFileNode & { name: string }> {
  const node = await prisma.storageNode.findFirst({
    where: { id: storageNodeId, ...teamWhere(session) },
    select: { ...storageFileNodeSelect, name: true },
  });
  if (!node || !["LOCAL", "SFTP"].includes(node.driver)) {
    throw new NotFoundError(t("backend.webdav.storageNodeNotFoundOrNotWebdavCapable"));
  }
  return node as StorageFileNode & { name: string };
}

export async function requireAccess(
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
    throw new BusinessError(decision.reason ?? t("backend.webdav.storageAccessDenied"));
  }
  return decision;
}

export function parentRelativePath(relativePath: string): string {
  if (!relativePath) return "";
  const index = relativePath.lastIndexOf("/");
  return index <= 0 ? "" : relativePath.slice(0, index);
}

export function entryName(relativePath: string): string {
  if (!relativePath) return "";
  const index = relativePath.lastIndexOf("/");
  return index < 0 ? relativePath : relativePath.slice(index + 1);
}

export async function findEntry(storageNodeId: string, relativePath: string) {
  if (!relativePath) return null;
  return prisma.fileEntry.findFirst({
    where: { storageNodeId, relativePath, isDeleted: false },
  });
}

export function weakEtag(input: {
  id?: string | null;
  size?: bigint | number | null;
  updatedAt?: Date | null;
}): string | null {
  if (!input.id && input.size == null && !input.updatedAt) return null;
  const basis = `${input.id ?? ""}:${input.size?.toString() ?? ""}:${input.updatedAt?.getTime() ?? ""}`;
  const hash = createHash("sha1").update(basis).digest("hex").slice(0, 16);
  return `W/"${hash}"`;
}

export function toPropFindItem(
  storageNodeId: string,
  entry: WebDavFileEntryItem,
): PropFindItem {
  const isCollection = entry.entryType === "DIRECTORY";
  return {
    href: buildWebDavHref(storageNodeId, entry.relativePath, isCollection),
    displayName: entry.name,
    isCollection,
    contentLength: entry.size == null ? null : Number(entry.size),
    contentType: entry.mimeType,
    lastModified: entry.updatedAt,
    etag: weakEtag(entry),
  };
}

export function isRootDirectChild(entry: Pick<WebDavFileEntryItem, "relativePath">): boolean {
  return entry.relativePath.split("/").filter(Boolean).length === 1;
}

export function isDirectChildOf(
  entry: Pick<WebDavFileEntryItem, "relativePath">,
  parentPath: string,
): boolean {
  const prefix = `${parentPath}/`;
  if (!entry.relativePath.startsWith(prefix)) return false;
  const rest = entry.relativePath.slice(prefix.length);
  return Boolean(rest) && !rest.includes("/");
}

export async function ensureDirectoryIndexAndBacking(input: {
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
        throw new ConflictError(t("backend.webdav.pathComponentIsAFile", { path: built }));
      }
      continue;
    }
    await requireAccess(input.session, input.storageNodeId, built, "write");
    try {
      await createManagedFolder({ storageNode: input.node, relativePath: built });
    } catch (error) {
      if (input.node.driver === "LOCAL") {
        const { mkdir } = await import("node:fs/promises");
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
