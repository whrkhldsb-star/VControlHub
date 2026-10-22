// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { createStorageNode, updateStorageNode } from "../service-nodes";

/**
 * Each customer keeps exactly one default storage node. Two concurrent
 * "new default" creates used to clear each other (and the old default),
 * leaving none at all.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("default storage node under concurrency (PostgreSQL)", () => {
	const teamId = `sdef-${randomUUID().slice(0, 8)}`;
	const session = { userId: teamId, username: teamId, roles: ["admin"], mustChangePassword: false, currentTeamId: teamId } as never;
	const node = (name: string, isDefault: boolean) => ({ name, driver: "LOCAL" as const, basePath: `/srv/vch-test/${teamId}/${name}`, isDefault });

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: teamId, slug: teamId, name: teamId } });
		await prisma.storageNode.create({ data: { ...node("original", true), teamId } });
	});
	afterAll(async () => {
		await prisma.storageNode.deleteMany({ where: { teamId } });
		await prisma.team.deleteMany({ where: { id: teamId } });
		await prisma.$disconnect();
	});

	const defaults = async () => prisma.storageNode.count({ where: { teamId, isDefault: true } });

	it("keeps one default when two default nodes are created at once", async () => {
		for (let round = 0; round < 4; round++) {
			await Promise.all([
				createStorageNode(node(`a${round}`, true) as never, session),
				createStorageNode(node(`b${round}`, true) as never, session),
			]);
			expect(await defaults()).toBe(1);
		}
	});

	it("keeps one default when two nodes are made the default at once", async () => {
		const rows = await prisma.storageNode.findMany({ where: { teamId, isDefault: false }, select: { id: true }, take: 2 });
		for (let round = 0; round < 4; round++) {
			await Promise.all(rows.map((row) => updateStorageNode({ storageNodeId: row.id, isDefault: true } as never, session)));
			expect(await defaults()).toBe(1);
		}
	});
});
