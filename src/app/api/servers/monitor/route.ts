import { prisma } from "@/lib/db";
import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { collectServerMetrics } from "@/lib/server/monitor";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";

const serverMonitorQuerySchema = z.object({
  serverId: z.string().trim().min(1, "Missing serverId"),
});

/**
 * A DIRECT node's probe is a real SSH login plus the sampling script. Every
 * open server page probed each visible card on its own timer (A12-01); one
 * probe now serves every caller for a short while, and the route is limited.
 */
const MONITOR_CACHE_MS = 30_000;
const monitorCache = new Map<string, { at: number; value: Promise<Awaited<ReturnType<typeof collectServerMetrics>>> }>();

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "server:read", rateLimit: GENERAL_READ_LIMIT, errorMessage: apiCopy("apiCopy.server.error.dfe0c2e8") },
    async ({ session }) => {
      const { serverId } = parseSearchParams(request, serverMonitorQuerySchema);
      const teamAccess = await assertServerTeamAccess(session, serverId);
      if (!teamAccess.ok) return teamAccess.response;

      const now = Date.now();
      const endpoint = teamAccess.server;
      const key = JSON.stringify([serverId, endpoint.teamId, endpoint.host, endpoint.port, endpoint.username,
        endpoint.hostKeySha256, endpoint.managementMode, endpoint.agentTokenHash]);
      const cached = monitorCache.get(key);
      let value = cached?.value;
      if (!cached || !value || now - cached.at >= MONITOR_CACHE_MS) {
        value = collectServerMetrics(serverId, undefined, endpoint);
        monitorCache.set(key, { at: now, value });
        value.catch(() => { if (monitorCache.get(key)?.value === value) monitorCache.delete(key); });
        if (monitorCache.size > 500) monitorCache.delete(monitorCache.keys().next().value!);
      }
      const metrics = await value;
      const current = await prisma.server.findUnique({ where: { ...endpoint, enabled: true }, select: { id: true } });
      if (!current) return NextResponse.json({ error: apiCopy("apiCopy.server.not.found.d7783f94") }, { status: 404 });
      return NextResponse.json(metrics);
    },
  );
}
