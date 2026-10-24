// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { updateItsmConnection } from "../service-connections";

/**
 * Moving a connection to another customer committed, then the read-back in
 * the old customer's scope found nothing and the move was reported as
 * "ITSM connection not found" (and the route skipped its audit).
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("ITSM connection transfer (PostgreSQL)", () => {
	const prefix = `itsm-move-${randomUUID().slice(0, 8)}`;
	let connectionId: string;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.createMany({ data: [{ id: `${prefix}-a`, name: `${prefix}-a`, slug: `${prefix}-a` }, { id: `${prefix}-b`, name: `${prefix}-b`, slug: `${prefix}-b` }] });
		const connection = await prisma.itsmConnection.create({
			data: { name: prefix, provider: "webhook", direction: "inbound", enabled: true, credentialsEnc: JSON.stringify({ webhookSecret: "s" }), config: {}, teamId: `${prefix}-a` },
		});
		connectionId = connection.id;
	});
	afterAll(async () => {
		await prisma.itsmConnection.deleteMany({ where: { id: connectionId } });
		await prisma.team.deleteMany({ where: { id: { in: [`${prefix}-a`, `${prefix}-b`] } } });
		await prisma.$disconnect();
	});

	it("returns the moved connection", async () => {
		const admin = { userId: "admin", roles: ["admin" as const], currentTeamId: `${prefix}-a` };
		const moved = await updateItsmConnection(connectionId, { teamId: `${prefix}-b` }, admin);
		expect(moved.teamId).toBe(`${prefix}-b`);
		expect((await prisma.itsmConnection.findUniqueOrThrow({ where: { id: connectionId } })).teamId).toBe(`${prefix}-b`);
	});
});
