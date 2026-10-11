/**
 * API: GET /api/servers/[id]/uptime
 * 返回某台服务器 90 天的 uptime 数据（含今天）
 */
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { shiftAppTimeZoneDay } from "@/lib/datetime/time-zone";
import { formatUptimeDay } from "@/lib/uptime/internal";
import { withApiRoute } from "@/lib/http/api-guard";
import { assertServerTeamAccess } from "@/lib/server/team-access";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(request, { permission: "server:read" }, async ({ session }) => {
    const { id } = await params;
    const teamAccess = await assertServerTeamAccess(session, id);
    if (!teamAccess.ok) return teamAccess.response;
    // Day buckets follow the application clock, like the rollup that writes them.
    const ninetyDaysAgo = shiftAppTimeZoneDay(new Date(), -89);

    const snapshots = await prisma.serverUptimeSnapshot.findMany({
      where: {
        serverId: id,
        date: {
          gte: ninetyDaysAgo,
        },
      },
      orderBy: { date: "asc" },
      take: 90,
    });

    return NextResponse.json({ data: snapshots.map(formatUptimeDay) });
  });
}