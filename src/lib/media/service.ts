import { prisma } from "@/lib/db";
import { classifyMediaKind } from "@/lib/storage/mime-constants";

export function classifyMedia(
  mimeType?: string | null,
  nameOrPath?: string | null,
) {
  const kind = classifyMediaKind({
    mimeType,
    name: nameOrPath,
    relativePath: nameOrPath,
  });
  return kind === "audio" ? null : kind;
}

function extensionOf(nameOrPath?: string | null) {
  const basename = (nameOrPath ?? "").trim().toLowerCase().split(/[\\/]/).at(-1) ?? "";
  const index = basename.lastIndexOf(".");
  return index > 0 ? basename.slice(index) : "";
}

function inferMediaMimeType(entry: {
  mimeType?: string | null;
  name?: string | null;
  relativePath?: string | null;
  mediaType: "image" | "video";
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
  };
  return byExtension[extension] ?? `${entry.mediaType}/*`;
}

export async function listMediaItems(
  input: { mediaType?: "image" | "video"; q?: string; favorite?: boolean } = {},
) {
  const q = input.q?.trim();
  return prisma.mediaItem.findMany({
    where: {
      mediaType: input.mediaType,
      favorite: input.favorite,
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
    select: {
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
    },
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

  let upserted = 0;
  for (const entry of entries) {
    const mediaType = classifyMedia(entry.mimeType, entry.name || entry.relativePath);
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

  return { scanned: entries.length, upserted };
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
