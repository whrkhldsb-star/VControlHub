import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type FileListingRow = {
  storageNodeId: string;
  relativePath: string;
  name: string;
  entryId: string | null;
  directory: boolean;
};

/** IDs have already been authorized by listStorageNodes(session). */
export async function queryFileListing(input: {
  nodeIds: string[];
  path: string;
  query: string;
  recursive: boolean;
  page: number;
  pageSize: number;
  sort?: "name" | "size" | "source" | "updated";
  direction?: "asc" | "desc";
}) {
  if (input.nodeIds.length === 0)
    return { rows: [] as FileListingRow[], total: 0, page: 1 };
  const prefix = input.path ? `${input.path}/` : "";
  const depth = input.path ? input.path.split("/").length : 0;
  const sortColumn =
    input.sort === "size"
      ? Prisma.sql`size`
      : input.sort === "updated"
        ? Prisma.sql`"updatedAt"`
        : input.sort === "source"
          ? Prisma.sql`lower(source) COLLATE "C"`
          : Prisma.sql`lower(name) COLLATE "C"`;
  const sortDirection =
    input.direction === "desc" ? Prisma.sql`DESC` : Prisma.sql`ASC`;
  const directoryPaths = input.recursive
    ? Prisma.sql`SELECT DISTINCT e."storageNodeId",
        array_to_string((string_to_array(e."relativePath", '/'))[1:d.depth], '/') AS path
      FROM entries e CROSS JOIN LATERAL generate_series(${depth + 1},
        cardinality(string_to_array(e."relativePath", '/')) - CASE WHEN e.directory THEN 0 ELSE 1 END) d(depth)`
    : Prisma.sql`SELECT DISTINCT "storageNodeId", ${prefix} || split_part(remainder, '/', 1) AS path
      FROM entries WHERE directory OR position('/' in remainder) > 0`;
  // starts_with keeps %, _ and non-ASCII path segments literal. Derive implicit
  // directories in SQL so old indexes without parent rows remain navigable.
  const [result] = await prisma.$queryRaw<
    Array<{ rows: FileListingRow[]; total: bigint; page: number }>
  >(Prisma.sql`
    WITH entries AS MATERIALIZED (
      SELECT id, "storageNodeId", "relativePath", name, size, "updatedAt",
        ("entryType" = 'DIRECTORY' OR "mimeType" = 'inode/directory') IS TRUE AS directory,
        substring("relativePath" from length(${prefix}::text) + 1) AS remainder
      FROM file_entries
      WHERE "storageNodeId" IN (${Prisma.join(input.nodeIds)}) AND "isDeleted" = false
        AND starts_with("relativePath", ${prefix}) AND "relativePath" <> ${input.path}
    ), directory_paths AS (${directoryPaths}), indexed_directories AS MATERIALIZED (
      SELECT * FROM entries WHERE directory
    ), candidates AS (
      SELECT d."storageNodeId", d.path AS "relativePath",
        split_part(d.path, '/', -1) AS name, e.id AS "entryId", true AS directory, e.size, e."updatedAt"
      FROM directory_paths d LEFT JOIN indexed_directories e ON e."storageNodeId" = d."storageNodeId"
        AND e."relativePath" = d.path
      UNION ALL
      SELECT "storageNodeId", "relativePath", name, id AS "entryId", false AS directory, size, "updatedAt"
      FROM entries WHERE NOT directory AND (${input.recursive} OR position('/' in remainder) = 0)
    ), filtered AS (
      SELECT c.*, n.name AS source FROM candidates c JOIN "StorageNode" n ON n.id = c."storageNodeId"
      WHERE strpos(lower(c.name), lower(${input.query}::text)) > 0
    ), totals AS (
      SELECT count(*) AS total FROM filtered
    ), paging AS (
      SELECT total, least(${input.page}::int, greatest(1, ceil(total::numeric / ${input.pageSize})::int)) AS page FROM totals
    ), selected AS (
      SELECT * FROM filtered ORDER BY directory DESC, ${sortColumn} ${sortDirection} NULLS LAST, lower(name) COLLATE "C", "relativePath" COLLATE "C", "storageNodeId"
      LIMIT ${input.pageSize} OFFSET (SELECT (page - 1) * ${input.pageSize} FROM paging)
    ) SELECT paging.total, paging.page,
      coalesce((SELECT jsonb_agg(to_jsonb(selected)) FROM selected), '[]'::jsonb) AS rows FROM paging
  `);
  return {
    rows: result?.rows ?? [],
    total: Number(result?.total ?? 0),
    page: result?.page ?? 1,
  };
}

export async function queryFolderCounts(
  folders: Array<{ storageNodeId: string; relativePath: string }>,
) {
  if (!folders.length)
    return new Map<string, { fileCount: number; folderCount: number }>();
  const uniqueFolders = [...new Map(folders.map((folder) => [`${folder.storageNodeId}:${folder.relativePath}`, folder])).values()];
  const nodeIds = [...new Set(uniqueFolders.map((folder) => folder.storageNodeId))];
  // Generate ancestors once per indexed entry, then equijoin the requested paths.
  // A correlated prefix scan for every folder scales as folders * all node entries.
  const rows = await prisma.$queryRaw<
    Array<{
      storageNodeId: string;
      relativePath: string;
      fileCount: bigint;
      folderCount: bigint;
    }>
  >(Prisma.sql`
    WITH folders ("storageNodeId", "relativePath") AS (VALUES
      ${Prisma.join(uniqueFolders.map((folder) => Prisma.sql`(${folder.storageNodeId}::text, ${folder.relativePath}::text)`))}
    ), entries AS MATERIALIZED (
      SELECT "storageNodeId", string_to_array("relativePath", '/') AS parts,
        ("entryType" = 'DIRECTORY' OR "mimeType" = 'inode/directory') IS TRUE AS directory
      FROM file_entries WHERE "storageNodeId" IN (${Prisma.join(nodeIds)}) AND NOT "isDeleted" AND "relativePath" <> ''
    ), counts AS MATERIALIZED (
      SELECT e."storageNodeId", array_to_string(e.parts[1:d.depth], '/') AS "relativePath",
        count(*) FILTER (WHERE NOT e.directory) AS "fileCount",
        count(DISTINCT e.parts[d.depth + 1]) FILTER (
          WHERE e.directory OR cardinality(e.parts) > d.depth + 1) AS "folderCount"
      FROM entries e CROSS JOIN LATERAL generate_series(0, cardinality(e.parts) - 1) d(depth)
      GROUP BY e."storageNodeId", array_to_string(e.parts[1:d.depth], '/')
    ) SELECT f."storageNodeId", f."relativePath", coalesce(c."fileCount", 0) AS "fileCount",
      coalesce(c."folderCount", 0) AS "folderCount"
      FROM folders f LEFT JOIN counts c USING ("storageNodeId", "relativePath")
  `);
  return new Map(
    rows.map((row) => [
      `${row.storageNodeId}:${row.relativePath}`,
      {
        fileCount: Number(row.fileCount),
        folderCount: Number(row.folderCount),
      },
    ]),
  );
}
