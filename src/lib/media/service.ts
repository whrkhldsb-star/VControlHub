import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { visibleMediaQuery, type MediaListFilters } from "./library-query";
import { teamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { getReadableStorageScope, readableStoragePath } from "@/lib/storage/readable-scope";
import { NotFoundError } from "@/lib/errors";
import { classifyMediaKind } from "@/lib/storage/mime-constants";
import { t } from "@/lib/i18n/service-translations";
import { SSH_KEY_CREDENTIAL_SELECT } from "@/lib/ssh/ssh-key-crypto";
import { assertNotRecycled } from "@/lib/storage/archive-access";
import { normalizeStorageRelativePath } from "@/lib/storage/path-utils";

export function classifyMedia(
  mimeType?: string | null,
  nameOrPath?: string | null,
) {
  return classifyMediaKind({
    mimeType,
    name: nameOrPath,
    relativePath: nameOrPath,
  });
}

function extensionOf(nameOrPath?: string | null) {
  const basename =
    (nameOrPath ?? "").trim().toLowerCase().split(/[\\/]/).at(-1) ?? "";
  const index = basename.lastIndexOf(".");
  return index > 0 ? basename.slice(index) : "";
}

function inferMediaMimeType(entry: {
  mimeType?: string | null;
  name?: string | null;
  relativePath?: string | null;
  mediaType: "image" | "video" | "audio";
}) {
  const mime = entry.mimeType?.trim().toLowerCase();
  if (mime && mime !== "application/octet-stream") return mime;

  const extension = extensionOf(entry.name) || extensionOf(entry.relativePath);
  const byExtension: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".avif": "image/avif",
    ".svg": "image/svg+xml",
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".avi": "video/x-msvideo",
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".opus": "audio/opus",
  };
  return byExtension[extension] ?? `${entry.mediaType}/*`;
}

const mediaItemSelect = {
  id: true,
  fileEntryId: true,
  name: true,
  mediaType: true,
  relativePath: true,
  size: true,
  favorite: true,
  tags: true,
  mimeType: true,
  createdAt: true,
  updatedAt: true,
  storageNode: {
    select: {
      id: true,
      name: true,
      driver: true,
      server: {
        select: { name: true },
      },
    },
  },
} as const;

const mediaStreamItemSelect = {
  ...mediaItemSelect,
  storageNode: {
    select: {
      id: true,
      name: true,
      basePath: true,
      driver: true,
      directAccessMode: true,
      publicBaseUrl: true,
      serverId: true,
      teamId: true,
      hostKeySha256: true,
      webdavConfigEncrypted: true,
      // The node's own endpoint overrides and the server's OS decide the
      // target and transport (resolveStorageSshCredentials), as for file
      // operations (sftp-node.ts): without them playback used the server's
      // host/user and, on Windows, its RDP port.
      host: true,
      port: true,
      username: true,
      server: {
        select: {
          id: true,
          name: true,
          teamId: true,
          host: true,
          port: true,
          username: true,
          connectionType: true,
          managementMode: true,
          operatingSystem: true,
          password: true,
          // Without the pin the streaming routes' enforceHostKeyPin would fail
          // every connection — resolveStorageSshCredentials can only forward
          // what this select returns.
          hostKeySha256: true,
          sshKey: { select: SSH_KEY_CREDENTIAL_SELECT },
        },
      },
    },
  },
} as const;

export { listMediaItems, listMediaPage, listMediaTags, countMediaItems, listMediaTypeCounts, getMediaNeighbors, MEDIA_PAGE_SIZE, MEDIA_MAX_PAGE_SIZE } from "./library-query";

/** Filters of the media list a detail page was opened from. */
export function mediaListFiltersFromHref(href: string): Omit<MediaListFilters, "session"> {
  const params = new URL(href, "http://media.local").searchParams;
  const type = params.get("type");
  return {
    mediaType: type === "image" || type === "video" || type === "audio" ? type : undefined,
    q: params.get("q")?.trim() || undefined,
    favorite: params.get("favorite") === "1" ? true : undefined,
    tag: params.get("tag")?.trim() || undefined,
  };
}

/** With credentials: the node as its SFTP connection is resolved from (mediaStreamItemSelect). */
export async function getMediaItem(
  id: string,
  session: TeamSession | null | undefined,
  options: { includeCredentials: true },
): Promise<Prisma.MediaItemGetPayload<{ select: typeof mediaStreamItemSelect }> & { fileRevision?: string } | null>;
export async function getMediaItem(
  id: string,
  session?: TeamSession | null,
  options?: { includeCredentials?: false },
): Promise<Prisma.MediaItemGetPayload<{ select: typeof mediaItemSelect }> | null>;
export async function getMediaItem(
  id: string,
  session?: TeamSession | null,
  options?: { includeCredentials?: boolean },
) {
  const item = await prisma.mediaItem.findFirst({
    where: { id, ...(session && { storageNode: teamWhere(session) }) },
    select: options?.includeCredentials
      ? mediaStreamItemSelect
      : mediaItemSelect,
  });
  const resolved = item && await resolveAgainstFileEntry(item, options?.includeCredentials === true);
  if (!resolved?.storageNode) return null;
  const path = normalizeStorageRelativePath(resolved.relativePath);
  if (!path.ok) return null;
  if (session && !readableStoragePath(await getReadableStorageScope(session), resolved.storageNode.id, path.path)) return null;
  try {
    await assertNotRecycled(resolved.storageNode.id, path.path, "read", resolved.storageNode.driver);
  } catch (error) {
    if (error instanceof NotFoundError) return null;
    throw error;
  }
  return resolved;
}

