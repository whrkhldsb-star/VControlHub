// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { delivered } = vi.hoisted(() => ({ delivered: [] as string[] }));
vi.mock("../adapters", async (importOriginal) => ({
	...(await importOriginal<typeof import("../adapters")>()),
	deliverOutbound: vi.fn(async (input: { config: { webhookUrl?: string } }) => {
		delivered.push(input.config.webhookUrl ?? "");
		return { ok: true, statusCode: 200 };
	}),
}));

import { prisma } from "@/lib/db";
import { fanOutTicketEvent } from "../service-outbound";

/**
 * A ticket event reaches every outbound connection of its customer. One page
 * of 50 connections of any direction was read and filtered afterwards:
 * inbound-only connections crowded out the outbound one, which never got
 * the event while the job completed.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("ITSM outbound fan-out (PostgreSQL)", () => {
	const prefix = `itsm-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
		await prisma.itsmConnection.createMany({
			data: Array.from({ length: 51 }, (_, i) => ({ id: `${prefix}-a${String(i).padStart(2, "0")}`, name: `inbound ${i}`, provider: "generic_webhook", direction: "inbound", teamId: prefix })),
		});
		await prisma.itsmConnection.create({
			data: { id: `${prefix}-zz-out`, name: "outbound", provider: "generic_webhook", direction: "outbound", teamId: prefix, config: { webhookUrl: "https://hooks.example.test/itsm" } },
		});
	});
	afterAll(async () => {
		await prisma.itsmEvent.deleteMany({ where: { connectionId: { startsWith: prefix } } });
		await prisma.itsmConnection.deleteMany({ where: { teamId: prefix } });
		await prisma.team.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("delivers to the outbound connection behind 51 inbound-only ones", async () => {
		const result = await fanOutTicketEvent({
			ticketId: `${prefix}-ticket`,
			eventType: "ticket.created",
			title: "t",
			description: "d",
			status: "OPEN",
			priority: "HIGH",
			teamId: prefix,
			deliveryKey: `${prefix}-job`,
		});
		expect(result).toEqual({ sent: 1, failed: 0 });
		expect(delivered).toEqual(["https://hooks.example.test/itsm"]);
	});
});
