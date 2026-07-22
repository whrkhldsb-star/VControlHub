import { type ServerUptimeSnapshot } from "@prisma/client";

import { teamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";

interface UptimeDay {
  date: string;
  uptimePercent: number;
  onlineMinutes: number;
  offlineMinutes: number;
  checkCount: number;
}

function formatUptimeDay(
  snapshot: Pick<
    ServerUptimeSnapshot,
    "date" | "uptimePercent" | "onlineMinutes" | "offlineMinutes" | "checkCount"
  >,
): UptimeDay {
  return {
    date: snapshot.date.toISOString().split("T")[0] ?? "",
    uptimePercent: snapshot.uptimePercent,
    onlineMinutes: snapshot.onlineMinutes,
    offlineMinutes: snapshot.offlineMinutes,
    checkCount: snapshot.checkCount,
  };
}

export type UptimeListOptions = {
  /**
   * When provided, list is filtered with the same teamWhere rules as server lists.
   * Omit/null for public status page (fleet-wide display names only, no host/port).
   */
  session?: TeamSession | null;
};

/**
 * Shared uptime heatmap data (90 days, enabled servers).
 * Authenticated call sites must pass `session` so non-admin users only see
 * their team (+ legacy null teamId) nodes.
 */
export async function getAllUptimeDataInternal(options: UptimeListOptions = {}) {
  const ninetyDaysAgo = new Date();
  ninetyDaysAgo.setUTCDate(ninetyDaysAgo.getUTCDate() - 89);
  ninetyDaysAgo.setUTCHours(0, 0, 0, 0);

  const teamFilter = options.session ? teamWhere(options.session) : {};

  const servers = await prisma.server.findMany({
    where: { enabled: true, ...teamFilter },
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
    take: 5000,
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

  return { servers: result };
}
