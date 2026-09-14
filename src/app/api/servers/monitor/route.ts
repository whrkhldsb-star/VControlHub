import { apiCopy } from "@/lib/i18n/api-copy";
import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { collectServerMetrics } from "@/lib/server/monitor";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export const dynamic = "force-dynamic";

const serverMonitorQuerySchema = z.object({
  serverId: z.string().trim().min(1, "Missing serverId"),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "server:read", errorMessage: apiCopy("apiCopy.server.error.dfe0c2e8") },
    async ({ session }) => {
      const { serverId } = parseSearchParams(request, serverMonitorQuerySchema);
      const teamAccess = await assertServerTeamAccess(session, serverId);
      if (!teamAccess.ok) return teamAccess.response;

      const result = await collectServerMetrics(serverId, request.signal);
      return NextResponse.json(result);
    },
  );
}
