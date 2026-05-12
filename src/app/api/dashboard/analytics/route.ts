/**
 * Dashboard analytics API — chart data for the main dashboard.
 * GET /api/dashboard/analytics?type=servers|downloads|audit|image-bed
 */
import { NextResponse } from "next/server";
import { getApiSession } from "@/lib/auth/api-session";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	try {
		const session = await getApiSession();
		if (!session) {
			return NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 });
		}

		const { searchParams } = new URL(request.url);
		const type = searchParams.get("type") || "all";

		const results: Record<string, unknown> = {};

		// Server metrics trend (last 24h)
		if (type === "all" || type === "servers") {
			const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
			const metrics = await prisma.metricSnapshot.findMany({
				where: { createdAt: { gte: twentyFourHoursAgo } },
				orderBy: { createdAt: "asc" },
				select: {
					serverId: true,
					cpuUsage: true,
					memUsage: true,
					diskUsage: true,
					createdAt: true,
				},
			});
			// Group by time bucket (1h intervals)
			const buckets = new Map<string, { cpu: number[]; memory: number[]; disk: number[] }>();
			for (const m of metrics) {
				const hour = new Date(m.createdAt);
				hour.setMinutes(0, 0, 0);
				const key = hour.toISOString();
				if (!buckets.has(key)) buckets.set(key, { cpu: [], memory: [], disk: [] });
				const bucket = buckets.get(key)!;
			bucket.cpu.push(m.cpuUsage);
			bucket.memory.push(m.memUsage);
			bucket.disk.push(m.diskUsage);
			}
			results.servers = Array.from(buckets.entries()).map(([time, data]) => ({
				time,
				cpu: data.cpu.length ? Math.round(data.cpu.reduce((a, b) => a + b, 0) / data.cpu.length) : 0,
				memory: data.memory.length ? Math.round(data.memory.reduce((a, b) => a + b, 0) / data.memory.length) : 0,
				disk: data.disk.length ? Math.round(data.disk.reduce((a, b) => a + b, 0) / data.disk.length) : 0,
			}));
		}

		// Download task trend (last 7 days)
		if (type === "all" || type === "downloads") {
			const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
			const downloads = await prisma.downloadTask.findMany({
				where: { createdAt: { gte: sevenDaysAgo } },
				select: { status: true, createdAt: true },
			});
			const dayBuckets = new Map<string, { completed: number; failed: number; running: number; pending: number }>();
			for (const d of downloads) {
				const day = new Date(d.createdAt).toISOString().slice(0, 10);
				if (!dayBuckets.has(day)) dayBuckets.set(day, { completed: 0, failed: 0, running: 0, pending: 0 });
				const bucket = dayBuckets.get(day)!;
				const status = d.status.toLowerCase() as keyof typeof bucket;
				if (status in bucket) bucket[status]++;
			}
			results.downloads = Array.from(dayBuckets.entries()).map(([date, data]) => ({ date, ...data }));
		}

		// Audit log activity (last 30 days, grouped by day)
		if (type === "all" || type === "audit") {
			const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
			const audits = await prisma.auditLog.findMany({
				where: { createdAt: { gte: thirtyDaysAgo } },
				select: { action: true, createdAt: true },
			});
			const dayBuckets = new Map<string, { total: number; actions: Record<string, number> }>();
			for (const a of audits) {
				const day = new Date(a.createdAt).toISOString().slice(0, 10);
				if (!dayBuckets.has(day)) dayBuckets.set(day, { total: 0, actions: {} });
				const bucket = dayBuckets.get(day)!;
				bucket.total++;
				bucket.actions[a.action] = (bucket.actions[a.action] || 0) + 1;
			}
			results.audit = Array.from(dayBuckets.entries()).map(([date, data]) => ({ date, ...data }));
		}

		// Image bed storage trend (last 7 days)
		if (type === "all" || type === "image-bed") {
			const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
			const images = await prisma.imageUpload.findMany({
				where: { createdAt: { gte: sevenDaysAgo } },
				select: { sizeBytes: true, createdAt: true },
			});
			const dayBuckets = new Map<string, { count: number; size: number }>();
			for (const img of images) {
				const day = new Date(img.createdAt).toISOString().slice(0, 10);
				if (!dayBuckets.has(day)) dayBuckets.set(day, { count: 0, size: 0 });
				const bucket = dayBuckets.get(day)!;
				bucket.count++;
				bucket.size += img.sizeBytes;
			}
			results.imageBed = Array.from(dayBuckets.entries()).map(([date, data]) => ({ date, ...data }));
		}

		return NextResponse.json(results);
	} catch (error) {
		console.error("[dashboard/analytics]", error);
		return NextResponse.json({ error: "获取分析数据失败" }, { status: 500 });
	}
}
