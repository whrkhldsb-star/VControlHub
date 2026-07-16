/**
 * Capacity prediction service — loads MetricSnapshot history for team-scoped
 * servers and produces per-node + fleet forecasts.
 *
 * No separate schema: reuses the existing health.sample durable snapshots
 * (30-day retention). Offline rows are excluded from regression fits.
 */

import { prisma } from "@/lib/db";
import { teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import {
  buildServerForecast,
  summarizeFleet,
  type CapacityRisk,
  type FleetCapacitySummary,
  type MetricSample,
  type ServerCapacityForecast,
} from "./capacity-predict";

export type CapacityForecastResult = {
  summary: FleetCapacitySummary;
  servers: ServerCapacityForecast[];
};

export type CapacityForecastOptions = {
  windowHours?: number;
  horizonDays?: number;
  serverId?: string;
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;
  /** Injected clock for tests */
  nowMs?: number;
};

const DEFAULT_WINDOW_HOURS = 168; // 7 days
const DEFAULT_HORIZON_DAYS = 14;
const MAX_SNAPSHOTS = 50_000;

function normalizeWindowHours(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : DEFAULT_WINDOW_HOURS;
  return Math.min(Math.max(n, 24), 30 * 24);
}

function normalizeHorizonDays(value: number | undefined): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : DEFAULT_HORIZON_DAYS;
  return Math.min(Math.max(n, 1), 90);
}

export async function getCapacityForecast(
  options: CapacityForecastOptions = {},
): Promise<CapacityForecastResult> {
  const windowHours = normalizeWindowHours(options.windowHours);
  const horizonDays = normalizeHorizonDays(options.horizonDays);
  const nowMs = options.nowMs ?? Date.now();
  const since = new Date(nowMs - windowHours * 3_600_000);

  const serverWhere = {
    ...(options.session ? teamWhere(options.session) : {}),
    ...(options.serverId ? { id: options.serverId } : {}),
  };

  const servers = await prisma.server.findMany({
    where: serverWhere,
    select: { id: true, name: true, host: true, enabled: true },
    orderBy: { name: "asc" },
    take: 200,
  });

  if (servers.length === 0) {
    return {
      summary: summarizeFleet([], { windowHours, horizonDays, nowMs }),
      servers: [],
    };
  }

  const serverIds = servers.map((s) => s.id);
  const snapshots = await prisma.metricSnapshot.findMany({
    where: {
      serverId: { in: serverIds },
      createdAt: { gte: since },
      isOnline: true,
    },
    orderBy: { createdAt: "asc" },
    take: MAX_SNAPSHOTS,
    select: {
      serverId: true,
      cpuUsage: true,
      memUsage: true,
      diskUsage: true,
      createdAt: true,
    },
  });

  const byServer = new Map<
    string,
    { cpu: MetricSample[]; mem: MetricSample[]; disk: MetricSample[] }
  >();
  for (const id of serverIds) {
    byServer.set(id, { cpu: [], mem: [], disk: [] });
  }
  for (const snap of snapshots) {
    const bucket = byServer.get(snap.serverId);
    if (!bucket) continue;
    const t = snap.createdAt.getTime();
    bucket.cpu.push({ t, value: snap.cpuUsage });
    bucket.mem.push({ t, value: snap.memUsage });
    bucket.disk.push({ t, value: snap.diskUsage });
  }

  const forecasts: ServerCapacityForecast[] = servers.map((server) => {
    const series = byServer.get(server.id) ?? { cpu: [], mem: [], disk: [] };
    return buildServerForecast({
      serverId: server.id,
      serverName: server.name,
      host: server.host,
      cpu: series.cpu,
      mem: series.mem,
      disk: series.disk,
      windowHours,
      horizonDays,
      nowMs,
    });
  });

  // Sort: critical first, then warning, watch, ok, insufficient
  const rank: Record<CapacityRisk, number> = {
    critical: 0,
    warning: 1,
    watch: 2,
    ok: 3,
    insufficient_data: 4,
  };
  forecasts.sort((a, b) => {
    const dr = rank[a.overallRisk] - rank[b.overallRisk];
    if (dr !== 0) return dr;
    return a.serverName.localeCompare(b.serverName);
  });

  return {
    summary: summarizeFleet(forecasts, { windowHours, horizonDays, nowMs }),
    servers: forecasts,
  };
}
