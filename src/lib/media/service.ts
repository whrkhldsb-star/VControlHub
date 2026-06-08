import { prisma } from "@/lib/db";
import { classifyMediaKind } from "@/lib/storage/mime-constants";

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
      basePath: true,
      driver: true,
      directAccessMode: true,
      publicBaseUrl: true,
      serverId: true,
      server: {
        select: { id: true, name: true, host: true },
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
      server: {
        select: {
          id: true,
          name: true,
          host: true,
          port: true,
          username: true,
          connectionType: true,
          password: true,
          sshKey: { select: { privateKey: true } },
        },
      },
    },
  },
} as const;

export async function listMediaItems(
  input: {
    mediaType?: "image" | "video" | "audio";
    q?: string;
    favorite?: boolean;
    tag?: string;
  } = {},
) {
  const q = input.q?.trim();
  const tag = input.tag?.trim();
  return prisma.mediaItem.findMany({
    where: {
      mediaType: input.mediaType,
      favorite: input.favorite,
      ...(tag ? { tags: { has: tag } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { relativePath: { contains: q, mode: "insensitive" } },
              { tags: { has: q } },
            ],
          }
        : {}),
    },
    orderBy: [{ favorite: "desc" }, { updatedAt: "desc" }],
    take: 200,
    select: mediaItemSelect,
  });
}

export async function listMediaTypeCounts(
  input: { q?: string; favorite?: boolean; tag?: string } = {},
) {
  const q = input.q?.trim();
  const tag = input.tag?.trim();
  const grouped = await prisma.mediaItem.groupBy({
    by: ["mediaType"],
    where: {
      favorite: input.favorite,
      ...(tag ? { tags: { has: tag } } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { relativePath: { contains: q, mode: "insensitive" } },
              { tags: { has: q } },
            ],
          }
        : {}),
    },
    _count: { _all: true },
  });
  const counts = { image: 0, video: 0, audio: 0 };
  for (const row of grouped) {
    if (
      row.mediaType === "image" ||
      row.mediaType === "video" ||
      row.mediaType === "audio"
    ) {
      counts[row.mediaType] = row._count._all;
    }
  }
  return counts;
}

export async function listMediaTags() {
  const items = await prisma.mediaItem.findMany({
    select: { tags: true },
    where: { tags: { isEmpty: false } },
    take: 1000,
  });
  const counts = new Map<string, number>();
  for (const item of items) {
    for (const rawTag of item.tags) {
      const tag = rawTag.trim();
      if (!tag) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"))
    .slice(0, 40);
}

export async function getMediaItem(id: string) {
  return prisma.mediaItem.findUnique({
    where: { id },
    select: mediaStreamItemSelect,
  });
}

export async function scanMediaFromFileEntries(userId?: string) {
  const entries = await prisma.fileEntry.findMany({
    where: {
      entryType: "FILE",
      isDeleted: false,
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
    take: 1000,
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

  const staleFileEntries = await prisma.fileEntry.findMany({
    where: {
      OR: [{ isDeleted: true }, { entryType: { not: "FILE" } }],
    },
    select: { id: true },
    take: 1000,
  });
  const staleFileEntryIds = staleFileEntries.map((entry) => entry.id);
  const cleanup = staleFileEntryIds.length
    ? await prisma.mediaItem.deleteMany({
        where: { fileEntryId: { in: staleFileEntryIds } },
      })
    : { count: 0 };

  let upserted = 0;
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
}) {
  return prisma.mediaItem.update({
    where: { id: input.id },
    data: { tags: input.tags, favorite: input.favorite },
  });
}
