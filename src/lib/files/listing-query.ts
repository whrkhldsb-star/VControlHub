import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { readableStorageScopeSql, type ReadableStorageScope } from "@/lib/storage/readable-scope";

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
  readable?: ReadableStorageScope | null;
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
      WHERE "storageNodeId" IN (${Prisma.join(input.nodeIds)}) AND "isDeleted" = false AND ${readableStorageScopeSql(input.readable)}
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
  readable?: ReadableStorageScope | null,
) {
  const counts = new Map<string, { fileCount: number; folderCount: number }>();
  if (!folders.length) return counts;
  const uniqueFolders = [...new Map(folders.map((folder) => [`${folder.storageNodeId}:${folder.relativePath}`, folder])).values()];
  // The folders of one listing share a parent: one pass over that parent's
  // subtree answers all of them. The old query expanded every entry of the
  // node into all of its ancestors on every page (A4-10): O(entries × depth)
  // per request, seconds on a node with a few hundred thousand files.
  const groups = new Map<string, { storageNodeId: string; parent: string; children: Set<string> }>();
  for (const folder of uniqueFolders) {
    const cut = folder.relativePath.lastIndexOf("/");
    const parent = cut >= 0 ? folder.relativePath.slice(0, cut) : "";
    const child = cut >= 0 ? folder.relativePath.slice(cut + 1) : folder.relativePath;
    const key = `${folder.storageNodeId}:${parent}`;
    const group = groups.get(key) ?? { storageNodeId: folder.storageNodeId, parent, children: new Set<string>() };
    group.children.add(child);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    const depth = group.parent ? group.parent.split("/").length : 0;
    const rows = await prisma.$queryRaw<Array<{ child: string; fileCount: bigint; folderCount: bigint }>>(Prisma.sql`
      SELECT e.child,
        count(*) FILTER (WHERE NOT e.directory) AS "fileCount",
        count(DISTINCT e.grandchild) FILTER (WHERE e.directory OR e.depth > ${depth + 2}) AS "folderCount"
      FROM (
        SELECT split_part("relativePath", '/', ${depth + 1}) AS child,
          split_part("relativePath", '/', ${depth + 2}) AS grandchild,
          cardinality(string_to_array("relativePath", '/')) AS depth,
          ("entryType" = 'DIRECTORY' OR "mimeType" = 'inode/directory') IS TRUE AS directory
        FROM file_entries
        WHERE "storageNodeId" = ${group.storageNodeId} AND NOT "isDeleted" AND "relativePath" <> ''
          AND ${group.parent ? Prisma.sql`"relativePath" LIKE ${`${escapeLikeLiteral(group.parent)}/%`} ESCAPE '\\'` : Prisma.sql`TRUE`}
          AND cardinality(string_to_array("relativePath", '/')) > ${depth + 1}
          AND ${readableStorageScopeSql(readable)}
      ) e
      WHERE e.child IN (${Prisma.join([...group.children])})
      GROUP BY e.child
    `);
    for (const row of rows) {
      const relativePath = group.parent ? `${group.parent}/${row.child}` : row.child;
      counts.set(`${group.storageNodeId}:${relativePath}`, { fileCount: Number(row.fileCount), folderCount: Number(row.folderCount) });
    }
  }
  for (const folder of uniqueFolders) {
    const key = `${folder.storageNodeId}:${folder.relativePath}`;
    if (!counts.has(key)) counts.set(key, { fileCount: 0, folderCount: 0 });
  }
  return counts;
}
