import { z } from "zod";
import { storageNodeTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { getReadableStorageScope, readableStorageScopeWhere } from "@/lib/storage/readable-scope";

export const recycleBinQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).catch(1),
  pageSize: z.coerce.number().int().min(1).max(200).catch(50),
});

export async function getRecycleBinPage(
  session: TeamSession,
  query: z.infer<typeof recycleBinQuerySchema>,
) {
  const scope = await getReadableStorageScope(session);
  const where =
    scope === null
      ? { isDeleted: true, storageNode: storageNodeTeamWhere(session) }
      : { isDeleted: true, storageNode: storageNodeTeamWhere(session), ...readableStorageScopeWhere(scope) };

  // Count and page share a snapshot so deleting the last row cannot strand a page.
  return prisma.$transaction(
    async (tx) => {
      const totalItems = await tx.fileEntry.count({ where });
      const totalPages = Math.max(1, Math.ceil(totalItems / query.pageSize));
      const page = Math.min(query.page, totalPages);
      const rows = await tx.fileEntry.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          entryType: true,
          mimeType: true,
          relativePath: true,
          size: true,
          // A recycled entry is not edited, so its last change is when it was deleted.
          updatedAt: true,
          storageNode: { select: { name: true } },
        },
      });
      const entries = rows.map(({ updatedAt, storageNode, ...entry }) => ({
        ...entry,
        deletedAt: updatedAt,
        storageNodeName: storageNode.name,
      }));
      return {
        entries,
        pagination: { page, pageSize: query.pageSize, totalItems, totalPages },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
