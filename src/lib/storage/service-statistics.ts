import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readableStorageScopeSql, type ReadableStorageScope } from "./readable-scope";
import {
  ARCHIVE_MIME_TYPES,
  OFFICE_MIME_TYPES,
  CSV_MIME_TYPES,
  MARKDOWN_MIME_TYPES,
  EXTENDED_TEXT_MIME_TYPES,
  IMAGE_EXTENSIONS,
  AUDIO_EXTENSIONS,
  VIDEO_EXTENSIONS,
} from "./mime-constants";

const documentMimes = [
  ...new Set([
    "application/pdf",
    ...ARCHIVE_MIME_TYPES,
    ...OFFICE_MIME_TYPES,
    ...CSV_MIME_TYPES,
    ...MARKDOWN_MIME_TYPES,
    ...EXTENDED_TEXT_MIME_TYPES,
  ]),
];
const mediaExtensionPattern = `[^/\\\\]\\.(${[...new Set([...IMAGE_EXTENSIONS, ...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS])].map((extension) => extension.slice(1)).join("|")})$`;

/** Aggregate the authorized index without hydrating file bodies or truncating totals. */
export async function getFileIndexStatistics(nodeIds: string[], readable?: ReadableStorageScope | null) {
  const empty = {
    totalEntries: 0,
    deletedEntries: 0,
    previewableEntries: 0,
    remoteDirectoryCount: 0,
  };
  if (!nodeIds.length) return empty;
  const [row] = await prisma.$queryRaw<
    Array<Record<keyof typeof empty, bigint>>
  >(Prisma.sql`
    WITH entries AS MATERIALIZED (
      SELECT "storageNodeId", "relativePath", "isDeleted", name, "mimeType",
        ("entryType" = 'DIRECTORY' OR "mimeType" = 'inode/directory') IS TRUE AS directory
      FROM file_entries WHERE "storageNodeId" IN (${Prisma.join(nodeIds)}) AND ${readableStorageScopeSql(readable)}
    ), directories AS (
      SELECT DISTINCT e."storageNodeId", array_to_string((string_to_array(e."relativePath", '/'))[1:d.depth], '/') AS path
      FROM entries e CROSS JOIN LATERAL generate_series(1,
        cardinality(string_to_array(e."relativePath", '/')) - CASE WHEN e.directory THEN 0 ELSE 1 END) d(depth)
      WHERE NOT e."isDeleted"
    ) SELECT count(*) FILTER (WHERE NOT "isDeleted") AS "totalEntries",
      count(*) FILTER (WHERE "isDeleted") AS "deletedEntries",
      count(*) FILTER (WHERE NOT "isDeleted" AND (
        "mimeType" IN (${Prisma.join(documentMimes)}) OR starts_with("mimeType", 'text/')
        OR lower(trim("mimeType")) ~ '^(image|audio|video)/'
        OR lower(trim(name)) ~ ${mediaExtensionPattern}
        OR lower(trim("relativePath")) ~ ${mediaExtensionPattern}
      )) AS "previewableEntries",
      (SELECT count(*) FROM directories) AS "remoteDirectoryCount" FROM entries
  `);
  return row
    ? {
        totalEntries: Number(row.totalEntries),
        deletedEntries: Number(row.deletedEntries),
        previewableEntries: Number(row.previewableEntries),
        remoteDirectoryCount: Number(row.remoteDirectoryCount),
      }
    : empty;
}

/**
 * The node-wide statistics for a listing page, at most once a minute per
 * (nodes, scope): every page turn ran the full-table lateral query (A4-10).
 */
const STATISTICS_CACHE_MS = 60_000;
const STATISTICS_CACHE_MAX = 200;
const statisticsCache = new Map<string, { at: number; value: ReturnType<typeof getFileIndexStatistics> }>();

export function getFileIndexStatisticsCached(
  nodeIds: string[],
  readable?: Parameters<typeof getFileIndexStatistics>[1],
): ReturnType<typeof getFileIndexStatistics> {
  const key = `${[...nodeIds].sort().join(",")}|${JSON.stringify(readable ?? null)}`;
  const now = Date.now();
  const cached = statisticsCache.get(key);
  if (cached && now - cached.at < STATISTICS_CACHE_MS) return cached.value;
  const value = getFileIndexStatistics(nodeIds, readable);
  if (statisticsCache.size >= STATISTICS_CACHE_MAX) statisticsCache.delete(statisticsCache.keys().next().value!);
  statisticsCache.set(key, { at: now, value });
  value.catch(() => { statisticsCache.delete(key); });
  return value;
}
