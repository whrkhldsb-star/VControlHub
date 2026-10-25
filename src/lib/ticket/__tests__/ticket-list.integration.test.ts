// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { countTickets, listTickets } from "../service";
import { getTicketKanban, listTicketsAdvanced } from "../sla";

/**
 * 200 recently updated closed tickets and one older open ticket due in half an
 * hour. The workspace list, its counts and the SLA "warning" filter must all
 * find the open one: they used to read only the latest 200 rows.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("ticket lists beyond the latest 200 (PostgreSQL)", () => {
	const prefix = `tk-${randomUUID().slice(0, 8)}`;
	const session = { userId: prefix, roles: ["admin" as const], currentTeamId: prefix };
	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("Ticket list integration requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
		await prisma.user.create({ data: { id: prefix, username: prefix, passwordHash: "unused" } });
		const now = Date.now();
		await prisma.ticket.create({ data: { id: `${prefix}-open`, title: "old open", description: "x", status: "OPEN", priority: "HIGH", createdBy: prefix, teamId: prefix,
			slaDueAt: new Date(now + 30 * 60_000), createdAt: new Date(now - 2 * 86_400_000) } });
		await prisma.$executeRaw`UPDATE tickets SET "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '1 day' WHERE id = ${`${prefix}-open`}`;
		await prisma.ticket.createMany({ data: Array.from({ length: 200 }, (_, i) => ({ id: `${prefix}-closed-${i}`, title: `closed ${i}`, description: "x", status: "CLOSED", createdBy: prefix, teamId: prefix })) });
	});
	afterAll(async () => {
		await prisma.ticket.deleteMany({ where: { teamId: prefix } });
		await prisma.user.deleteMany({ where: { id: prefix } });
		await prisma.team.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("keeps an older open ticket in the list, the counts and the SLA warning filter", async () => {
		const input = { userId: prefix, includeAll: true, session };
		const tickets = await listTickets(input);
		expect(tickets.some((ticket) => ticket.id === `${prefix}-open`)).toBe(true);
		expect(await countTickets(input)).toEqual({ open: 1, inProgress: 0, resolved: 200, urgent: 1 });
		const warning = await listTicketsAdvanced({ session, slaStatus: "warning" });
		expect(warning.map((ticket) => ticket.id)).toEqual([`${prefix}-open`]);
		// The board reads each column on its own: recent closed tickets do not push it off.
		const board = await getTicketKanban({ session });
		expect(board.OPEN.map((ticket) => ticket.id)).toEqual([`${prefix}-open`]);
		expect(board.CLOSED).toHaveLength(200);
	});
});
