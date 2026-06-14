/**
 * Health service — metric-snapshot CRUD (R28 god-file split).
 *
 * Thin prisma wrappers over `metricSnapshot` for recording per-server
 * CPU/mem/disk history and reading the last-N-hour window. The actual
 * health classification lives in `./service-types`; the alert evaluation
 * lives in `./service-alerts`.
 */
import { prisma } from "@/lib/db";

export async function snapshotMetrics(
	serverId: string,
	cpu: number,
	mem: number,
	diskMax: number,
	isOnline: boolean,
) {
	return prisma.metricSnapshot.create({
		data: {
			serverId,
			cpuUsage: cpu,
			memUsage: mem,
			diskUsage: diskMax,
			isOnline,
		},
	});
}

export async function getMetricHistory(serverId: string, hours: number = 24) {
	const since = new Date(Date.now() - hours * 3600_000);
	return prisma.metricSnapshot.findMany({
		where: { serverId, createdAt: { gte: since } },
		orderBy: { createdAt: "asc" },
		select: {
			cpuUsage: true,
			memUsage: true,
			diskUsage: true,
			isOnline: true,
			createdAt: true,
		},
		take: 1000,
	});
}
