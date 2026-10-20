// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { listAuditLogs } from "../service";

/**
 * Entries written in one burst share a createdAt. Ordered by createdAt alone,
 * page boundaries among equal timestamps were resolved per query, so paging
 * through the audit log could show an entry twice and never show another.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("audit log paging over equal timestamps (PostgreSQL)", () => {
	const action = `test.paging.${randomUUID().slice(0, 8)}`;
	const ids = Array.from({ length: 25 }, (_, index) => `${action}-${String(index).padStart(2, "0")}`);

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		const createdAt = new Date("2026-10-20T00:00:00.000Z");
		// Inserted in a shuffled order so the physical order is not the id order.
		const shuffled = [...ids].sort(() => Math.random() - 0.5);
		await prisma.auditLog.createMany({ data: shuffled.map((id) => ({ id, actorType: "SYSTEM", action, detail: {}, createdAt })) });
	});
	afterAll(async () => {
		await prisma.auditLog.deleteMany({ where: { action } });
		await prisma.$disconnect();
	});

	it.each(["time", "action", "actor"] as const)("pages through every entry exactly once when sorted by %s", async (sort) => {
		const seen: string[] = [];
		for (let page = 1; page <= 9; page++) {
			const result = await listAuditLogs({ action, page, pageSize: 3, sort });
			seen.push(...result.logs.map((log) => log.id));
		}
		expect(seen).toHaveLength(ids.length);
		expect(new Set(seen).size).toBe(ids.length);
	});
});
