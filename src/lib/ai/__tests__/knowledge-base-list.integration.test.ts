// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { listKnowledgeBases } from "../knowledge";

/** Past 100 bases the oldest one dropped out of the page, with no way to reach it. */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("knowledge base list (PostgreSQL)", () => {
	const teamId = `kblist-${randomUUID().slice(0, 8)}`;
	const session = { userId: teamId, roles: ["operator"] as never, currentTeamId: teamId };

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: teamId, slug: teamId, name: teamId } });
		const base = Date.now() - 86_400_000;
		await prisma.knowledgeBase.createMany({
			data: Array.from({ length: 101 }, (_, i) => ({ id: `${teamId}-${String(i).padStart(3, "0")}`, name: `kb ${i}`, teamId, updatedAt: new Date(base + i * 1000) })),
		});
	});
	afterAll(async () => {
		await prisma.knowledgeBase.deleteMany({ where: { teamId } });
		await prisma.team.deleteMany({ where: { id: teamId } });
		await prisma.$disconnect();
	});

	it("lists every active base, the oldest included", async () => {
		const bases = await listKnowledgeBases(session);
		expect(bases).toHaveLength(101);
		expect(bases.at(-1)?.id).toBe(`${teamId}-000`);
	});
});
