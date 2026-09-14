import { z } from "zod";
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { normalizeStorageTargetDirectory } from "@/lib/storage/path-utils";

export const recycleBinQuerySchema = z.object({
  page: z.coerce.number().int().min(1).max(1_000_000).catch(1),
  pageSize: z.coerce.number().int().min(1).max(200).catch(50),
});

/**
 * Compute the set of read-allowed path predicates for a session across the
 * team-visible storage nodes. Returns null when filtering is not needed
 * (storage managers / full-node readers), otherwise an array of allowed
 * node+prefix rules that both the count and the page query must apply.
 */
async function getReadableScope(
  session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<
  | null
  | {
      nodesWithoutGrants: string[];
      grantRules: Array<{ storageNodeId: string; pathPrefix: string }>;
    }
> {
  if (sessionHasPermission(session, "storage:manage-node")) {
    return null;
  }

  const nodeScope = teamWhere(session);
  const nodes = await prisma.storageNode.findMany({
    where: nodeScope,
    select: { id: true },
  });
  const nodeIds = nodes.map((node) => node.id);
  if (nodeIds.length === 0) {
    return { nodesWithoutGrants: [], grantRules: [] };
  }

  const grants: Array<{ storageNodeId: string; pathPrefix: string; canRead: boolean }> = [];
  let grantCursor: { id: string } | undefined;
  do {
    const page = await prisma.userStorageAccess.findMany({
      where: { userId: session.userId, storageNodeId: { in: nodeIds } },
      orderBy: { id: "asc" },
      take: 500,
      select: { id: true, storageNodeId: true, pathPrefix: true, canRead: true },
      ...(grantCursor ? { cursor: grantCursor, skip: 1 } : {}),
    });
    grants.push(...page);
    grantCursor = page.length === 500 ? { id: page[page.length - 1]!.id } : undefined;
  } while (grantCursor);

  const readable = grants.filter((grant) => grant.canRead);
  // Nodes where the user holds at least one read grant: on those nodes only
  // the granted prefixes are visible. Nodes without any grant contribute
  // nothing (no legacy fallback for the recycle bin — it exposes metadata).
  const grantRules = readable.map((grant) => ({
    storageNodeId: grant.storageNodeId,
    pathPrefix: normalizePathPrefix(grant.pathPrefix),
  }));

  return { nodesWithoutGrants: [], grantRules };
}

function normalizePathPrefix(value: string): string {
  const result = normalizeStorageTargetDirectory(value);
  return result.ok ? result.path : "";
}

/** Prisma `where` fragment matching entries visible under at least one grant rule. */
function scopeWhere(
  scope: { nodesWithoutGrants: string[]; grantRules: Array<{ storageNodeId: string; pathPrefix: string }> },
) {
  if (scope.nodesWithoutGrants.length === 0 && scope.grantRules.length === 0) {
    // Nothing readable — match no rows.
    return { id: "" } as const;
  }
  const or: Array<Record<string, unknown>> = scope.nodesWithoutGrants.map((storageNodeId) => ({ storageNodeId }));
  for (const rule of scope.grantRules) {
    or.push(
      rule.pathPrefix
        ? {
            storageNodeId: rule.storageNodeId,
            OR: [
              { relativePath: rule.pathPrefix },
              { relativePath: { startsWith: `${rule.pathPrefix}/` } },
            ],
          }
        : { storageNodeId: rule.storageNodeId },
    );
  }
  return { OR: or };
}

export async function getRecycleBinPage(
  session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
  query: z.infer<typeof recycleBinQuerySchema>,
) {
  const scope = await getReadableScope(session);
  const where =
    scope === null
      ? { isDeleted: true, storageNode: teamWhere(session) }
      : { isDeleted: true, storageNode: teamWhere(session), ...scopeWhere(scope) };

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
