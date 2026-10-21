// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { shiftAppTimeZoneDay, startOfDayInAppTimeZone } from "@/lib/datetime/time-zone";
import { rollupServerUptimeForDay } from "@/lib/uptime/rollup";
import { sumTrafficSince } from "../service-collect";
import { getMetricHistory } from "../service-metrics";

/**
 * Health history, monthly traffic and the uptime rollup on a real
 * PostgreSQL: the queries are SQL (window functions), so a mock proves nothing.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("health history, traffic and uptime (PostgreSQL)", () => {
	const prefix = `hist-${randomUUID().slice(0, 8)}`;
	const server = (suffix: string) => `${prefix}-${suffix}`;
	const MiB = 1024 * 1024;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.server.createMany({
			data: ["traffic", "steady", "history", "uptime"].map((suffix) => ({ id: server(suffix), name: server(suffix), host: `${suffix}.test`, username: "root", tags: [] })),
		});
	});
	afterAll(async () => {
		await prisma.serverUptimeSnapshot.deleteMany({ where: { serverId: { startsWith: prefix } } });
		await prisma.trafficSnapshot.deleteMany({ where: { serverId: { startsWith: prefix } } });
		await prisma.metricSnapshot.deleteMany({ where: { serverId: { startsWith: prefix } } });
		await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("sums monthly traffic across a counter reset (reboot)", async () => {
		const since = new Date(Date.now() - 3_600_000);
		const at = (minutes: number) => new Date(since.getTime() + minutes * 60_000);
		// RX 0 → 900 → (reboot) 0 → 100 MiB: 1,000 MiB moved; TX half of it.
		const steps = [0, 900, 0, 100];
		await prisma.trafficSnapshot.createMany({
			data: steps.map((rx, i) => ({ source: "server", serverId: server("traffic"), iface: "eth0", rxBytes: BigInt(rx * MiB), txBytes: BigInt((rx * MiB) / 2), sampledAt: at(i + 1) })),
		});
		// Control: a counter that only grows.
		await prisma.trafficSnapshot.createMany({
			data: [0, 900, 1000].map((rx, i) => ({ source: "server", serverId: server("steady"), iface: "eth0", rxBytes: BigInt(rx * MiB), txBytes: BigInt(0), sampledAt: at(i + 1) })),
		});
		const totals = await sumTrafficSince([server("traffic"), server("steady")], since);
		expect(totals.get(server("traffic"))).toEqual({ rx: 1000 * MiB, tx: 500 * MiB, firstSampleAt: at(1) });
		expect(totals.get(server("steady"))?.rx).toBe(1000 * MiB);
	});

	it("returns the whole window ending at the newest sample at a 1-minute cadence", async () => {
		const now = Date.now();
		// 24 hours at one sample a minute: 1,441 rows; the newest has CPU 99.
		const rows = Array.from({ length: 1441 }, (_, i) => ({
			serverId: server("history"),
			cpuUsage: i === 1440 ? 99 : 10,
			memUsage: 20,
			diskUsage: 30,
			intervalSeconds: 60,
			createdAt: new Date(now - (1440 - i) * 60_000 + 1_000),
		}));
		await prisma.metricSnapshot.createMany({ data: rows });
		const history = await getMetricHistory(server("history"), 24);
		expect(history.length).toBeLessThanOrEqual(24 * 12 + 12);
		expect(history.length).toBeGreaterThan(200);
		expect(history.at(-1)!.cpuUsage).toBe(99);
		expect(history.at(-1)!.intervalSeconds).toBe(60);
		// Spread over the window, not its first hours.
		expect(now - history[0]!.createdAt.getTime()).toBeGreaterThan(23 * 3_600_000);
		for (let i = 1; i < history.length; i += 1) {
			expect(history[i]!.createdAt.getTime()).toBeGreaterThan(history[i - 1]!.createdAt.getTime());
		}
	});

	it("keeps a finished day's uptime when retention prunes part of its samples", async () => {
		const dayStart = startOfDayInAppTimeZone(shiftAppTimeZoneDay(new Date(), -3));
		// 288 five-minute samples: offline for 12 hours, then online for 12.
		await prisma.metricSnapshot.createMany({
			data: Array.from({ length: 288 }, (_, i) => ({
				serverId: server("uptime"),
				cpuUsage: 1,
				memUsage: 1,
				diskUsage: 1,
				isOnline: i >= 144,
				intervalSeconds: 300,
				createdAt: new Date(dayStart.getTime() + i * 300_000),
			})),
		});
		await rollupServerUptimeForDay(dayStart);
		const where = { serverId_date: { serverId: server("uptime"), date: dayStart } };
		const complete = await prisma.serverUptimeSnapshot.findUniqueOrThrow({ where });
		expect(complete).toMatchObject({ uptimePercent: 50, checkCount: 288 });

		// A one-day retention removes the offline half; the day is rolled up again.
		await prisma.metricSnapshot.deleteMany({ where: { serverId: server("uptime"), createdAt: { lt: new Date(dayStart.getTime() + 144 * 300_000) } } });
		await rollupServerUptimeForDay(dayStart);
		const after = await prisma.serverUptimeSnapshot.findUniqueOrThrow({ where });
		expect(after).toMatchObject({ uptimePercent: 50, checkCount: 288, offlineMinutes: complete.offlineMinutes });
	});
});
