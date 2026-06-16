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

/** Default TCP probe deadline; tight enough to keep the health rollup snappy
 *  even when dozens of servers are probed in parallel. */
const TCP_PROBE_TIMEOUT_MS = 2_000;

export async function collectAllHealth(): Promise<HealthOverview> {
	const servers = await prisma.server.findMany({
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
				error: `网络不可达: ${probe.error ?? "未知原因"}`,
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
					error: `SSH 不可达 (主机在线, RTT ${rtt ?? "?"}ms): ${result.error}`,
				};
			}
			const metrics = result as ServerMetrics;
			const health = evaluateHealth(metrics);
			const diskMax = Math.max(...metrics.disk.map((d) => d.usagePercent), 0);
			return {
				serverId: server.id,
				serverName: server.name,
				host: server.host,
				enabled: true,
				status: health,
				cpu: metrics.cpu.usagePercent,
				mem: metrics.memory.usagePercent,
				diskMax,
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
				error: `采集失败 (主机在线, RTT ${rtt ?? "?"}ms): ${err instanceof Error ? err.message : String(err)}`,
			};
		}
	});
	const results = (await Promise.allSettled(checks))
		.map((r) => (r.status === "fulfilled" ? r.value : null))
		.filter(Boolean) as ServerHealth[];

	return {
		total: servers.length,
		online: results.filter((r) => r.status === "healthy").length,
		warning: results.filter((r) => r.status === "warning").length,
		critical: results.filter((r) => r.status === "critical").length,
		offline: results.filter((r) => r.status === "offline" || !r.enabled).length,
		servers: results,
	};
}
