// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const { visited } = vi.hoisted(() => ({ visited: [] as string[] }));
// aria2 answers "still downloading" for every relay task and records which were asked.
vi.mock("@/lib/aria2/service", () => ({
	ensureAria2Daemon: vi.fn(async () => undefined),
	tellStatus: vi.fn(async (gid: string) => {
		visited.push(gid);
		return { status: "active" };
	}),
}));

import { prisma } from "@/lib/db";
import { reconcileStaleRunningDownloadTasks, resetReconcileCursorForTests } from "../reconcile";

/**
 * Stale downloads are probed in turn however long the backlog is. Candidates
 * used to be the oldest 2000: tasks behind them were never looked at.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("download reconcile walks the whole backlog (PostgreSQL)", () => {
	const prefix = `rc-${randomUUID().slice(0, 8)}`;
	const COUNT = 2001;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.server.create({ data: { id: prefix, name: prefix, host: "rc.test", username: "root", tags: [] } });
		await prisma.downloadTask.createMany({
			data: Array.from({ length: COUNT }, (_, i) => ({
				id: `${prefix}-${String(i).padStart(4, "0")}`,
				url: "https://example.test/f.bin",
				serverId: prefix,
				targetPath: "/data",
				status: "RUNNING" as const,
				relayMode: true,
				aria2Gid: `${prefix}-${String(i).padStart(4, "0")}`,
			})),
		});
		// Stale past the relay cap, newest last.
		await prisma.$executeRaw`UPDATE download_tasks SET "updatedAt" = (now() AT TIME ZONE 'UTC') - interval '4 hours' + (CAST(substring(id from '[0-9]{4}$') AS int) * interval '1 second') WHERE "serverId" = ${prefix}`;
		resetReconcileCursorForTests();
	});
	afterAll(async () => {
		await prisma.downloadTask.deleteMany({ where: { serverId: prefix } });
		await prisma.server.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("reaches every stale task, the newest included, and then starts over", async () => {
		const ours = () => visited.filter((gid) => gid.startsWith(prefix));
		for (let pass = 0; pass < Math.ceil(COUNT / 100); pass += 1) {
			await reconcileStaleRunningDownloadTasks({ limit: 100 });
		}
		expect(new Set(ours()).size).toBe(COUNT);
		// The last pass took the newest and filled up from the oldest again.
		const lastPass = ours().slice(-100);
		expect(lastPass).toContain(`${prefix}-2000`);
		expect(lastPass).toContain(`${prefix}-0000`);
	}, 120_000);
});
