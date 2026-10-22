// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { syncServerMonthlyCosts } from "../service-entries";

/**
 * The daily background sync (no session) bills the live fleet only: a
 * deleted customer keeps its servers for history, not for new invoices.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("monthly server cost sync and deleted customers (PostgreSQL)", () => {
	const prefix = `msync-${randomUUID().slice(0, 8)}`;
	const live = `${prefix}-live`;
	const gone = `${prefix}-gone`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: live, slug: live, name: live } });
		await prisma.team.create({ data: { id: gone, slug: gone, name: gone, deletedAt: new Date() } });
		await prisma.server.createMany({
			data: [live, gone].map((teamId) => ({
				id: `${teamId}-srv`, name: `${teamId}-srv`, host: `${teamId}.test`, username: "root", tags: [], teamId,
				costAutoSync: true, costMonthlyAmount: "12.00", costCurrency: "USD",
			})),
		});
	});
	afterAll(async () => {
		await prisma.costEntry.deleteMany({ where: { sourceRef: { startsWith: prefix } } });
		await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.team.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("does not bill the servers of a deleted customer", async () => {
		await syncServerMonthlyCosts("2030-03");
		const billed = await prisma.costEntry.findMany({ where: { sourceRef: { startsWith: prefix } }, select: { sourceRef: true } });
		expect(billed.map((row) => row.sourceRef)).toEqual([`${live}-srv`]);
	});
});
