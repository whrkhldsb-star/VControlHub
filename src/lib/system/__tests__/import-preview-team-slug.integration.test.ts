// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { previewTeams } from "../import-preview-tables";

/**
 * Customer A was exported, then renamed here, and B took A's old slug. The
 * preview counted A by id ("update 1") while the import skipped it for the
 * slug clash ("updated 0, skipped 1"); nothing told the user beforehand.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("customer import preview slug clash (PostgreSQL)", () => {
	const prefix = `ips-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.createMany({
			data: [
				{ id: `${prefix}-a`, slug: `${prefix}-a-renamed`, name: "A" },
				{ id: `${prefix}-b`, slug: `${prefix}-a`, name: "B" },
			],
		});
	});
	afterAll(async () => {
		await prisma.team.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("counts a customer whose slug another one holds as skipped", async () => {
		const tables = { teams: [{ id: `${prefix}-a`, slug: `${prefix}-a`, name: "A", description: null }] } as never;
		await expect(previewTeams(tables, { overwriteExisting: true } as never)).resolves.toEqual({ create: 0, update: 0, skip: 1 });
		// A new customer with a taken slug is skipped too; a free one is created.
		const fresh = { teams: [{ id: `${prefix}-c`, slug: `${prefix}-a`, name: "C", description: null }, { id: `${prefix}-d`, slug: `${prefix}-d`, name: "D", description: null }] } as never;
		await expect(previewTeams(fresh, { overwriteExisting: true } as never)).resolves.toEqual({ create: 1, update: 0, skip: 1 });
	});
});
