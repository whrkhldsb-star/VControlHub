/**
 * Health service — collection / aggregation (R28 god-file split).
 *
 * `collectAllHealth` fans out SSH-metric collection in parallel, classifies
 * each server via the pure `evaluateHealth` reducer, and rolls the per-server
 * results into a `HealthOverview`. Heavy I/O (parallel SSH) lives here; the
 * alert evaluation logic lives in `./service-alerts`.
 */
import { Prisma } from "@prisma/client";
import { startOfMonthInAppTimeZone } from "@/lib/datetime/time-zone";
import { prisma } from "@/lib/db";
import { collectServerMetrics, type ServerMetrics } from "@/lib/server/monitor";
import { tcpProbe } from "@/lib/server/connectivity";
import type { HealthOverview, ServerHealth } from "./service-types";
import { evaluateHealth } from "./service-types";
import { liveCustomerRowsWhere, serverTeamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { persistServerTrafficFromMetrics } from "@/lib/monitoring/server-traffic-snapshot";
import { fullestDisk } from "@/lib/public-status/normalize";

/** Default TCP probe deadline; tight enough to keep the health rollup snappy
 *  even when dozens of servers are probed in parallel. */
const TCP_PROBE_TIMEOUT_MS = 2_000;
const SERVER_PAGE_SIZE = 200;

/**
 * Process-local last-sample cache so network_in/out can be expressed as
 * kbps between consecutive collections. Without this, network counters were
 * absolute cumulative bytes / 1024 — which falsely looks like multi-Gbps load
 * and would fire any reasonable network_* alert rule after a few hours of uptime.
 */
type NetSample = { atMs: number; rxBytes: number; txBytes: number; rates: { inKbps: number; outKbps: number } };
const lastNetSampleByServer = new Map<string, NetSample>();

/**
 * Rates between consecutive samples, timed by when each sample was taken
 * (`sampledAtMs`), not when it was read. An Agent reports once a minute while
 * the dashboard and alerts read its last report far more often: re-reading
 * one sample used to move the baseline to "now", so the next sample's
 * minute of bytes was divided by a few seconds. A sample read again (or one
 * older than the baseline) keeps the rates it produced and the baseline.
 */
function networkRatesKbps(
  serverId: string,
  totalRx: number,
  totalTx: number,
  sampledAtMs: number,
): { inKbps: number; outKbps: number } {
  const prev = lastNetSampleByServer.get(serverId);
  if (prev && sampledAtMs <= prev.atMs) return prev.rates;
  let rates = { inKbps: 0, outKbps: 0 };
  if (prev) {
    const elapsedSec = (sampledAtMs - prev.atMs) / 1000;
    // Counter reset / reboot → treat as zero rate rather than negative flood.
    const dRx = totalRx >= prev.rxBytes ? totalRx - prev.rxBytes : 0;
    const dTx = totalTx >= prev.txBytes ? totalTx - prev.txBytes : 0;
    rates = {
      inKbps: Math.max(0, Math.round(dRx / 1024 / elapsedSec)),
      outKbps: Math.max(0, Math.round(dTx / 1024 / elapsedSec)),
    };
  }
  lastNetSampleByServer.set(serverId, { atMs: sampledAtMs, rxBytes: totalRx, txBytes: totalTx, rates });
  return rates;
}

/**
 * Bytes each server moved since `since`: the sum of every step between
 * consecutive samples of one interface (a counter that went down was reset,
 * so its new value is what accrued since). First-vs-last lost all traffic
 * before a reboot in the month.
 */
/** Samples starting this long after the month began still count as the whole month. */
const MONTHLY_TRAFFIC_GRACE_MS = 60 * 60 * 1000;

export async function sumTrafficSince(serverIds: string[], since: Date): Promise<Map<string, { rx: number; tx: number; firstSampleAt: Date }>> {
  if (serverIds.length === 0) return new Map();
  // One aggregate in SQL: the previous `take: 5000` scan lost the end of the month.
  const rows = await prisma.$queryRaw<Array<{ serverId: string; rx: string; tx: string; first_sample_at: Date }>>(Prisma.sql`
    SELECT "serverId", MIN("sampledAt") AS first_sample_at,
      COALESCE(SUM(CASE WHEN prev_rx IS NULL THEN 0 WHEN "rxBytes" >= prev_rx THEN "rxBytes" - prev_rx ELSE "rxBytes" END), 0)::text AS rx,
      COALESCE(SUM(CASE WHEN prev_tx IS NULL THEN 0 WHEN "txBytes" >= prev_tx THEN "txBytes" - prev_tx ELSE "txBytes" END), 0)::text AS tx
    FROM (
      SELECT "serverId", "sampledAt", "rxBytes", "txBytes",
        LAG("rxBytes") OVER w AS prev_rx,
        LAG("txBytes") OVER w AS prev_tx
      FROM traffic_snapshots
      WHERE source = 'server' AND "serverId" IN (${Prisma.join(serverIds)}) AND "sampledAt" >= ${since}
      WINDOW w AS (PARTITION BY "serverId", iface ORDER BY "sampledAt", id)
    ) steps
    GROUP BY "serverId"
  `);
  return new Map(rows.map((row) => [row.serverId, { rx: Number(row.rx), tx: Number(row.tx), firstSampleAt: row.first_sample_at }]));
}

export async function collectAllHealth(
  session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
  options: { persistTraffic?: boolean } = {},
): Promise<HealthOverview> {
  const servers: Array<{
    id: string;
    name: string;
    host: string;
    port: number;
    enabled: boolean;
    managementMode: "DIRECT" | "AGENT";
    agentLastSeenAt: Date | null;
    operatingSystem: string;
  }> = [];
  let cursorId: string | undefined;
  for (;;) {
    const page = await prisma.server.findMany({
      // The background sweep (no session) probes live customers' servers
      // only: a deleted customer's servers are kept for its history, not
      // probed over SSH, alerted on or counted.
      where: session ? serverTeamWhere(session) : liveCustomerRowsWhere(),
      select: { id: true, name: true, host: true, port: true, enabled: true, managementMode: true, agentLastSeenAt: true, operatingSystem: true },
      orderBy: { id: "asc" },
      take: SERVER_PAGE_SIZE,
      ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    });
    servers.push(...page);
    if (page.length < SERVER_PAGE_SIZE) break;
    cursorId = page[page.length - 1]!.id;
  }

  // Parallel health checks — SSH connections can take seconds each
  const checks = servers.map(async (server) => {
    if (!server.enabled) {
      return {
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        enabled: false,
        status: "offline" as const,
        lastCheck: new Date().toISOString(),
      };
    }

    // TR-050: lightweight TCP probe before the heavy SSH pull. A failed
    // probe means the host is unreachable on the network — mark offline
    // with a clear "网络不可达" reason instead of the generic SSH error.
    const agentFresh = server.managementMode === "AGENT" && server.agentLastSeenAt && Date.now() - server.agentLastSeenAt.getTime() < 90_000;
    const probe = agentFresh
      ? { ok: true as const, latencyMs: undefined }
      : await tcpProbe(server.host, server.port, TCP_PROBE_TIMEOUT_MS);
    const probeStatus = agentFresh ? undefined : probe.ok ? ("ok" as const) : ("failed" as const);
    if (!probe.ok) {
      return {
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        enabled: true,
        status: "offline" as const,
        lastCheck: new Date().toISOString(),
        probeStatus,
        error: `Network unreachable: ${probe.error ?? "unknown reason"}`,
      };
    }

    // A Windows server without the agent has no metrics channel, so the
    // probe is its whole check. It used to fall through to a collection that
    // can only fail: a reachable server in daily use read as a warning here,
    // offline on the status board and 0% uptime every day.
    if (server.operatingSystem === "WINDOWS" && server.managementMode === "DIRECT") {
      return {
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        enabled: true,
        status: "healthy" as const,
        lastCheck: new Date().toISOString(),
        latencyMs: probe.latencyMs,
        probeStatus,
        metricsUnavailable: true,
      };
    }

    try {
      const result = await collectServerMetrics(server.id);
      if ("error" in result) {
        // TCP succeeded but SSH failed — host is up, but the daemon
        // is hung / misconfigured / refusing our key. Mark warning
        // (not offline) so dashboards show a yellow chip rather than
        // the red "host down" chip.
        const rtt = probe.latencyMs;
        return {
          serverId: server.id,
          serverName: server.name,
          host: server.host,
          enabled: true,
          status: "warning" as const,
          lastCheck: new Date().toISOString(),
          latencyMs: rtt,
          probeStatus,
          error: `SSH unreachable (host online, RTT ${rtt ?? "?"}ms): ${result.error}`,
        };
      }
      const metrics = result as ServerMetrics;
      // Durable per-server traffic snapshots are the periodic sampler's job:
      // the traffic-sampling worker samples the local NIC and delegates remote
      // counters to "the health collector ... per interval" (see its docstring).
      // But collectAllHealth is *also* invoked on every /api/health dashboard
      // poll and every alert evaluation — many times a minute. Writing a
      // TrafficSnapshot row on each of those amplified the table far past the
      // intended 5-min cadence, skewed the stored rxRateBps/txRateBps (computed
      // over the few-second gap between two polls rather than the sample
      // interval), and flooded the monthly rollup. Only the sampling worker
      // opts in via persistTraffic.
      if (options.persistTraffic) {
        await persistServerTrafficFromMetrics(server.id, metrics).catch(() => false);
      }
      const health = evaluateHealth(metrics);
      const diskMax = Math.max(...metrics.disk.map((d) => d.usagePercent), 0);
      // Size labels from the same (fullest) partition as diskMax, never "/"
      // sizes beside another mount's percentage.
      const labelDisk = fullestDisk(metrics.disk);
      const totalNetRx = metrics.network.reduce((s, n) => s + n.rxBytes, 0);
      const totalNetTx = metrics.network.reduce((s, n) => s + n.txBytes, 0);
      const sampledAtMs = Date.parse(metrics.timestamp);
      const rates = networkRatesKbps(server.id, totalNetRx, totalNetTx, Number.isFinite(sampledAtMs) ? sampledAtMs : Date.now());
      return {
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        enabled: true,
        status: health,
        cpu: metrics.cpu.usagePercent,
        mem: metrics.memory.usagePercent,
        memUsedMb: metrics.memory.usedMb,
        memTotalMb: metrics.memory.totalMb,
        diskMax,
        diskUsedLabel: labelDisk?.usedGb,
        diskTotalLabel: labelDisk?.totalGb,
        loadAvg1m: metrics.cpu.loadAvg[0],
        networkInKbps: rates.inKbps,
        networkOutKbps: rates.outKbps,
        networkRxBytes: totalNetRx,
        networkTxBytes: totalNetTx,
        swapUsagePercent: metrics.swapUsagePercent,
        uptime: metrics.uptime,
        lastCheck: metrics.timestamp,
        latencyMs: probe.latencyMs,
        probeStatus,
        metrics,
      };
    } catch (err) {
      // The TCP probe succeeded but collectServerMetrics threw before
      // returning — treat that as a host-up-but-collect-failed warning
      // (same shape as the "error" branch above).
      const rtt = probe.latencyMs;
      return {
        serverId: server.id,
        serverName: server.name,
        host: server.host,
        enabled: true,
        status: "warning" as const,
        lastCheck: new Date().toISOString(),
        latencyMs: rtt,
        probeStatus,
        error: `Collection failed (host online, RTT ${rtt ?? "?"}ms): ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  });
  const results = (await Promise.allSettled(checks))
    .map((r) => (r.status === "fulfilled" ? r.value : null))
    .filter(Boolean) as ServerHealth[];

  // Best-effort monthly traffic from durable samples (if worker has been running).
  try {
    const monthStart = startOfMonthInAppTimeZone();
    const ids = results.map((r) => r.serverId);
    if (ids.length > 0) {
      const monthly = await sumTrafficSince(ids, monthStart);
      for (const r of results) {
        const row = monthly.get(r.serverId);
        if (!row) continue;
        r.monthlyRxBytes = row.rx;
        r.monthlyTxBytes = row.tx;
        // Counting began after the month did (server added mid-month, or
        // samples lost): say so rather than pass a partial sum off as the month.
        if (row.firstSampleAt.getTime() - monthStart.getTime() > MONTHLY_TRAFFIC_GRACE_MS) {
          r.monthlyTrafficSince = row.firstSampleAt.toISOString();
        }
      }
    }
  } catch {
    // Traffic table may be empty / unavailable — leave monthly fields unset.
  }

  // "online" = SSH-reachable (healthy + warning + critical). Disabled/offline
  // stay out. Matches product "在线" filter on /vps-status (reachable fleet).
  return {
    total: servers.length,
    online: results.filter(
      (r) =>
        r.enabled &&
        (r.status === "healthy" ||
          r.status === "warning" ||
          r.status === "critical"),
    ).length,
    warning: results.filter((r) => r.status === "warning").length,
    critical: results.filter((r) => r.status === "critical").length,
    offline: results.filter((r) => r.status === "offline" || !r.enabled).length,
    servers: results,
  };
}
