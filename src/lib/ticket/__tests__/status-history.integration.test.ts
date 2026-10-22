// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { updateTicketStatus } from "../service";
import { getTicketTimeline } from "../timeline";

/**
 * Working a ticket through its states leaves each step in its timeline. Only
 * SLA escalations were recorded: after close and reopen the timeline showed
 * nothing but "created".
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("ticket status history (PostgreSQL)", () => {
	const id = `tkhist-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.user.create({ data: { id, username: id, passwordHash: "x" } });
		await prisma.ticket.create({ data: { id, title: "Disk full", description: "d", createdBy: id, status: "OPEN", priority: "NORMAL" } });
	});
	afterAll(async () => {
		await prisma.ticket.deleteMany({ where: { id } });
		await prisma.user.deleteMany({ where: { id } });
		await prisma.$disconnect();
	});

	it("keeps every transition, through close and reopen", async () => {
		for (const status of ["IN_PROGRESS", "RESOLVED", "CLOSED", "OPEN"]) {
			await updateTicketStatus({ id, status, skipItsmFanOut: true });
		}
		const timeline = await getTicketTimeline(id);
		const steps = timeline.events.filter((event) => event.type === "ticket.status").map((event) => event.title);
		expect(steps).toEqual(["Status OPEN → IN_PROGRESS", "Status IN_PROGRESS → RESOLVED", "Status RESOLVED → CLOSED", "Status CLOSED → OPEN"]);
	});
});
