import { Prisma, type StorageDriver } from "@prisma/client";
import { prisma } from "@/lib/db";
import { teamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { getReadableStorageScope, readableStorageScopeSql } from "@/lib/storage/readable-scope";
import { noRecycledAncestorSql } from "@/lib/storage/archive-access";
import { storageStagingPathRegex } from "@/lib/storage/staging-paths";

export type MediaListFilters = {
  mediaType?: "image" | "video" | "audio";
  q?: string;
  favorite?: boolean;
  tag?: string;
  session?: TeamSession | null;
};
type MediaRow = {
  id: string; fileEntryId: string | null; storageNodeId: string; name: string; relativePath: string;
  size: bigint | null; mimeType: string; mediaType: string; favorite: boolean; tags: string[];
  createdAt: Date; updatedAt: Date;
  storageNode: { id: string; name: string; driver: StorageDriver; server: { name: string } | null };
};

export const MEDIA_PAGE_SIZE = 100;
export const MEDIA_MAX_PAGE_SIZE = 200;

/** Legacy media without a FileEntry id keeps its path. Linked media derives its identity and visibility from the current file. */
export async function visibleMediaQuery(filters: MediaListFilters, id?: string) {
  const teamId = filters.session && teamWhere(filters.session).teamId;
  const readable = filters.session && await getReadableStorageScope(filters.session);
  const q = filters.q?.trim(), tag = filters.tag?.trim();
  return Prisma.sql`SELECT e.* FROM (
    SELECT m.id, m."fileEntryId", m."storageNodeId", coalesce(f.name, m.name) AS name,
      coalesce(f."relativePath", m."relativePath") AS "relativePath", coalesce(f.size, m.size) AS size,
      coalesce(f."mimeType", m."mimeType") AS "mimeType", m."mediaType", m.favorite, m.tags, m."createdAt", m."updatedAt",
      jsonb_build_object('id', n.id, 'name', n.name, 'driver', n.driver, 'server',
        CASE WHEN s.id IS NULL THEN NULL ELSE jsonb_build_object('name', s.name) END) AS "storageNode"
    FROM media_items m JOIN "StorageNode" n ON n.id = m."storageNodeId"
    LEFT JOIN servers s ON s.id = n."serverId"
    LEFT JOIN file_entries f ON f."storageNodeId" = m."storageNodeId" AND
      (f.id = m."fileEntryId" OR (m."fileEntryId" IS NULL AND f."relativePath" = m."relativePath"))
    WHERE (m."fileEntryId" IS NULL OR f.id IS NOT NULL) AND f."isDeleted" IS NOT TRUE
      ${id ? Prisma.sql`AND m.id = ${id}` : Prisma.empty}
      ${teamId ? Prisma.sql`AND n."teamId" = ${teamId}` : Prisma.empty}
  ) e WHERE ${readableStorageScopeSql(readable)} AND ${noRecycledAncestorSql} AND e."relativePath" !~ ${storageStagingPathRegex}
    ${filters.mediaType ? Prisma.sql`AND e."mediaType" = ${filters.mediaType}` : Prisma.empty}
    ${filters.favorite !== undefined ? Prisma.sql`AND e.favorite = ${filters.favorite}` : Prisma.empty}
    ${tag ? Prisma.sql`AND ${tag} = ANY(e.tags)` : Prisma.empty}
    ${q ? Prisma.sql`AND (strpos(lower(e.name), lower(${q})) > 0 OR strpos(lower(e."relativePath"), lower(${q})) > 0 OR ${q} = ANY(e.tags))` : Prisma.empty}`;
}

const ordering = Prisma.sql`favorite DESC, "updatedAt" DESC, id DESC`;
export async function listMediaPage(input: MediaListFilters & { page?: number; pageSize?: number } = {}) {
  const pageSize = Math.min(Math.max(Math.trunc(input.pageSize ?? MEDIA_MAX_PAGE_SIZE), 1), MEDIA_MAX_PAGE_SIZE);
  const visible = await visibleMediaQuery(input);
  return prisma.$transaction(async tx => {
    const [row] = await tx.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM (${visible}) v`);
    const total = row!.total;
    const page = Math.max(1, Math.min(Math.trunc(input.page ?? 1), Math.ceil(total / pageSize)));
    const media = await tx.$queryRaw<MediaRow[]>(Prisma.sql`SELECT * FROM (${visible}) v ORDER BY ${ordering}
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
    return { media, total, page, pageSize };
  }, { isolationLevel: "RepeatableRead" });
}
export async function listMediaItems(input: Parameters<typeof listMediaPage>[0] = {}) {
  return (await listMediaPage(input)).media;
}
export async function countMediaItems(input: MediaListFilters = {}) {
  const visible = await visibleMediaQuery(input);
  const [row] = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`SELECT count(*)::int AS total FROM (${visible}) v`);
  return row!.total;
}
export async function listMediaTags(session?: TeamSession | null) {
  const visible = await visibleMediaQuery({ session });
  return prisma.$queryRaw<{ tag: string; count: number }[]>(Prisma.sql`
    SELECT tag, count(*)::int AS count FROM (SELECT btrim(unnest(tags)) AS tag FROM (${visible}) v) expanded
    WHERE tag <> '' GROUP BY tag ORDER BY count DESC, tag COLLATE "C" LIMIT 40`);
}
export async function listMediaTypeCounts(input: Omit<MediaListFilters, "mediaType"> = {}) {
  const visible = await visibleMediaQuery(input);
  const rows = await prisma.$queryRaw<{ mediaType: string; n: number }[]>(Prisma.sql`
    SELECT "mediaType", count(*)::int AS n FROM (${visible}) v GROUP BY "mediaType"`);
  const counts = { image: 0, video: 0, audio: 0 };
  for (const { mediaType, n } of rows) if (mediaType === "image" || mediaType === "video" || mediaType === "audio") counts[mediaType] = n;
  return counts;
}
export async function getMediaNeighbors(item: { id: string; favorite: boolean; updatedAt: Date }, filters: MediaListFilters) {
  const visible = await visibleMediaQuery(filters);
  const key = Prisma.sql`(${item.favorite}, ${item.updatedAt}, ${item.id})`;
  type Neighbor = { id: string; name: string };
  const [[previous], [next]] = await Promise.all([
    prisma.$queryRaw<Neighbor[]>(Prisma.sql`SELECT id, name FROM (${visible}) v WHERE (favorite,"updatedAt",id) > ${key} ORDER BY favorite,"updatedAt",id LIMIT 1`),
    prisma.$queryRaw<Neighbor[]>(Prisma.sql`SELECT id, name FROM (${visible}) v WHERE (favorite,"updatedAt",id) < ${key} ORDER BY ${ordering} LIMIT 1`),
  ]);
  return { previous: previous ?? null, next: next ?? null };
}
