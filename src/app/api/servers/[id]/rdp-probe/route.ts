import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { NotFoundError } from "@/lib/errors";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { tcpProbe } from "@/lib/server/connectivity";
import { apiCopy } from "@/lib/i18n/api-copy";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 5_000;
const PROBE_CACHE_TTL_MS = 15_000;
const MAX_PROBE_CACHE_ENTRIES = 512;

type ProbeResult = { reachable: boolean; latencyMs: number | null };
const rdpProbeCache = new Map<string, { expiresAt: number; result: ProbeResult }>();
const rdpProbeInFlight = new Map<string, Promise<ProbeResult>>();

/**
 * GET /api/servers/[id]/rdp-probe
 *
 * Windows RDP reachability check for the server card's realtime status chip:
 * a plain TCP connect against host:port (the RDP endpoint, 3389 by default),
 * reusing the health rollup's tcpProbe. No credentials are used and no RDP
 * handshake is attempted — this verifies "the RDP listener answers on the
 * network", not "the logon works". The browser client cannot do this itself
 * (cross-origin raw TCP), so the hub performs the one connect.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return withApiRoute(request, { permission: "server:read", rateLimit: GENERAL_READ_LIMIT }, async ({ session }) => {
    const server = await prisma.server.findFirst({
      where: { AND: [{ id, enabled: true }, serverTeamWhere(session, "read")] },
      select: { id: true, host: true, port: true, operatingSystem: true },
    });
    if (!server || server.operatingSystem !== "WINDOWS") {
      throw new NotFoundError(apiCopy("apiCopy.server.not.found.d7783f94"));
    }

    const cacheKey = `${server.id}:${server.host}:${server.port}`;
    const useCache = process.env.NODE_ENV !== "test";
    const now = Date.now();
    if (useCache) {
      const cached = rdpProbeCache.get(cacheKey);
      if (cached && cached.expiresAt > now) {
        return NextResponse.json(cached.result);
      }
    }

    let pending = rdpProbeInFlight.get(cacheKey);
    if (!pending) {
      pending = (async () => {
        const { ok: reachable, latencyMs } = await tcpProbe(server.host, server.port, PROBE_TIMEOUT_MS);
        const result: ProbeResult = { reachable, latencyMs: reachable ? latencyMs ?? null : null };
        if (useCache) {
          if (rdpProbeCache.size >= MAX_PROBE_CACHE_ENTRIES) {
            const oldest = rdpProbeCache.keys().next().value;
            if (oldest !== undefined) rdpProbeCache.delete(oldest);
          }
          rdpProbeCache.set(cacheKey, { expiresAt: Date.now() + PROBE_CACHE_TTL_MS, result });
        }
        return result;
      })().finally(() => {
        rdpProbeInFlight.delete(cacheKey);
      });
      rdpProbeInFlight.set(cacheKey, pending);
    }

    return NextResponse.json(await pending);
  });
}
