import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * API: GET /api/system/uptime/all
 * 返回当前会话可见服务器 90 天的 uptime 数据（含今天）
 */
import { NextRequest, NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { getAllUptimeDataInternal } from "@/lib/uptime/internal";

export async function GET(request: NextRequest) {
  return withApiRoute(request, { permission: "server:read" }, async ({ session }) => {
    if (!session) {
      return NextResponse.json({ error: apiCopy("apiCopy.unauthorized.d089c8a9") }, { status: 401 });
    }
    const result = await getAllUptimeDataInternal({ session });
    return NextResponse.json(result);
  });
}
