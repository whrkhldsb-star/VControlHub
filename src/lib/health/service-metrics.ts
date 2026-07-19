import { prisma } from "@/lib/db";
import type { HealthOverview } from "./service-types";

export async function snapshotMetrics(serverId: string, cpu: number, mem: number, diskMax: number, isOnline: boolean) {
  return prisma.metricSnapshot.create({
    data: { serverId, cpuUsage: cpu, memUsage: mem, diskUsage: diskMax, isOnline },
  });
}

/**
 * Persist one fleet sample in a single batch.
 *
 * Offline nodes are explicit discontinuities (`isOnline=false`).
 * Warning nodes without metrics (TCP up, SSH auth/command failed) are also
 * recorded as offline samples — otherwise the chart/status page looks like
 * the host "vanished" after the last successful poll, even though health
 * collection still runs every few minutes.
 */
export async function snapshotHealthOverview(overview: HealthOverview) {
  const data = overview.servers.flatMap((server) => {
    if (!server.enabled) return [];
    if (server.status === "offline") {
      return [{ serverId: server.serverId, cpuUsage: 0, memUsage: 0, diskUsage: 0, isOnline: false }];
    }
    // SSH auth / collect failure still means "not online for metrics".
    if (server.cpu === undefined || server.mem === undefined || server.diskMax === undefined) {
      if (server.status === "warning" || server.status === "unknown") {
        return [{ serverId: server.serverId, cpuUsage: 0, memUsage: 0, diskUsage: 0, isOnline: false }];
      }
      return [];
    }
    return [{
      serverId: server.serverId,
      cpuUsage: server.cpu,
      memUsage: server.mem,
      diskUsage: server.diskMax,
      isOnline: true,
    }];
  });
  if (data.length === 0) return { count: 0 };
  return prisma.metricSnapshot.createMany({ data });
}

export async function pruneMetricSnapshots(olderThan: Date) {
  return prisma.metricSnapshot.deleteMany({ where: { createdAt: { lt: olderThan } } });
}

export async function getMetricHistory(serverId: string, hours: number = 24) {
  const normalizedHours = Math.min(Math.max(Math.floor(hours), 1), 168);
  const since = new Date(Date.now() - normalizedHours * 3_600_000);
  return prisma.metricSnapshot.findMany({
    where: { serverId, createdAt: { gte: since } },
    orderBy: { createdAt: "asc" },
    select: { cpuUsage: true, memUsage: true, diskUsage: true, isOnline: true, createdAt: true },
    take: Math.min(2_100, normalizedHours * 12 + 12),
  });
}
