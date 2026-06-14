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
import type { HealthOverview, ServerHealth } from "./service-types";
import { evaluateHealth } from "./service-types";

export async function collectAllHealth(): Promise<HealthOverview> {
	const servers = await prisma.server.findMany({
		select: { id: true, name: true, host: true, enabled: true },
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
		try {
			const result = await collectServerMetrics(server.id);
			if ("error" in result) {
				return {
					serverId: server.id,
					serverName: server.name,
					host: server.host,
					enabled: true,
					status: "offline" as const,
					lastCheck: new Date().toISOString(),
					error: result.error,
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
				metrics,
			};
		} catch (err) {
			return {
				serverId: server.id,
				serverName: server.name,
				host: server.host,
				enabled: true,
				status: "offline" as const,
				lastCheck: new Date().toISOString(),
				error: err instanceof Error ? err.message : "Unknown error",
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
