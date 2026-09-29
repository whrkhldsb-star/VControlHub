import { NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { NotFoundError } from "@/lib/errors";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { tcpProbe } from "@/lib/server/connectivity";
import { apiCopy } from "@/lib/i18n/api-copy";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 5_000;

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
  return withApiRoute(request, { requireAuth: true }, async ({ session }) => {
    const server = await prisma.server.findFirst({
      where: { AND: [{ id, enabled: true }, serverTeamWhere(session, "read")] },
      select: { id: true, host: true, port: true, operatingSystem: true },
    });
    if (!server || server.operatingSystem !== "WINDOWS") {
      throw new NotFoundError(apiCopy("apiCopy.server.not.found.b3aa1f7c"));
    }

    const { ok: reachable, latencyMs } = await tcpProbe(
      server.host,
      server.port,
      PROBE_TIMEOUT_MS,
    );

    return NextResponse.json({ reachable, latencyMs: reachable ? latencyMs ?? null : null });
  });
}
