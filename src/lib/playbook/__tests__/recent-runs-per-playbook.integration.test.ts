// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { listRecentPlaybookRunsForPlaybooks } from "../service";

/**
 * The playbooks page shows each playbook's latest runs. One busy playbook
 * used to fill the shared newest-first window and hide every other
 * playbook's history.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("recent runs per playbook (PostgreSQL)", () => {
	const prefix = `pbruns-${randomUUID().slice(0, 8)}`;
	const busy = `${prefix}-busy`;
	const quiet = `${prefix}-quiet`;
	const idle = `${prefix}-idle`;
	let quietRunId = "";

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		for (const id of [busy, quiet, idle]) {
			await prisma.playbook.create({ data: { id, name: id, triggerType: "manual", triggerConfig: {}, steps: [] } });
		}
		const base = Date.now() - 3_600_000;
		quietRunId = (await prisma.playbookRun.create({ data: { playbookId: quiet, status: "completed", createdAt: new Date(base) } })).id;
		for (let i = 1; i <= 10; i++) {
			await prisma.playbookRun.create({ data: { playbookId: busy, status: "completed", createdAt: new Date(base + i * 1000) } });
		}
	});
	afterAll(async () => {
		await prisma.playbookRun.deleteMany({ where: { playbookId: { startsWith: prefix } } });
		await prisma.playbook.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("gives every playbook its own newest runs", async () => {
		// Two playbooks × 5 = a window of 10, all of them the busy one's.
		const runs = await listRecentPlaybookRunsForPlaybooks([busy, quiet], undefined, 5);
		expect(runs[busy]).toHaveLength(5);
		expect(runs[busy]!.map((run) => run.createdAt)).toEqual([...runs[busy]!.map((run) => run.createdAt)].sort().reverse());
		expect(runs[quiet]!.map((run) => run.id)).toEqual([quietRunId]);
		expect((await listRecentPlaybookRunsForPlaybooks([idle], undefined, 5))[idle]).toEqual([]);
	});
});
