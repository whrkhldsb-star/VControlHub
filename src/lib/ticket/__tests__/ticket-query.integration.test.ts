// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { listTicketBoard, listTicketPage } from "../query";

/**
 * The workspace filters and pages in the database: a finished ticket older
 * than the latest 200 used to be unreachable from every filter, while the
 * counts above the list still included it.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("ticket workspace query (PostgreSQL)", () => {
	const prefix = `tq-${randomUUID().slice(0, 8)}`;
	const session = { userId: prefix, roles: ["admin" as const], currentTeamId: prefix };
	const scope = { userId: prefix, includeAll: true, session };

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
		await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "unused" } });
		await prisma.ticket.create({ data: { id: `${prefix}-needle`, title: "old needle", description: "x", status: "RESOLVED", category: "incident", createdBy: prefix, teamId: prefix } });
		await prisma.$executeRaw`UPDATE tickets SET "updatedAt" = now() - interval '30 days' WHERE id = ${`${prefix}-needle`}`;
		await prisma.ticket.createMany({ data: Array.from({ length: 205 }, (_, i) => ({ id: `${prefix}-done-${i}`, title: `done ${i}`, description: "x", status: "RESOLVED", category: "request", createdBy: prefix, teamId: prefix })) });
	});
	afterAll(async () => {
		await prisma.ticket.deleteMany({ where: { teamId: prefix } });
		await prisma.user.deleteMany({ where: { id: prefix } });
		await prisma.team.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("finds an old finished ticket through the filters, with the true total", async () => {
		const found = await listTicketPage({ ...scope, query: { status: "RESOLVED", category: "incident", search: "needle" } });
		expect(found.total).toBe(1);
		expect(found.tickets.map((ticket) => ticket.id)).toEqual([`${prefix}-needle`]);

		const resolved = await listTicketPage({ ...scope, query: { status: "RESOLVED" }, page: 7, pageSize: 30 });
		expect(resolved.total).toBe(206);
		expect(resolved.page).toBe(7);
		expect(resolved.tickets.at(-1)!.id).toBe(`${prefix}-needle`);
		// A page past the end (the list shrank) shows the last one.
		expect((await listTicketPage({ ...scope, query: { status: "RESOLVED" }, page: 99 })).page).toBe(7);
	});

	it("gives every board column its full total", async () => {
		const board = await listTicketBoard({ ...scope, query: { category: "incident" } });
		expect(board.RESOLVED.total).toBe(1);
		expect(board.RESOLVED.tickets.map((ticket) => ticket.id)).toEqual([`${prefix}-needle`]);
		const all = await listTicketBoard({ ...scope, perColumn: 10 });
		expect(all.RESOLVED).toMatchObject({ total: 206 });
		expect(all.RESOLVED.tickets).toHaveLength(10);
		expect(all.OPEN.total).toBe(0);
	});
});
