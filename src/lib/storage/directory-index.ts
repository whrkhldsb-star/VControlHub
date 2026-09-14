import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type DirectoryIndexEntry = {
  id: string;
  relativePath: string;
  isDeleted: boolean;
  name: string;
  entryType: "FILE" | "DIRECTORY";
  mimeType: string | null;
  size: bigint | null;
  updatedAt: Date;
};

/** Include tombstones, but never load descendants for a shallow directory sync. */
export async function* readDirectoryIndex(
  nodeId: string,
  relativeDirectory: string,
  client: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
) {
  const prefix = relativeDirectory ? `${relativeDirectory}/` : "";
  let cursor: string | undefined;
  for (;;) {
    const rows: DirectoryIndexEntry[] = await client.$queryRaw(Prisma.sql`
      SELECT id, "relativePath", "isDeleted", name, "entryType", "mimeType", size, "updatedAt"
      FROM file_entries WHERE "storageNodeId" = ${nodeId}
        AND starts_with("relativePath", ${prefix})
        AND substring("relativePath" from length(${prefix}::text) + 1) <> ''
        AND position('/' in substring("relativePath" from length(${prefix}::text) + 1)) = 0
        ${cursor ? Prisma.sql`AND id > ${cursor}` : Prisma.empty}
      ORDER BY id ASC LIMIT 2000
    `);
    yield rows;
    if (rows.length < 2000) break;
    cursor = rows.at(-1)!.id;
  }
}
