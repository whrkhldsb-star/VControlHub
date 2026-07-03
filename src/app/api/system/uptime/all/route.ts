/**
 * API: GET /api/system/uptime/all
 * 返回所有服务器 90 天的 uptime 数据（含今天）
 */
import { type ServerUptimeSnapshot } from "@prisma/client";
import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";

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

export async function GET(request: NextRequest) {
  return withApiRoute(request, { permission: "server:read" }, async () => {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 89);
    ninetyDaysAgo.setUTCHours(0, 0, 0, 0);

    const servers = await prisma.server.findMany({
      where: { enabled: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
      take: 500,
    });

    const snapshots = await prisma.serverUptimeSnapshot.findMany({
      where: {
        serverId: { in: servers.map((server) => server.id) },
        date: { gte: ninetyDaysAgo },
      },
      orderBy: [{ serverId: "asc" }, { date: "asc" }],
    });

    const snapshotsByServer = new Map<string, ServerUptimeSnapshot[]>();
    for (const snapshot of snapshots) {
      const group = snapshotsByServer.get(snapshot.serverId);
      if (group) {
        group.push(snapshot);
      } else {
        snapshotsByServer.set(snapshot.serverId, [snapshot]);
      }
    }

    const result = servers.map((server) => ({
      id: server.id,
      name: server.name,
      data: (snapshotsByServer.get(server.id) ?? []).map(formatUptimeDay),
    }));

    return NextResponse.json({ servers: result });
  });
}