/**
 * The library is re-indexed only by a scan, so a row can describe a file
 * deleted, recycled, renamed or moved since then: it played (or showed the
 * thumbnail of) a recycle-bin file, and 404ed after a rename. Opening an item
 * now follows its file entry: none (deleted for good) drops the row, a
 * recycled one is hidden, and a new name or path is used and stored.
 */
async function resolveAgainstFileEntry<T extends { id: string; fileEntryId: string | null; name: string; relativePath: string; storageNode: { id: string } | null }>(item: T, includeRevision: boolean): Promise<(T & { fileRevision?: string }) | null> {
  const select = { name: true, relativePath: true, storageNodeId: true, isDeleted: true, updatedAt: true, checksumSha256: true, storageVersion: true } as const;
  if (!item.storageNode) return null;
  const where = item.fileEntryId ? { id: item.fileEntryId } : {
    storageNodeId_relativePath: { storageNodeId: item.storageNode.id, relativePath: item.relativePath },
  };
  const entry = await prisma.fileEntry.findUnique({ where, select });
  if (!entry) {
    if (!item.fileEntryId) return item;
    await prisma.mediaItem.deleteMany({ where: { id: item.id } }).catch(() => undefined);
    return null;
  }
  if (entry.isDeleted || entry.storageNodeId !== item.storageNode?.id) return null;
  const revision = includeRevision ? { fileRevision: [entry.updatedAt.toISOString(), entry.checksumSha256, entry.storageVersion].join(":") } : {};
  if (entry.relativePath === item.relativePath && entry.name === item.name) return { ...item, ...revision };
  await prisma.mediaItem.updateMany({
    where: { id: item.id },
    data: { relativePath: entry.relativePath, name: entry.name },
  }).catch(() => undefined);
  return { ...item, relativePath: entry.relativePath, name: entry.name, ...revision };
}

/** Deterministic page ordering shared by the scan loops below. */
const SCAN_ORDER_BY = [{ updatedAt: "asc" }, { id: "asc" }] as const;

