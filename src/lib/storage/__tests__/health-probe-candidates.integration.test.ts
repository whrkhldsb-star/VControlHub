// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { probed } = vi.hoisted(() => ({ probed: [] as string[] }));
vi.mock("../service-nodes", () => ({
	checkStorageNodeHealth: vi.fn(async (id: string) => {
		probed.push(id);
	}),
}));

import { prisma } from "@/lib/db";
import { probeAllStaleStorageNodes } from "../health";

/**
 * WebDAV has no probe and always reports UNKNOWN; "UNKNOWN is a candidate"
 * filled every batch of 50 with WebDAV nodes, so LOCAL/SFTP nodes behind
 * them were never checked.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("storage probe candidates (PostgreSQL)", () => {
	const prefix = `probe-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.storageNode.createMany({
			data: Array.from({ length: 60 }, (_, i) => ({ name: `${prefix}-dav-${i}`, driver: "WEBDAV" as const, basePath: "/", healthStatus: "UNKNOWN" as const, lastHealthCheckAt: new Date() })),
		});
		await prisma.storageNode.create({ data: { name: `${prefix}-local`, driver: "LOCAL", basePath: "/tmp", lastHealthCheckAt: new Date(Date.now() - 24 * 3_600_000) } });
	});
	afterAll(async () => {
		await prisma.storageNode.deleteMany({ where: { name: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("probes a stale LOCAL node and never a WebDAV one", async () => {
		await probeAllStaleStorageNodes();
		const nodes = await prisma.storageNode.findMany({ where: { name: { startsWith: prefix } }, select: { id: true, driver: true } });
		const local = nodes.find((node) => node.driver === "LOCAL")!;
		expect(probed).toContain(local.id);
		const webdav = new Set(nodes.filter((node) => node.driver === "WEBDAV").map((node) => node.id));
		expect(probed.filter((id) => webdav.has(id))).toEqual([]);
	});
});
