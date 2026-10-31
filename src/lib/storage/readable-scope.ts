import { Prisma } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, storageNodeTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { normalizeStorageTargetDirectory } from "@/lib/storage/path-utils";

export type ReadableStorageScope = {
  nodesWithoutGrants: string[];
  grantRules: Array<{ storageNodeId: string; pathPrefix: string }>;
};

/**
 * Compute the set of read-allowed path predicates for a session across the
 * team-visible storage nodes, for listings (assertStorageAccess decides one
 * path the same way). Returns null when filtering is not needed (storage
 * managers / full-node readers), otherwise the allowed node+prefix rules that
 * every query of a listing (page, count, facets) must apply.
 */
export async function getReadableStorageScope(
  session: TeamSession,
): Promise<ReadableStorageScope | null> {
  if (isGlobalTeamManager(session) || sessionHasPermission(session, "storage:manage-node")) {
    return null;
  }

  const nodeScope = storageNodeTeamWhere(session);
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

  // A node without any grant is not narrowed: all of it is visible. On a node
  // with grants only the readable granted prefixes are.
  const narrowedNodeIds = new Set(grants.map((grant) => grant.storageNodeId));
  const nodesWithoutGrants = sessionHasPermission(session, "storage:read")
    ? nodeIds.filter((id) => !narrowedNodeIds.has(id))
    : [];
  const readable = grants.filter((grant) => grant.canRead);
  const grantRules = readable.flatMap((grant) => {
    const prefix = normalizeStorageTargetDirectory(grant.pathPrefix);
    // An invalid grant must not turn into the empty (whole-node) prefix.
    return prefix.ok ? [{ storageNodeId: grant.storageNodeId, pathPrefix: prefix.path }] : [];
  });

  return { nodesWithoutGrants, grantRules };
}

/**
 * Prisma `where` fragment (models keyed by storageNodeId + relativePath: file
 * entries, media items) matching rows visible under at least one grant rule.
 * It carries its own OR (or id): compose it with AND where the query has its own.
 */
/** SQL equivalent for raw listing/count queries. Identifiers are fixed here,
 * never interpolated from a request. Filter entries before deriving folders. */
export function readableStorageScopeSql(scope?: ReadableStorageScope | null): Prisma.Sql {
  if (!scope) return Prisma.sql`TRUE`;
  const predicates = [
    ...scope.nodesWithoutGrants.map((nodeId) => Prisma.sql`"storageNodeId" = ${nodeId}`),
    ...scope.grantRules.map((rule) => rule.pathPrefix
      ? Prisma.sql`("storageNodeId" = ${rule.storageNodeId} AND ("relativePath" = ${rule.pathPrefix} OR starts_with("relativePath", ${rule.pathPrefix + "/"})))`
      : Prisma.sql`"storageNodeId" = ${rule.storageNodeId}`),
  ];
  return predicates.length ? Prisma.sql`(${Prisma.join(predicates, " OR ")})` : Prisma.sql`FALSE`;
}

/** Ancestors may be traversed to reach a grant, but may not be synchronized. */
export function readableStoragePath(scope: ReadableStorageScope | null, nodeId: string, path: string, allowAncestor = false): boolean {
  if (!scope || scope.nodesWithoutGrants.includes(nodeId)) return true;
  return scope.grantRules.some((rule) => rule.storageNodeId === nodeId && (
    !rule.pathPrefix || path === rule.pathPrefix || path.startsWith(rule.pathPrefix + "/")
    || (allowAncestor && (!path || rule.pathPrefix.startsWith(path + "/")))
  ));
}

export function readableStorageScopeWhere(scope: ReadableStorageScope) {
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
              { relativePath: { startsWith: escapeLikeLiteral(`${rule.pathPrefix}/`) } },
            ],
          }
        : { storageNodeId: rule.storageNodeId },
    );
  }
  return { OR: or };
}
