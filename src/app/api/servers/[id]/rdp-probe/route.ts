import { NextResponse } from "next/server";
import { connect } from "node:net";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { NotFoundError } from "@/lib/errors";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { apiCopy } from "@/lib/i18n/api-copy";

export const dynamic = "force-dynamic";

const PROBE_TIMEOUT_MS = 5_000;

/**
 * GET /api/servers/[id]/rdp-probe
 *
 * Windows RDP reachability check for the server card's realtime status chip:
 * a plain TCP connect against host:port (the RDP endpoint, 3389 by default).
 * No credentials are used and no RDP handshake is attempted — this verifies
 * "the RDP listener answers on the network", not "the logon works". The
 * browser client cannot do this itself (cross-origin raw TCP), so the hub
 * performs the one connect and reports latency.
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

    const startedAt = Date.now();
    const reachable = await new Promise<boolean>((resolve) => {
      const socket = connect({ host: server.host, port: server.port });
      const finish = (ok: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(ok);
      };
      socket.setTimeout(PROBE_TIMEOUT_MS, () => finish(false));
      socket.once("connect", () => finish(true));
      socket.once("error", () => finish(false));
    });

    return NextResponse.json({
      reachable,
      latencyMs: reachable ? Date.now() - startedAt : null,
    });
  });
}
