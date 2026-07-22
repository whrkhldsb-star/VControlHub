/**
 * Health service — collection / aggregation (R28 god-file split).
 *
 * `collectAllHealth` fans out SSH-metric collection in parallel, classifies
 * each server via the pure `evaluateHealth` reducer, and rolls the per-server
 * results into a `HealthOverview`. Heavy I/O (parallel SSH) lives here; the
 * alert evaluation logic lives in `./service-alerts`.
 */
import { prisma } from "@/lib/db";
import { collectServerMetrics, type ServerMetrics } from "@/lib/server/monitor";
import { tcpProbe } from "@/lib/server/connectivity";
import type { HealthOverview, ServerHealth } from "./service-types";
import { evaluateHealth } from "./service-types";
import { teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";

/** Default TCP probe deadline; tight enough to keep the health rollup snappy
 *  even when dozens of servers are probed in parallel. */
const TCP_PROBE_TIMEOUT_MS = 2_000;

/**
 * Process-local last-sample cache so network_in/out can be expressed as
 * kbps between consecutive collections. Without this, network counters were
 * absolute cumulative bytes / 1024 — which falsely looks like multi-Gbps load
 * and would fire any reasonable network_* alert rule after a few hours of uptime.
 */
type NetSample = { atMs: number; rxBytes: number; txBytes: number };
const lastNetSampleByServer = new Map<string, NetSample>();

function networkRatesKbps(
  serverId: string,
  totalRx: number,
  totalTx: number,
  nowMs: number,
): { inKbps: number; outKbps: number } {
  const prev = lastNetSampleByServer.get(serverId);
  lastNetSampleByServer.set(serverId, { atMs: nowMs, rxBytes: totalRx, txBytes: totalTx });
  if (!prev) return { inKbps: 0, outKbps: 0 };
  const elapsedSec = (nowMs - prev.atMs) / 1000;
  if (elapsedSec <= 0) return { inKbps: 0, outKbps: 0 };
  // Counter reset / reboot → treat as zero rate rather than negative flood.
  const dRx = totalRx >= prev.rxBytes ? totalRx - prev.rxBytes : 0;
  const dTx = totalTx >= prev.txBytes ? totalTx - prev.txBytes : 0;
  return {
    inKbps: Math.max(0, Math.round((dRx / 1024) / elapsedSec)),
    outKbps: Math.max(0, Math.round((dTx / 1024) / elapsedSec)),
  };
}

/** Test helper — clear the delta cache between unit tests. */
export function resetHealthNetworkRateCacheForTests() {
  lastNetSampleByServer.clear();
}

export async function collectAllHealth(
	session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Promise<HealthOverview> {
	const servers = await prisma.server.findMany({
		where: session ? teamWhere(session) : {},
		select: { id: true, name: true, host: true, port: true, enabled: true },
		orderBy: { name: "asc" },
		take: 200,
	});

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
		const probe = await tcpProbe(server.host, server.port, TCP_PROBE_TIMEOUT_MS);
		if (!probe.ok) {
			return {
				serverId: server.id,
				serverName: server.name,
				host: server.host,
				enabled: true,
				status: "offline" as const,
				lastCheck: new Date().toISOString(),
				error: `Network unreachable: ${probe.error ?? "unknown reason"}`,
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
					error: `SSH unreachable (host online, RTT ${rtt ?? "?"}ms): ${result.error}`,
				};
			}
			const metrics = result as ServerMetrics;
			const health = evaluateHealth(metrics);
			const diskMax = Math.max(...metrics.disk.map((d) => d.usagePercent), 0);
			// Prefer root mount for absolute disk labels; fall back to busiest mount.
			const rootDisk =
				metrics.disk.find((d) => d.mount === "/") ??
				metrics.disk.slice().sort((a, b) => b.usagePercent - a.usagePercent)[0];
			const totalNetRx = metrics.network.reduce((s, n) => s + n.rxBytes, 0);
			const totalNetTx = metrics.network.reduce((s, n) => s + n.txBytes, 0);
			const nowMs = Date.now();
			const rates = networkRatesKbps(server.id, totalNetRx, totalNetTx, nowMs);
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
				diskUsedLabel: rootDisk?.usedGb,
				diskTotalLabel: rootDisk?.totalGb,
				loadAvg1m: metrics.cpu.loadAvg[0],
				networkInKbps: rates.inKbps,
				networkOutKbps: rates.outKbps,
				networkRxBytes: totalNetRx,
				networkTxBytes: totalNetTx,
				swapUsagePercent: metrics.swapUsagePercent,
				uptime: metrics.uptime,
				lastCheck: metrics.timestamp,
				latencyMs: probe.latencyMs,
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
				error: `Collection failed (host online, RTT ${rtt ?? "?"}ms): ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	});
	const results = (await Promise.allSettled(checks))
		.map((r) => (r.status === "fulfilled" ? r.value : null))
		.filter(Boolean) as ServerHealth[];

	// Best-effort monthly traffic from durable samples (if worker has been running).
	try {
		const monthStart = new Date();
		monthStart.setUTCDate(1);
		monthStart.setUTCHours(0, 0, 0, 0);
		const ids = results.map((r) => r.serverId);
		if (ids.length > 0) {
			const snaps = await prisma.trafficSnapshot.findMany({
				where: { source: "server", serverId: { in: ids }, sampledAt: { gte: monthStart } },
				select: { serverId: true, rxBytes: true, txBytes: true, sampledAt: true },
				orderBy: { sampledAt: "asc" },
				take: 5_000,
			});
			const first = new Map<string, { rx: bigint; tx: bigint }>();
			const last = new Map<string, { rx: bigint; tx: bigint }>();
			for (const s of snaps) {
				if (!s.serverId) continue;
				const row = { rx: s.rxBytes, tx: s.txBytes };
				if (!first.has(s.serverId)) first.set(s.serverId, row);
				last.set(s.serverId, row);
			}
			for (const r of results) {
				const a = first.get(r.serverId);
				const b = last.get(r.serverId);
				if (!a || !b) continue;
				const dRx = b.rx >= a.rx ? b.rx - a.rx : b.rx;
				const dTx = b.tx >= a.tx ? b.tx - a.tx : b.tx;
				r.monthlyRxBytes = Number(dRx);
				r.monthlyTxBytes = Number(dTx);
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
			(r) => r.enabled && (r.status === "healthy" || r.status === "warning" || r.status === "critical"),
		).length,
		warning: results.filter((r) => r.status === "warning").length,
		critical: results.filter((r) => r.status === "critical").length,
		offline: results.filter((r) => r.status === "offline" || !r.enabled).length,
		servers: results,
	};
}
