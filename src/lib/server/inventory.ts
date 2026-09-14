import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isGlobalTeamManager, serverTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { SERVER_PROFILE_INCLUDE } from "./service-profile-includes";
import { enrichServer } from "./service-internals";
import { getServerTargetAvailability } from "./availability";

export const SERVER_PAGE_SIZE = 12;
export type InventoryQuery = { query: string; status: "all" | "enabled" | "disabled"; mode: "all" | "DIRECT" | "AGENT"; page: number };
export function normalizeInventoryQuery(input: Record<string, unknown> = {}): InventoryQuery {
  const page = Number(input.page);
  return {
    query: typeof input.query === "string" ? input.query.trim().slice(0, 200) : "",
    status: input.status === "enabled" || input.status === "disabled" ? input.status : "all",
    mode: input.mode === "DIRECT" || input.mode === "AGENT" ? input.mode : "all",
    page: Number.isSafeInteger(page) && page > 0 ? Math.min(page, 1_000_000) : 1,
  };
}

/** Count and select from one snapshot; hydrate relations only for the visible page. */
export async function getServerInventory(session: TeamSession, input: Record<string, unknown> = {}) {
  const query = normalizeInventoryQuery(input);
  const scope = isGlobalTeamManager(session) ? Prisma.sql`TRUE`
    : session.currentTeamId ? Prisma.sql`s."teamId" = ${session.currentTeamId}` : Prisma.sql`FALSE`;
  const pattern = `%${query.query.replace(/[\\%_]/g, "\\$&")}%`;
  const search = query.query ? Prisma.sql`(s.name ILIKE ${pattern} OR s.host ILIKE ${pattern}
    OR EXISTS (SELECT 1 FROM unnest(s.tags) AS tag WHERE tag ILIKE ${pattern}))` : Prisma.sql`TRUE`;
  const status = query.status === "all" ? Prisma.sql`TRUE` : Prisma.sql`s.enabled = ${query.status === "enabled"}`;
  const mode = query.mode === "all" ? Prisma.sql`TRUE` : Prisma.sql`s."managementMode"::text = ${query.mode}`;
  return prisma.$transaction(async (tx) => {
    const [counts] = await tx.$queryRaw<{ total: number; enabled: number; storage: number; matching: number }[]>(Prisma.sql`
      SELECT count(*)::int AS total, count(*) FILTER (WHERE s.enabled)::int AS enabled,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM "StorageNode" n WHERE n."serverId" = s.id))::int AS storage,
        count(*) FILTER (WHERE ${search} AND ${status} AND ${mode})::int AS matching
      FROM servers s WHERE ${scope}`);
    const stats = counts!;
    const page = Math.min(query.page, Math.max(1, Math.ceil(stats.matching / SERVER_PAGE_SIZE)));
    const ids = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT s.id FROM servers s
      WHERE ${scope} AND ${search} AND ${status} AND ${mode}
      ORDER BY s."createdAt" DESC, s.id DESC LIMIT ${SERVER_PAGE_SIZE} OFFSET ${(page - 1) * SERVER_PAGE_SIZE}`);
    const rows = ids.length ? await tx.server.findMany({
      where: { AND: [serverTeamWhere(session), { id: { in: ids.map(({ id }) => id) } }] },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], include: SERVER_PROFILE_INCLUDE,
    }) : [];
    return { servers: rows.map(enrichServer), stats, query: { ...query, page }, pageSize: SERVER_PAGE_SIZE, loadedAt: Date.now() };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
export type ServerInventoryData = Awaited<ReturnType<typeof getServerInventory>>;

/** Only requested when an operation panel opens; no profiles, keys or history sent. */
export async function getServerOperationTargets(session: TeamSession, kind: "command" | "batch", input: Record<string, unknown> = {}) {
  const query = normalizeInventoryQuery(input);
  const pageSize = 24;
  const scope = isGlobalTeamManager(session) ? Prisma.sql`TRUE`
    : session.currentTeamId ? Prisma.sql`s."teamId" = ${session.currentTeamId}` : Prisma.sql`FALSE`;
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
    where: { AND: [serverTeamWhere(session), { id: { in: ids.map(({ id }) => id) } }] },
    orderBy: [{ name: "asc" }, { id: "asc" }],
    select: { id: true, name: true, host: true, enabled: true, onboardingStatus: true,
      managementMode: true, agentLastSeenAt: true, connectionType: true, password: true,
      sshKey: { select: { id: true } }, metricSnapshots: { orderBy: { createdAt: "desc" }, take: 1, select: { isOnline: true, createdAt: true } } },
  }) : [];
  const targets = rows.map((server) => {
    const availability = getServerTargetAvailability({ onboardingStatus: server.onboardingStatus,
      managementMode: server.managementMode, agentLastSeenAt: server.agentLastSeenAt,
      hasSshCredential: Boolean(server.connectionType === "SSH_KEY" ? server.sshKey : server.password),
      latestMetric: server.metricSnapshots[0] ?? null });
    return { id: server.id, name: server.name, host: server.host, enabled: server.enabled,
      available: availability.available, reason: availability.reason };
  });
  return { rows: targets, total: stats!.matching, enabledCount: stats!.enabled, page, pageSize };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
