import { z } from "zod";
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";

export const recycleBinQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).catch(1),
  pageSize: z.coerce.number().int().min(1).max(200).catch(50),
});

export async function getRecycleBinPage(
  session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
  query: z.infer<typeof recycleBinQuerySchema>,
) {
  const where = { isDeleted: true, storageNode: teamWhere(session) };
  // Count and page share a snapshot so deleting the last row cannot strand a page.
  return prisma.$transaction(
    async (tx) => {
      const totalItems = await tx.fileEntry.count({ where });
      const totalPages = Math.max(1, Math.ceil(totalItems / query.pageSize));
      const page = Math.min(query.page, totalPages);
      const entries = await tx.fileEntry.findMany({
        where,
        orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
        skip: (page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          name: true,
          entryType: true,
          relativePath: true,
          size: true,
        },
      });
      return {
        entries,
        pagination: { page, pageSize: query.pageSize, totalItems, totalPages },
      };
    },
    { isolationLevel: "RepeatableRead" },
  );
}
