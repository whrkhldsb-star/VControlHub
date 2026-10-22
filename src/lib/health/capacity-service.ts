/**
 * Capacity prediction service — loads MetricSnapshot history for team-scoped
 * servers and produces per-node + fleet forecasts.
 *
 * No separate schema: reuses the existing health.sample durable snapshots
 * (30-day retention). Offline rows are excluded from regression fits.
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getRuntimeSettingNumbers } from "@/lib/runtime-settings/service";
import { liveCustomerRowsWhere, serverTeamWhere } from "@/lib/auth/team-scope";
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
const SERVER_PAGE = 500;
/** Servers per snapshot query; with MAX_POINTS_PER_SERVER this bounds one result. */
const SNAPSHOT_SERVER_CHUNK = 100;
/** History points per server: the window is averaged into this many buckets. */
const MAX_POINTS_PER_SERVER = 720;

function normalizeWindowHours(value: number | undefined, fallback = DEFAULT_WINDOW_HOURS): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.min(Math.max(n, 24), 30 * 24);
}

function normalizeHorizonDays(value: number | undefined, fallback = DEFAULT_HORIZON_DAYS): number {
  const n = Number.isFinite(value) ? Math.floor(value as number) : fallback;
  return Math.min(Math.max(n, 1), 90);
}

export async function getCapacityForecast(
  options: CapacityForecastOptions = {},
): Promise<CapacityForecastResult> {
  const defaults = await getRuntimeSettingNumbers(["monitoring.capacityWindowHours", "monitoring.capacityHorizonDays"]);
  const windowHours = normalizeWindowHours(options.windowHours, defaults["monitoring.capacityWindowHours"]);
  const horizonDays = normalizeHorizonDays(options.horizonDays, defaults["monitoring.capacityHorizonDays"]);
  const nowMs = options.nowMs ?? Date.now();
  const since = new Date(nowMs - windowHours * 3_600_000);

  const serverWhere = {
    // The background forecast (capacity alerts) leaves a deleted customer's
    // servers out, as the fleet sweep does.
    ...(options.session ? serverTeamWhere(options.session) : liveCustomerRowsWhere()),
    ...(options.serverId ? { id: options.serverId } : {}),
    // Disabling a server stops its monitoring: the background forecast that
    // capacity alerts read must not open incidents from its old samples.
    // (The capacity page, with a session, still shows its history.)
    ...(options.session ? {} : { enabled: true }),
  };

  // Every server in scope: a fixed first page (it was the first 200 by name)
  // left later servers out of the fleet summary and their capacity alerts.
  const servers: Array<{ id: string; name: string; host: string; enabled: boolean }> = [];
  let cursor: string | undefined;
  do {
    const page = await prisma.server.findMany({
      where: serverWhere,
      select: { id: true, name: true, host: true, enabled: true },
      orderBy: { id: "asc" },
      take: SERVER_PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    servers.push(...page);
    cursor = page.length === SERVER_PAGE ? page[page.length - 1]!.id : undefined;
  } while (cursor);

  if (servers.length === 0) {
    return {
      summary: summarizeFleet([], { windowHours, horizonDays, nowMs }),
      servers: [],
    };
  }

  const serverIds = servers.map((s) => s.id);
  const byServer = new Map<
    string,
    { cpu: MetricSample[]; mem: MetricSample[]; disk: MetricSample[] }
  >();
  for (const id of serverIds) {
    byServer.set(id, { cpu: [], mem: [], disk: [] });
  }
  // Each server's history across the whole window, averaged into time buckets
  // in PostgreSQL. A row cap shared by all servers (the newest 50,000) left
  // each one only minutes of history at a 1-minute sampling interval, so the
  // whole fleet read as "insufficient data" however long it had been sampled.
  const bucketSeconds = Math.max(60, Math.ceil((windowHours * 3600) / MAX_POINTS_PER_SERVER));
  for (let i = 0; i < serverIds.length; i += SNAPSHOT_SERVER_CHUNK) {
    const chunk = serverIds.slice(i, i + SNAPSHOT_SERVER_CHUNK);
    const rows = await prisma.$queryRaw<Array<{ serverId: string; t: number; cpu: number; mem: number; disk: number }>>(Prisma.sql`
      SELECT "serverId",
             (avg(extract(epoch from "createdAt")) * 1000)::float8 AS t,
             avg("cpuUsage")::float8 AS cpu,
             avg("memUsage")::float8 AS mem,
             avg("diskUsage")::float8 AS disk
      FROM metric_snapshots
      WHERE "serverId" IN (${Prisma.join(chunk)})
        AND "createdAt" >= ${since}
        AND "isOnline" = true
        -- Online without values (no metrics channel) is not a 0% reading.
        AND "cpuUsage" IS NOT NULL
      GROUP BY "serverId", floor(extract(epoch from "createdAt") / ${bucketSeconds})
      ORDER BY "serverId", t
    `);
    for (const row of rows) {
      const bucket = byServer.get(row.serverId);
      if (!bucket) continue;
      const t = Number(row.t);
      bucket.cpu.push({ t, value: Number(row.cpu) });
      bucket.mem.push({ t, value: Number(row.mem) });
      bucket.disk.push({ t, value: Number(row.disk) });
    }
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