export async function scanMediaFromFileEntries(
  userId?: string,
  session?: TeamSession | null,
) {
  const nodeScope = session ? teamWhere(session) : {};
  const scopedNode =
    Object.keys(nodeScope).length > 0 ? { storageNode: nodeScope } : {};
  // Cursor-paginate with a deterministic orderBy until exhausted. A bare
  // `take: 1000` without ordering returned an arbitrary page, so once a
  // library passed 1000 media files the same subset was rescanned forever
  // and everything beyond it never entered the media library.
  const fetchScanPage = (cursor?: { id: string }) =>
    prisma.fileEntry.findMany({
      where: {
        entryType: "FILE",
        isDeleted: false,
        ...scopedNode,
        OR: [
          { mimeType: { startsWith: "image/" } },
          { mimeType: { startsWith: "video/" } },
          { mimeType: { startsWith: "audio/" } },
          { name: { endsWith: ".jpg", mode: "insensitive" } },
          { name: { endsWith: ".jpeg", mode: "insensitive" } },
          { name: { endsWith: ".png", mode: "insensitive" } },
          { name: { endsWith: ".gif", mode: "insensitive" } },
          { name: { endsWith: ".webp", mode: "insensitive" } },
          { name: { endsWith: ".avif", mode: "insensitive" } },
          { name: { endsWith: ".mp4", mode: "insensitive" } },
          { name: { endsWith: ".m4v", mode: "insensitive" } },
          { name: { endsWith: ".webm", mode: "insensitive" } },
          { name: { endsWith: ".mkv", mode: "insensitive" } },
          { name: { endsWith: ".mov", mode: "insensitive" } },
          { name: { endsWith: ".avi", mode: "insensitive" } },
          { name: { endsWith: ".mp3", mode: "insensitive" } },
          { name: { endsWith: ".m4a", mode: "insensitive" } },
          { name: { endsWith: ".aac", mode: "insensitive" } },
          { name: { endsWith: ".flac", mode: "insensitive" } },
          { name: { endsWith: ".wav", mode: "insensitive" } },
          { name: { endsWith: ".ogg", mode: "insensitive" } },
          { name: { endsWith: ".opus", mode: "insensitive" } },
        ],
      },
      orderBy: [...SCAN_ORDER_BY],
      take: 1000,
      ...(cursor ? { cursor, skip: 1 } : {}),
      include: {
        storageNode: {
          select: {
            id: true,
            name: true,
            basePath: true,
            server: { select: { name: true } },
          },
        },
      },
    });
  const pages: Array<Awaited<ReturnType<typeof fetchScanPage>>> = [];
  let scanCursor: { id: string } | undefined;
  for (;;) {
    const page = await fetchScanPage(scanCursor);
    pages.push(page);
    if (page.length < 1000) break;
    scanCursor = { id: page[page.length - 1]!.id };
  }
  const entries = pages.flat();

  // Same cursor discipline for the stale-row cleanup: without ordering the
  // cleanup only ever saw the first arbitrary 1000 stale rows.
  const staleFileEntryIds: string[] = [];
  {
    let cursor: { id: string } | undefined;
    for (;;) {
      const page = await prisma.fileEntry.findMany({
        where: {
          OR: [{ isDeleted: true }, { entryType: { not: "FILE" } }],
          ...scopedNode,
        },
        orderBy: [...SCAN_ORDER_BY],
        take: 1000,
        ...(cursor ? { cursor, skip: 1 } : {}),
        select: { id: true },
      });
      staleFileEntryIds.push(...page.map((entry) => entry.id));
      if (page.length < 1000) break;
      cursor = { id: page[page.length - 1]!.id };
    }
  }
  // A rescan hard-deletes the index row of a file that is gone (WebDAV/SFTP
  // sync), and MediaItem.fileEntryId has no foreign key, so nothing above can
  // find that media: it lingered, and the file reappearing added a duplicate.
  // Media whose FileEntry no longer exists, or no longer is media, is stale
  // too; media without a FileEntry source is left alone.
  {
    let cursor: { id: string } | undefined;
    for (;;) {
      const page = await prisma.mediaItem.findMany({
        where: { fileEntryId: { not: null }, ...scopedNode },
        orderBy: { id: "asc" },
        take: 1000,
        ...(cursor ? { cursor, skip: 1 } : {}),
        select: { id: true, fileEntryId: true },
      });
      const referenced = page.map((item) => item.fileEntryId!);
      if (referenced.length === 0) break;
      // Still media: the entry exists and its current name/MIME classifies as
      // media. A file renamed to note.txt kept its photo.jpg media row, since
      // the scan only visits entries that look like media now.
      const live = new Set(
        (await prisma.fileEntry.findMany({ where: { id: { in: referenced } }, select: { id: true, name: true, relativePath: true, mimeType: true } }))
          .filter((entry) => classifyMedia(entry.mimeType, entry.name || entry.relativePath))
          .map((entry) => entry.id),
      );
      staleFileEntryIds.push(...referenced.filter((id) => !live.has(id)));
      if (page.length < 1000) break;
      cursor = { id: page[page.length - 1]!.id };
    }
  }
  const cleanup = staleFileEntryIds.length
    ? await prisma.mediaItem.deleteMany({
        where: { fileEntryId: { in: staleFileEntryIds } },
      })
    : { count: 0 };

  let upserted = 0;
  // N+1 acceptable: Prisma has no batch upsert; each entry needs a per-row
  // create-or-update with a different `where: { fileEntryId }` and computed
  // fields (mediaType, indexedMimeType). The loop cannot be collapsed into
  // updateMany because the "create" path must run when no row exists yet.
  for (const entry of entries) {
    const mediaType = classifyMedia(
      entry.mimeType,
      entry.name || entry.relativePath,
    );
    if (!mediaType) continue;
    const indexedMimeType = inferMediaMimeType({
      mimeType: entry.mimeType,
      name: entry.name,
      relativePath: entry.relativePath,
      mediaType,
    });

    await prisma.mediaItem.upsert({
      where: { fileEntryId: entry.id },
      update: {
        name: entry.name,
        relativePath: entry.relativePath,
        mimeType: indexedMimeType,
        mediaType,
        size: entry.size ?? null,
        storageNodeId: entry.storageNodeId,
      },
      create: {
        fileEntryId: entry.id,
        storageNodeId: entry.storageNodeId,
        name: entry.name,
        relativePath: entry.relativePath,
        mimeType: indexedMimeType,
        mediaType,
        size: entry.size ?? null,
        tags: [],
        createdBy: userId ?? null,
      },
    });
    upserted += 1;
  }

  return { scanned: entries.length, upserted, removed: cleanup.count };
}

export async function updateMediaTags(input: {
  id: string;
  tags?: string[];
  favorite?: boolean;
  session?: TeamSession | null;
}) {
  const changes = [
    ...(input.tags !== undefined ? [Prisma.sql`tags = ${input.tags}::text[]`] : []),
    ...(input.favorite !== undefined ? [Prisma.sql`favorite = ${input.favorite}`] : []),
  ];
  if (changes.length) {
    const visible = await visibleMediaQuery({ session: input.session }, input.id);
    const count = await prisma.$executeRaw(Prisma.sql`UPDATE media_items SET ${Prisma.join(changes)},
      "updatedAt" = (clock_timestamp() AT TIME ZONE 'UTC') WHERE id IN (SELECT id FROM (${visible}) eligible)`);
    if (!count) throw new NotFoundError(t("backend.media.mediaItemNotFound"));
  }
  const item = await getMediaItem(input.id, input.session);
  if (!item) throw new NotFoundError(t("backend.media.mediaItemNotFound"));
  return item;
}
