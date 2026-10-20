// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { listAdminNodes } from "../nodes-admin";

/**
 * "Needs attention" (published but hidden from visitors) is filtered and
 * counted in SQL. It used to filter the first 5000 published servers in
 * memory and report none when the flagged one sorted after them.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("public-status attention filter (PostgreSQL)", () => {
	const prefix = `att${randomUUID().slice(0, 6)}`;
	const COUNT = 5001;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		const id = (i: number) => `${prefix}-${String(i).padStart(4, "0")}`;
		await prisma.server.createMany({
			data: Array.from({ length: COUNT }, (_, i) => ({ id: id(i), name: id(i), host: `${id(i)}.test`, username: "root", tags: [], enabled: i !== COUNT - 1 })),
		});
		await prisma.publicStatusNode.createMany({
			data: Array.from({ length: COUNT }, (_, i) => ({ serverId: id(i), publicId: `${prefix.slice(3)}${String(i).padStart(6, "0")}`, displayName: `Node ${i}`, published: true })),
		});
	}, 120_000);
	afterAll(async () => {
		await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("finds a hidden publication behind 5000 visible ones, with its reason", async () => {
		const result = await listAdminNodes({ q: prefix, filter: "attention", page: 1, pageSize: 25 });
		expect(result.total).toBe(1);
		expect(result.rows).toHaveLength(1);
		expect(result.rows[0]).toMatchObject({ serverId: `${prefix}-5000`, publication: { hiddenReason: "server_disabled" } });
	});

	it("treats LIKE wildcards in the search literally", async () => {
		const result = await listAdminNodes({ q: `${prefix}_%`, filter: "attention", page: 1, pageSize: 25 });
		expect(result.total).toBe(0);
	});
});
