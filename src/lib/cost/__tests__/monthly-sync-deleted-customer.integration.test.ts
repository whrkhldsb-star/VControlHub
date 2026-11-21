// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import { listRecentSnapshots, syncServerMonthlyCosts } from "../service-entries";

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

	it("excludes a future charge from recent days and keeps it in its billing month", async () => {
		vi.setSystemTime(new Date("2026-11-20T17:00:00Z"));
		const today = "2026-11-21";
		const session = { userId: prefix, roles: ["operator" as const], currentTeamId: live };
		await prisma.costEntry.createMany({ data: [today, "2099-12-31"].map(day => ({
			effectiveDate: new Date(day), category: "storage", provider: prefix, amount: "1", teamId: live, sourceRef: prefix + "-trend",
		})) });
		expect((await listRecentSnapshots(1, session)).map(row => row.snapshotDate)).toEqual([today]);
		expect((await listRecentSnapshots(1, session, "CNY", "2099-12")).map(row => row.snapshotDate)).toEqual(["2099-12-31"]);
	});

	it("does not bill the servers of a deleted customer", async () => {
		await syncServerMonthlyCosts("2030-03");
		const billed = await prisma.costEntry.findMany({ where: { sourceType: "server_monthly", sourceRef: { in: [`${live}-srv`, `${gone}-srv`] } }, select: { sourceRef: true } });
		expect(billed.map((row) => row.sourceRef)).toEqual([`${live}-srv`]);
	});

	it("keeps the server version across backfills and preserves closed-month rows after repricing", async () => {
		const originalDate = new Date("2001-01-15T12:00:00Z");
		const serverId = `${prefix}-historical`;
		await prisma.server.create({ data: {
			id: serverId, name: serverId, host: `${serverId}.test`, username: "root", tags: [], teamId: live,
			createdAt: originalDate, updatedAt: originalDate, costAutoSync: true, costMonthlyAmount: "12.00", costCurrency: "USD",
		} });
		const session = { userId: prefix, roles: ["operator" as const], currentTeamId: live };
		await syncServerMonthlyCosts("2001-04", session);
		await syncServerMonthlyCosts("2001-05", session);
		expect((await prisma.server.findUniqueOrThrow({ where: { id: serverId } })).updatedAt).toEqual(originalDate);
		await prisma.server.update({ where: { id: serverId }, data: { costMonthlyAmount: "99.00", costCurrency: "CNY" } });
		await syncServerMonthlyCosts("2001-04", session);
		await syncServerMonthlyCosts("2001-06", session);
		const rows = await prisma.costEntry.findMany({ where: { sourceType: "server_monthly", sourceRef: serverId }, orderBy: { effectiveDate: "asc" } });
		expect(rows.map(row => [row.effectiveDate.toISOString().slice(0, 7), row.teamId, row.amount.toFixed(2), row.currency])).toEqual([
			["2001-04", live, "12.00", "USD"], ["2001-05", live, "12.00", "USD"],
		]);
	});
});
