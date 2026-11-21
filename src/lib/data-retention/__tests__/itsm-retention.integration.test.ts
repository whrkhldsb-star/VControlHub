// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { LOG_RETENTION_TABLES } from "../log-retention";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("ITSM terminal retention (PostgreSQL)", () => {
	const prefix = randomUUID();
	const old = new Date("2025-01-01T00:00:00Z");
	const cutoff = new Date("2026-01-01T00:00:00Z");
	const now = new Date("2026-01-02T00:00:00Z");
	const pruner = LOG_RETENTION_TABLES.itsmEvent;
	beforeAll(async () => {
		const url = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) throw new Error("requires an isolated test database");
	});
	afterAll(async () => {
		await prisma.itsmEvent.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("protects retries, newly completed events and legacy rows with unknown completion times", async () => {
		const rows = [
			{ id: "expired", status: "ok", payload: { terminalAtMs: +old } },
			{ id: "raced", status: "ignored", payload: { terminalAtMs: +old } },
			{ id: "legacy", status: "ok", payload: { applied: true } },
			{ id: "pending", status: "pending", payload: { terminalAtMs: +old } },
			{ id: "error", status: "error", externalId: "retry-key", payload: { terminalAtMs: +old } },
			{ id: "recent", status: "ok", payload: { terminalAtMs: +now } },
		];
		await prisma.itsmEvent.createMany({ data: rows.map((row) => ({
			...row, id: prefix + row.id, createdAt: old, direction: "inbound", eventType: "ticket",
		})) });
		await pruner.prepare(now);
		const candidates = (await pruner.find(cutoff, 2000)).map(({ id }) => id).filter((id) => id.startsWith(prefix));
		expect(candidates.sort()).toEqual([prefix + "expired", prefix + "raced"]);
		await prisma.itsmEvent.update({ where: { id: prefix + "raced" }, data: { status: "pending" } });
		expect(await pruner.remove(candidates, cutoff)).toEqual({ count: 1 });
		expect((await prisma.itsmEvent.findUniqueOrThrow({ where: { id: prefix + "legacy" } })).payload).toEqual({ applied: true, terminalAtMs: +now });
		expect(await prisma.itsmEvent.count({ where: { id: { startsWith: prefix } } })).toBe(5);
	});
});
