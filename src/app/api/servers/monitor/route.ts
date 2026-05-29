import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { collectServerMetrics } from "@/lib/server/monitor";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return withApiRoute(
    request,
    { permission: "server:read", errorMessage: "服务器错误" },
    async () => {
      const { searchParams } = new URL(request.url);
      const serverId = searchParams.get("serverId");
      if (!serverId)
        return NextResponse.json({ error: "缺少 serverId" }, { status: 400 });

      const result = await collectServerMetrics(serverId);
      return NextResponse.json(result);
    },
  );
}
