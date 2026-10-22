// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { latestSnapshotPerServer } from "../scan-worker";

/**
 * The scan judges servers in service. Samples outlive a disabled server and
 * a deleted customer as history; they were counted as current outages.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("AI ops scan scope (PostgreSQL)", () => {
	const prefix = `aiscope-${randomUUID().slice(0, 8)}`;
	const liveTeam = `${prefix}-live`;
	const goneTeam = `${prefix}-gone`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: liveTeam, slug: liveTeam, name: liveTeam } });
		await prisma.team.create({ data: { id: goneTeam, slug: goneTeam, name: goneTeam, deletedAt: new Date() } });
		const servers = [
			{ id: `${prefix}-up`, teamId: liveTeam, enabled: true },
			{ id: `${prefix}-legacy`, teamId: null, enabled: true },
			{ id: `${prefix}-off`, teamId: liveTeam, enabled: false },
			{ id: `${prefix}-orphan`, teamId: goneTeam, enabled: true },
		];
		await prisma.server.createMany({ data: servers.map((server) => ({ ...server, name: server.id, host: `${server.id}.test`, username: "root", tags: [] })) });
		await prisma.metricSnapshot.createMany({ data: servers.map((server) => ({ serverId: server.id, isOnline: false, cpuUsage: null, memUsage: null, diskUsage: null })) });
	});
	afterAll(async () => {
		await prisma.metricSnapshot.deleteMany({ where: { serverId: { startsWith: prefix } } });
		await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.team.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("leaves out disabled servers and deleted customers' servers", async () => {
		const rows = await latestSnapshotPerServer(new Date(Date.now() - 30 * 60_000));
		expect(rows.map((row) => row.serverId).filter((id) => id.startsWith(prefix)).sort()).toEqual([`${prefix}-legacy`, `${prefix}-up`]);
	});
});
