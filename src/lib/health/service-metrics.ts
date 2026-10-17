import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { normalizeServerMetrics } from "@/lib/public-status/normalize";
import { writeLatestMetrics, type LatestMetricInput } from "@/lib/public-status/latest-writer";
import type { HealthOverview, ServerHealth } from "./service-types";
import { HEALTH_SAMPLE_INTERVAL_MINUTES } from "./service-types";

const logger = createLogger("health-metrics");

async function teamIdByServerIds(serverIds: string[]): Promise<Map<string, string | null>> {
  if (serverIds.length === 0) return new Map();
  const rows = await prisma.server.findMany({
    where: { id: { in: serverIds } },
    select: { id: true, teamId: true },
  });
  return new Map(rows.map((r) => [r.id, r.teamId ?? null]));
}

function probeColumns(server: ServerHealth) {
  if (server.probeStatus === "ok") {
    return { probeStatus: "ok", probeLatencyMs: typeof server.latencyMs === "number" ? server.latencyMs : null };
  }
  if (server.probeStatus === "failed") return { probeStatus: "failed", probeLatencyMs: null };
  return { probeStatus: null, probeLatencyMs: null };
}

/** The normalised "latest" row for one checked server (see server_metric_latest). */
export function latestMetricInput(server: ServerHealth, checkedAt: Date, intervalSeconds: number): LatestMetricInput | null {
  if (!server.enabled) return null;
  const probe = server.probeStatus
    ? { at: checkedAt, ok: server.probeStatus === "ok", latencyMs: server.probeStatus === "ok" && typeof server.latencyMs === "number" ? server.latencyMs : null }
    : null;
  const sampledAt = server.metrics ? new Date(server.metrics.timestamp) : null;
  if (server.metrics && sampledAt && Number.isFinite(sampledAt.getTime())) {
    return {
      serverId: server.serverId,
      checkedAt,
      online: true,
      intervalSeconds,
      metrics: { sampledAt, source: server.metrics.source ?? "ssh", values: normalizeServerMetrics(server.metrics) },
      probe,
    };
  }
  if (server.status === "offline" || server.status === "warning" || server.status === "unknown") {
    return {
      serverId: server.serverId,
      checkedAt,
      online: false,
      offlineReason: server.probeStatus === "failed" || server.status === "offline" ? "unreachable" : "collect_failed",
      intervalSeconds,
      probe,
    };
  }
  return null;
}

/**
 * Persist one fleet sample in a single batch.
 *
 * Offline nodes are explicit discontinuities (`isOnline=false`).
 * Warning nodes without metrics (TCP up, SSH auth/command failed) are also
 * recorded as offline samples — otherwise the chart/status page looks like
 * the host "vanished" after the last successful poll, even though health
 * collection still runs every few minutes.
 *
 * Each row records the sampler interval it was taken at and the TCP probe
 * outcome, and every checked server's normalised latest numbers are upserted
 * for the status board (readers never probe hosts themselves).
 */
export async function snapshotHealthOverview(
  overview: HealthOverview,
  options: { intervalSeconds?: number; checkedAt?: Date } = {},
) {
  const intervalSeconds = Math.max(1, Math.round(options.intervalSeconds ?? HEALTH_SAMPLE_INTERVAL_MINUTES * 60));
  const checkedAt = options.checkedAt ?? new Date();
  const base = overview.servers.flatMap((server) => {
    if (!server.enabled) return [];
    const extra = { intervalSeconds, ...probeColumns(server) };
    if (server.status === "offline") {
      return [{ serverId: server.serverId, cpuUsage: 0, memUsage: 0, diskUsage: 0, isOnline: false, ...extra }];
    }
    // SSH auth / collect failure still means "not online for metrics".
    if (server.cpu === undefined || server.mem === undefined || server.diskMax === undefined) {
      if (server.status === "warning" || server.status === "unknown") {
        return [{ serverId: server.serverId, cpuUsage: 0, memUsage: 0, diskUsage: 0, isOnline: false, ...extra }];
      }
      return [];
    }
    const load1 = server.loadAvg1m ?? server.metrics?.cpu.loadAvg[0];
    return [{
      serverId: server.serverId,
      cpuUsage: server.cpu,
      memUsage: server.mem,
      diskUsage: server.diskMax,
      isOnline: true,
      load1: typeof load1 === "number" && Number.isFinite(load1) ? load1 : null,
      processCount: server.metrics?.system?.processes ?? null,
      tcpConnections: server.metrics?.system?.tcpConnections ?? null,
      udpConnections: server.metrics?.system?.udpConnections ?? null,
      ...extra,
    }];
  });
  const latest = overview.servers
    .map((server) => latestMetricInput(server, checkedAt, intervalSeconds))
    .filter((row): row is LatestMetricInput => row !== null);
  if (latest.length > 0) {
    // The status board's copy must not cost the durable history sample.
    await writeLatestMetrics(latest).catch((error) =>
      logger.warn("latest metric upsert failed", { error: error instanceof Error ? error.message : String(error) }),
    );
  }
  if (base.length === 0) return { count: 0 };
  const teamMap = await teamIdByServerIds([...new Set(base.map((r) => r.serverId))]);
  const data = base.map((row) => ({
    ...row,
    teamId: teamMap.get(row.serverId) ?? null,
  }));
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
