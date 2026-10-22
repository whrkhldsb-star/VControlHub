// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { findSftpNodeForStaleInventory, listSftpNodesForStaleInventory } from "../sftp-stale-inventory";

/** The sweep saw only the first 500 SFTP nodes by name; a later one was never scanned or found. */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("SFTP stale-index sweep scope (PostgreSQL)", () => {
	const prefix = `sweep-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.storageNode.createMany({
			data: Array.from({ length: 501 }, (_, i) => ({ id: `${prefix}-${String(i).padStart(3, "0")}`, name: `${prefix}-${String(i).padStart(3, "0")}`, driver: "SFTP" as const, basePath: "/data", host: "203.0.113.40", port: 22, username: "root" })),
		});
	}, 30_000);
	afterAll(async () => {
		await prisma.storageNode.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("reaches every node, the 501st included", async () => {
		const ids = (await listSftpNodesForStaleInventory()).map((node) => node.id).filter((id) => id.startsWith(prefix));
		expect(ids).toHaveLength(501);
		expect((await findSftpNodeForStaleInventory(`${prefix}-500`))?.id).toBe(`${prefix}-500`);
		expect((await listSftpNodesForStaleInventory(undefined, [`${prefix}-500`])).map((node) => node.id)).toEqual([`${prefix}-500`]);
	}, 30_000);
});
