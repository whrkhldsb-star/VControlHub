// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { getCapacityForecast } from "../capacity-service";

/**
 * The fleet forecast against a real PostgreSQL: every server in scope is
 * forecast (not the first 200 by name), and dense sampling does not starve
 * each server of the history a forecast needs (a row cap shared by the whole
 * fleet used to keep only the newest 50,000 samples).
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("capacity forecast over a large fleet (PostgreSQL)", () => {
	const prefix = `cap-${randomUUID().slice(0, 8)}`;
	const session = { userId: prefix, username: prefix, roles: ["admin"] as const, mustChangePassword: false, currentTeamId: prefix };
	const nowMs = Date.now();
	const HOURS = 7;
	const SERVERS = 201;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("Capacity forecast integration requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
		// The full disk sorts last by name: a first page of 200 never saw it.
		const ids = Array.from({ length: SERVERS }, (_, i) => `${prefix}-${String(i).padStart(3, "0")}`);
		await prisma.server.createMany({ data: ids.map((id) => ({ id, name: id, host: `${id}.test`, username: "root", tags: [], teamId: prefix })) });
		// One sample a minute for 7 hours: 201 × 421 = 84,621 rows, well past 50,000.
		const rows = ids.flatMap((serverId, index) => Array.from({ length: HOURS * 60 + 1 }, (_, minute) => ({
			serverId,
			cpuUsage: 20,
			memUsage: 30,
			diskUsage: index === SERVERS - 1 ? 96 : 40,
			createdAt: new Date(nowMs - (HOURS * 60 - minute) * 60_000),
		})));
		for (let i = 0; i < rows.length; i += 10_000) await prisma.metricSnapshot.createMany({ data: rows.slice(i, i + 10_000) });
	}, 120_000);
	afterAll(async () => {
		await prisma.metricSnapshot.deleteMany({ where: { serverId: { startsWith: prefix } } });
		await prisma.server.deleteMany({ where: { teamId: prefix } });
		await prisma.team.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("forecasts every server with its whole window of history", async () => {
		const result = await getCapacityForecast({ session: session as never, windowHours: 24, horizonDays: 30, nowMs });

		expect(result.summary.serverCount).toBe(SERVERS);
		expect(result.summary.insufficientData).toBe(0);
		const full = result.servers.find((server) => server.serverId === `${prefix}-200`)!;
		expect(full.overallRisk).toBe("critical");
		expect(full.metrics.find((metric) => metric.metric === "disk")!.dataSpanHours).toBeGreaterThan(6.5);
		expect(result.summary.byRisk.critical).toBe(1);
	}, 60_000);
});
