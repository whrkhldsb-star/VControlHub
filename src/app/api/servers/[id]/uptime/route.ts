/**
 * API: GET /api/servers/[id]/uptime
 * 返回某台服务器 90 天的 uptime 数据（含今天）
 */
import { type ServerUptimeSnapshot } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { assertServerTeamAccess } from "@/lib/server/team-access";

interface UptimeDay {
  date: string;
  uptimePercent: number;
  onlineMinutes: number;
  offlineMinutes: number;
  checkCount: number;
}

function formatUptimeDay(snapshot: Pick<ServerUptimeSnapshot, "date" | "uptimePercent" | "onlineMinutes" | "offlineMinutes" | "checkCount">): UptimeDay {
  return {
    date: snapshot.date.toISOString().split("T")[0] ?? "",
    uptimePercent: snapshot.uptimePercent,
    onlineMinutes: snapshot.onlineMinutes,
    offlineMinutes: snapshot.offlineMinutes,
    checkCount: snapshot.checkCount,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  return withApiRoute(request, { permission: "server:read" }, async ({ session }) => {
    const { id } = await params;
    const teamAccess = await assertServerTeamAccess(session, id);
    if (!teamAccess.ok) return teamAccess.response;
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 89);
    ninetyDaysAgo.setUTCHours(0, 0, 0, 0);

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