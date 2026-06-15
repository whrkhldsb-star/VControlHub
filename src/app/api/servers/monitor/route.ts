import { NextResponse } from "next/server";
import { z } from "zod";

import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { collectServerMetrics } from "@/lib/server/monitor";

export const dynamic = "force-dynamic";

const serverMonitorQuerySchema = z.object({
  serverId: z.string().trim().min(1, "缺少 serverId"),
});

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "server:read", errorMessage: "服务器错误" },
    async () => {
      const { serverId } = parseSearchParams(request, serverMonitorQuerySchema);

      const result = await collectServerMetrics(serverId);
      return NextResponse.json(result);
    },
  );
}
