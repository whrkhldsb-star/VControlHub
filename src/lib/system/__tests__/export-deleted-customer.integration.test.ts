// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { exportServers, exportTeams } from "../export-collectors";
import { importTeams } from "../import-executors-tenancy";

/**
 * A deleted customer keeps its servers; the global export carried the
 * servers and left the customer out, so the package failed to import
 * anywhere new (missing customer, rolled back). It now travels as deleted.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("global export of a deleted customer (PostgreSQL)", () => {
	const teamId = `expdel-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: teamId, slug: teamId, name: teamId, deletedAt: new Date("2026-10-01T00:00:00Z") } });
		await prisma.server.create({ data: { id: `${teamId}-srv`, name: `${teamId}-srv`, host: "203.0.113.30", username: "root", tags: [], teamId } });
	});
	afterAll(async () => {
		await prisma.server.deleteMany({ where: { teamId } });
		await prisma.team.deleteMany({ where: { id: teamId } });
		await prisma.$disconnect();
	});

	it("exports the owner of every exported server, and imports it still deleted", async () => {
		const teams = await exportTeams("global", null);
		const servers = await exportServers("standard", "global", null);
		expect(servers.some((server) => server.teamId === teamId)).toBe(true);
		const owner = teams.find((team) => team.id === teamId);
		expect(owner?.deletedAt).toBe("2026-10-01T00:00:00.000Z");

		await prisma.server.deleteMany({ where: { teamId } });
		await prisma.team.deleteMany({ where: { id: teamId } });
		await importTeams(prisma as never, { teams: [owner!] } as never, { overwriteExisting: false } as never, { created: 0, updated: 0, skipped: 0 });
		expect((await prisma.team.findUniqueOrThrow({ where: { id: teamId } })).deletedAt?.toISOString()).toBe("2026-10-01T00:00:00.000Z");
	});
});
