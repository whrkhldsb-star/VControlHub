import { NextResponse } from "next/server";
import { z } from "zod";

import { serverTeamWhere } from "@/lib/auth/team-scope";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { prisma } from "@/lib/db";

const trafficHistoryQuerySchema = z.object({
  iface: z.string().trim().min(1).max(64).optional(),
  source: z.enum(["local", "server"]).optional(),
  hours: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      const parsed = Number.parseInt(value ?? "24", 10);
      if (!Number.isFinite(parsed)) return 24;
      return Math.min(Math.max(parsed, 1), 168);
    }),
});

/** Hard cap on rows returned per request; see the orderBy comment below. */
const HISTORY_ROW_LIMIT = 5000;

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "server:read", errorMessage: "Failed to fetch traffic history" },
    async ({ session }) => {
      const { iface, source, hours } = parseSearchParams(request, trafficHistoryQuerySchema);
      const since = new Date(Date.now() - hours * 3600_000);
      // Multi-tenant: remote samples are tagged with serverId; only return
      // samples for servers visible to the caller (+ local hub samples). Strict
      // `serverTeamWhere`, matching /api/traffic/summary: a null-team server is
      // quarantined legacy data, so neither its id nor its traffic curve is
      // handed to every tenant.
      const teamFilter = session ? serverTeamWhere(session) : {};
      const visibleServers = session
        ? await prisma.server.findMany({
            where: teamFilter,
            select: { id: true },
            take: 5000,
          })
        : [];
      const visibleServerIds = visibleServers.map((s) => s.id);
      const rows = await prisma.trafficSnapshot.findMany({
        where: {
          sampledAt: { gte: since },
          ...(source ? { source } : {}),
          ...(iface ? { iface } : {}),
          ...(session
            ? {
                OR: [
                  { serverId: null }, // local hub NIC samples
                  ...(visibleServerIds.length > 0
                    ? [{ serverId: { in: visibleServerIds } }]
                    : []),
                ],
              }
            : {}),
        },
        // Newest rows in the window, re-sorted ascending for the chart below.
        // `asc` + `take` returned the OLDEST rows instead: local samples land
        // every 5 minutes and the health collector adds one row per server per
        // tick, so a 7-day request on a modest fleet passes the cap after ~1.5
        // days — the chart silently ended days in the past while its own hint
        // claimed "the last 7 days", and the client only ever renders the tail.
        // Same truncation `service-collect.ts` had to fix for monthly traffic.
        orderBy: { sampledAt: "desc" },
        take: HISTORY_ROW_LIMIT,
        select: {
          source: true,
          serverId: true,
          iface: true,
          rxBytes: true,
          txBytes: true,
          rxRateBps: true,
          txRateBps: true,
          sampledAt: true,
        },
      });

      return NextResponse.json({
        history: rows.reverse().map((row) => ({
          source: row.source,
          serverId: row.serverId,
          iface: row.iface,
          rx: Number(row.rxRateBps),
          tx: Number(row.txRateBps),
          rxBytes: row.rxBytes.toString(),
          txBytes: row.txBytes.toString(),
          t: row.sampledAt.toISOString(),
        })),
      });
    },
  );
}
