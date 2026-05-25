import { prisma } from "@/lib/db";
import { collectServerMetrics, type ServerMetrics } from "@/lib/server/monitor";
import { createNotification } from "@/lib/notification/service";
import { fetchWebhookSafely } from "@/lib/security/webhook-url";

/* ── Types ────────────────────────────────────────────────── */

export type HealthStatus = "healthy" | "warning" | "critical" | "offline" | "unknown";

export type ServerHealth = {
	serverId: string;
	serverName: string;
	host: string;
	enabled: boolean;
	status: HealthStatus;
	cpu?: number;
	mem?: number;
	diskMax?: number;
	uptime?: string;
	lastCheck: string;
	metrics?: ServerMetrics;
	error?: string;
};

export type HealthOverview = {
	total: number;
	online: number;
	warning: number;
	critical: number;
	offline: number;
	servers: ServerHealth[];
};

/* ── Health evaluation ────────────────────────────────────── */

const WARN_CPU = 80;
const CRIT_CPU = 95;
const WARN_MEM = 85;
const CRIT_MEM = 95;
const WARN_DISK = 85;
const CRIT_DISK = 95;

function evaluateHealth(metrics: ServerMetrics): HealthStatus {
	const cpu = metrics.cpu.usagePercent;
	const mem = metrics.memory.usagePercent;
	const diskMax = Math.max(...metrics.disk.map((d) => d.usagePercent), 0);

	if (cpu >= CRIT_CPU || mem >= CRIT_MEM || diskMax >= CRIT_DISK) return "critical";
	if (cpu >= WARN_CPU || mem >= WARN_MEM || diskMax >= WARN_DISK) return "warning";
	return "healthy";
}

/* ── Collect all servers health ───────────────────────────── */

export async function collectAllHealth(): Promise<HealthOverview> {
	const servers = await prisma.server.findMany({
		select: { id: true, name: true, host: true, enabled: true },
		orderBy: { name: "asc" },
	});

	const results: ServerHealth[] = [];

	for (const server of servers) {
		if (!server.enabled) {
			results.push({
				serverId: server.id,
				serverName: server.name,
				host: server.host,
				enabled: false,
				status: "offline",
				lastCheck: new Date().toISOString(),
			});
			continue;
		}

		const result = await collectServerMetrics(server.id);

		if ("error" in result) {
			results.push({
				serverId: server.id,
				serverName: server.name,
				host: server.host,
				enabled: true,
				status: "offline",
				lastCheck: new Date().toISOString(),
				error: result.error,
			});
			continue;
		}

		const metrics = result as ServerMetrics;
		const health = evaluateHealth(metrics);
		const diskMax = Math.max(...metrics.disk.map((d) => d.usagePercent), 0);

		results.push({
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
		});
	}

	return {
		total: servers.length,
		online: results.filter((r) => r.status === "healthy").length,
		warning: results.filter((r) => r.status === "warning").length,
		critical: results.filter((r) => r.status === "critical").length,
		offline: results.filter((r) => r.status === "offline" || !r.enabled).length,
		servers: results,
	};
}

/* ── Snapshot for history ─────────────────────────────────── */

export async function snapshotMetrics(serverId: string, cpu: number, mem: number, diskMax: number, isOnline: boolean) {
	return prisma.metricSnapshot.create({
		data: { serverId, cpuUsage: cpu, memUsage: mem, diskUsage: diskMax, isOnline },
	});
}

export async function getMetricHistory(serverId: string, hours: number = 24) {
	const since = new Date(Date.now() - hours * 3600_000);
	return prisma.metricSnapshot.findMany({
		where: { serverId, createdAt: { gte: since } },
		orderBy: { createdAt: "asc" },
		select: { cpuUsage: true, memUsage: true, diskUsage: true, isOnline: true, createdAt: true },
	});
}

/* ── Alert evaluation ─────────────────────────────────────── */

export async function evaluateAlerts() {
	const rules = await prisma.alertRule.findMany({
		where: { enabled: true },
		select: { id: true, name: true, metric: true, threshold: true, operator: true, durationSeconds: true, enabled: true, lastMatchedAt: true, lastTriggeredAt: true, cooldownMinutes: true, serverIds: true, notifyChannels: true, webhookUrl: true },
	});
	if (rules.length === 0) return;

	const health = await collectAllHealth();

	for (const rule of rules) {
		// Check cooldown
		if (rule.lastTriggeredAt) {
			const cooldownMs = rule.cooldownMinutes * 60_000;
			if (Date.now() - rule.lastTriggeredAt.getTime() < cooldownMs) continue;
		}

		const targetServers = rule.serverIds.length > 0
			? health.servers.filter((s) => rule.serverIds.includes(s.serverId))
			: health.servers.filter((s) => s.enabled);

		for (const server of targetServers) {
			let value: number | undefined;
			switch (rule.metric) {
				case "cpu_usage": value = server.cpu; break;
				case "mem_usage": value = server.mem; break;
				case "disk_usage": value = server.diskMax; break;
				case "server_offline": value = server.status === "offline" ? 1 : 0; break;
			}

			if (value === undefined) continue;

			let triggered = false;
			switch (rule.operator) {
				case "gt": triggered = value > rule.threshold; break;
				case "gte": triggered = value >= rule.threshold; break;
				case "lt": triggered = value < rule.threshold; break;
				case "lte": triggered = value <= rule.threshold; break;
				case "eq": triggered = value === rule.threshold; break;
			}

			if (!triggered) {
				if (rule.lastMatchedAt) {
					await prisma.alertRule.update({ where: { id: rule.id }, data: { lastMatchedAt: null } });
				}
				continue;
			}

			const now = new Date();
			if (rule.durationSeconds > 0) {
				if (!rule.lastMatchedAt) {
					await prisma.alertRule.update({ where: { id: rule.id }, data: { lastMatchedAt: now } });
					continue;
				}
				const matchedForMs = now.getTime() - rule.lastMatchedAt.getTime();
				if (matchedForMs < rule.durationSeconds * 1000) continue;
			}

			// Fire alert
			const title = `告警: ${server.serverName} ${rule.metric === "server_offline" ? "离线" : rule.metric.replace("_", " ")}`;
			const message = `${rule.name}: ${rule.metric} ${rule.operator} ${rule.threshold} (当前: ${value})`;

			if (rule.notifyChannels.includes("in_app")) {
				const admins = await prisma.user.findMany({
					where: { roles: { some: { role: { permissions: { some: { permission: { key: "notification:manage" } } } } } } },
					select: { id: true },
				});
				for (const admin of admins) {
					await createNotification({
						userId: admin.id,
						type: "server_alert",
						title,
						message,
						actionUrl: `/health`,
					});
				}
			}

			if (rule.notifyChannels.includes("webhook") && rule.webhookUrl) {
				try {
					await fetchWebhookSafely(rule.webhookUrl, {
						method: "POST",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ alert: rule.name, server: server.serverName, metric: rule.metric, value, threshold: rule.threshold, timestamp: new Date().toISOString() }),
					});
				} catch { /* webhook best-effort */ }
			}

			// Update last triggered
			await prisma.alertRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: now, lastMatchedAt: now } });
		}
	}
}
