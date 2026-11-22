import { Prisma } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { getReadableStorageScope } from "@/lib/storage/readable-scope";
import { prisma } from "@/lib/db";
import { isGlobalTeamManager, rawServerScope, serverTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { serverCommandCounts, SERVER_PROFILE_INCLUDE } from "./service-profile-includes";
import { enrichServer } from "./service-internals";
import { OPERATION_TARGET_SELECT, operationTargetAvailability } from "./availability";

export const SERVER_PAGE_SIZE = 12;
export type InventoryQuery = { query: string; operatingSystem: "all" | "LINUX" | "WINDOWS"; status: "all" | "enabled" | "disabled"; mode: "all" | "DIRECT" | "AGENT"; page: number };
export function normalizeInventoryQuery(input: Record<string, unknown> = {}): InventoryQuery {
  const page = Number(input.page);
  return {
    operatingSystem: input.operatingSystem === "LINUX" || input.operatingSystem === "WINDOWS" ? input.operatingSystem : "all",
    query: typeof input.query === "string" ? input.query.trim().slice(0, 200) : "",
    status: input.status === "enabled" || input.status === "disabled" ? input.status : "all",
    mode: input.mode === "DIRECT" || input.mode === "AGENT" ? input.mode : "all",
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1,
  };
}

/** A bound drive is visible under the same node and path grants as file listings. */
export async function readableBoundDriveIds(session: TeamSession) {
  const scope = await getReadableStorageScope(session);
  return scope && new Set([...scope.nodesWithoutGrants, ...scope.grantRules.map(rule => rule.storageNodeId)]);
}

/** Count and select from one snapshot; hydrate relations only for the visible page. */
export async function getServerInventory(session: TeamSession, input: Record<string, unknown> = {}) {
  const query = normalizeInventoryQuery(input);
  const scope = rawServerScope(session, "canRead");
  const readable = await readableBoundDriveIds(session);
  const manageStorage = sessionHasPermission(session, "storage:manage-node");
  const visibleNode = readable === null ? Prisma.sql`TRUE` : readable.size ? Prisma.sql`n.id IN (${Prisma.join([...readable])})` : Prisma.sql`FALSE`;
  const pattern = `%${query.query.replace(/[\\%_]/g, "\\$&")}%`;
  const search = query.query ? Prisma.sql`(s.name ILIKE ${pattern} OR s.host ILIKE ${pattern}
    OR EXISTS (SELECT 1 FROM unnest(s.tags) AS tag WHERE tag ILIKE ${pattern}))` : Prisma.sql`TRUE`;
  const status = query.status === "all" ? Prisma.sql`TRUE` : Prisma.sql`s.enabled = ${query.status === "enabled"}`;
  const mode = query.mode === "all" ? Prisma.sql`TRUE` : Prisma.sql`s."managementMode"::text = ${query.mode}`;
  const os = query.operatingSystem === "all" ? Prisma.sql`TRUE` : Prisma.sql`s."operatingSystem"::text = ${query.operatingSystem}`;
  // The snapshot covers what must agree: the counts and the page of ids.
  const { stats, page, ids } = await prisma.$transaction(async (tx) => {
    const [counts] = await tx.$queryRaw<{ total: number; enabled: number; storage: number; matching: number }[]>(Prisma.sql`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE s.enabled)::int AS enabled,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "StorageNode" n WHERE n."serverId" = s.id AND n."teamId" IS NOT DISTINCT FROM s."teamId" AND ${visibleNode})
          OR EXISTS (SELECT 1 FROM agent_file_shares sh JOIN "StorageNode" n ON n.id = sh."storageNodeId" WHERE ${visibleNode} AND n."teamId" IS NOT DISTINCT FROM s."teamId" AND sh."serverId" = s.id AND sh."teamId" IS NOT DISTINCT FROM s."teamId"))::int AS storage,
        count(*) FILTER (WHERE ${search} AND ${status} AND ${mode} AND ${os})::int AS matching
      FROM servers s WHERE ${scope}`);
    const stats = counts!;
    const page = Math.min(query.page, Math.max(1, Math.ceil(stats.matching / SERVER_PAGE_SIZE)));
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT s.id FROM servers s
      WHERE ${scope} AND ${search} AND ${status} AND ${mode} AND ${os}
      ORDER BY s."createdAt" DESC, s.id DESC LIMIT ${SERVER_PAGE_SIZE} OFFSET ${(page - 1) * SERVER_PAGE_SIZE}`);
    return { stats, page, ids };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  // Hydrated after the snapshot: Prisma loads an include's relations in
  // parallel, and inside an interactive transaction they all queue on its one
  // connection — pg warns "Calling client.query() when the client is already
  // executing a query" (pg 9 will refuse it). A server deleted in between is
  // simply not shown.
  const rows = ids.length ? await prisma.server.findMany({
    where: { AND: [serverTeamWhere(session), { id: { in: ids.map(({ id }) => id) } }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: SERVER_PROFILE_INCLUDE,
  }) : [];
  // Customer accounts may not edit servers the platform assigned to them.
  const customerAccount = !isGlobalTeamManager(session);
  const counts = await serverCommandCounts(rows, session);
  const servers = rows.map((row) => {
    const node = row.storageNode;
    const storageNode = node && node.teamId === row.teamId && (!readable || readable.has(node.id))
      ? manageStorage ? node : { ...node, host: null, port: null, username: null, hostKeySha256: null, basePath: "", publicBaseUrl: null }
      : null;
    const server = enrichServer({ ...row, storageNode, agentFileShares: row.agentFileShares?.filter(share => share.teamId === row.teamId && share.node.teamId === row.teamId && (!readable || readable.has(share.node.id))) }, counts.get(row.id));
    return {
      ...server,
      // The server also stores a copy of its file gateway's public endpoint.
      directGateway: manageStorage && (!node || storageNode) ? server.directGateway
        : { ...server.directGateway, publicUrl: null, port: 0 },
      // Customer accounts only ever see their own customer; name it for administrators.
      teamName: customerAccount ? null : server.teamName,
      profileLocked: customerAccount && server.origin === "PLATFORM",
      canTransfer: !customerAccount,
    };
  });
  return { servers, stats, query: { ...query, page }, pageSize: SERVER_PAGE_SIZE, loadedAt: Date.now() };
}
export type ServerInventoryData = Awaited<ReturnType<typeof getServerInventory>>;

/** Only requested when an operation panel opens; no profiles, keys or history sent. */
export async function getServerOperationTargets(session: TeamSession, kind: "command" | "batch", input: Record<string, unknown> = {}) {
  const query = normalizeInventoryQuery(input);
  const pageSize = 24;
  const capability = kind === "command" ? "connect" : "manage";
  const scope = rawServerScope(session, capability === "connect" ? "canConnect" : "canManage");
  const pattern = `%${query.query.replace(/[\\%_]/g, "\\$&")}%`;
  const search = query.query ? Prisma.sql`(s.name ILIKE ${pattern} OR s.host ILIKE ${pattern}
    OR EXISTS (SELECT 1 FROM unnest(s.tags) AS tag WHERE tag ILIKE ${pattern}))` : Prisma.sql`TRUE`;
  const enabled = kind === "command" ? Prisma.sql`s.enabled` : Prisma.sql`TRUE`;
  return prisma.$transaction(async (tx) => {
  const [stats] = await tx.$queryRaw<{ matching: number; enabled: number }[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE ${search} AND ${enabled})::int AS matching,
      count(*) FILTER (WHERE s.enabled)::int AS enabled FROM servers s WHERE ${scope}`);
  const page = Math.min(query.page, Math.max(1, Math.ceil(stats!.matching / pageSize)));
  const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT s.id FROM servers s
    WHERE ${scope} AND ${search} AND ${enabled} ORDER BY s.name ASC, s.id ASC
    LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`);
  const rows = ids.length ? await tx.server.findMany({
    where: { AND: [serverTeamWhere(session, capability), { id: { in: ids.map(({ id }) => id) } }] },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, host: true, enabled: true, ...OPERATION_TARGET_SELECT },
  }) : [];
  const targets = rows.map((server) => {
    const availability = operationTargetAvailability(server);
    return { id: server.id, name: server.name, host: server.host, enabled: server.enabled,
      available: availability.available, reason: availability.reason };
  });
  return { rows: targets, total: stats!.matching, enabledCount: stats!.enabled, page, pageSize };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
