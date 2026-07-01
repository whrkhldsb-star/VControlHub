/**
 * API: GET /api/system/uptime/all
 * 返回所有服务器 90 天的 uptime 数据（含今天）
 */
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

interface UptimeDay {
  date: string;
  uptimePercent: number;
  onlineMinutes: number;
  offlineMinutes: number;
  checkCount: number;
}

export async function GET(request: NextRequest) {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 89);
  ninetyDaysAgo.setUTCHours(0, 0, 0, 0);

  try {
    const servers = await prisma.server.findMany({
      where: { enabled: true },
      select: { id: true, name: true },
    });

    const result = await Promise.all(
      servers.map(async (server: any) => {
        const snapshots = await prisma.serverUptimeSnapshot.findMany({
          where: {
            serverId: server.id,
            date: {
              gte: ninetyDaysAgo,
            },
          },
          orderBy: { date: "asc" },
        });

        const data: UptimeDay[] = snapshots.map((s: any) => ({
          date: s.date.toISOString().split("T")[0],
          uptimePercent: s.uptimePercent,
          onlineMinutes: s.onlineMinutes,
          offlineMinutes: s.offlineMinutes,
          checkCount: s.checkCount,
        }));

        return {
          id: server.id,
          name: server.name,
          data,
        };
      }),
    );

    return NextResponse.json({ servers: result });
  } catch (err) {
    console.error("Failed to fetch uptime data:", err);
    return NextResponse.json(
      { error: "Failed to fetch uptime data" },
      { status: 500 },
    );
  }
}