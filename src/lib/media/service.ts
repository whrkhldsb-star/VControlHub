import { prisma } from "@/lib/db";

export function classifyMedia(mimeType?: string | null) {
  if (!mimeType) return null;
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  return null;
}

export async function listMediaItems(input: { mediaType?: "image" | "video"; q?: string; favorite?: boolean } = {}) {
 const q = input.q?.trim();
 return prisma.mediaItem.findMany({
   where: {
     mediaType: input.mediaType,
     favorite: input.favorite,
     ...(q ? {
       OR: [
         { name: { contains: q, mode: "insensitive" } },
         { relativePath: { contains: q, mode: "insensitive" } },
         { tags: { has: q } },
       ],
     } : {}),
   },
   orderBy: [{ favorite: "desc" }, { updatedAt: "desc" }],
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
      OR: [{ mimeType: { startsWith: "image/" } }, { mimeType: { startsWith: "video/" } }],
    },
    include: {
      storageNode: {
        select: { id: true, name: true, basePath: true, server: { select: { name: true } } },
      },
    },
  });

  let upserted = 0;
  for (const entry of entries) {
    const mediaType = classifyMedia(entry.mimeType);
    if (!mediaType) continue;

    await prisma.mediaItem.upsert({
      where: { fileEntryId: entry.id },
      update: {
        name: entry.name,
        relativePath: entry.relativePath,
        mimeType: entry.mimeType ?? "application/octet-stream",
        mediaType,
        size: entry.size ?? null,
        storageNodeId: entry.storageNodeId,
      },
      create: {
        fileEntryId: entry.id,
        storageNodeId: entry.storageNodeId,
        name: entry.name,
        relativePath: entry.relativePath,
        mimeType: entry.mimeType ?? "application/octet-stream",
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

export async function updateMediaTags(input: { id: string; tags?: string[]; favorite?: boolean }) {
  return prisma.mediaItem.update({ where: { id: input.id }, data: { tags: input.tags, favorite: input.favorite } });
}
