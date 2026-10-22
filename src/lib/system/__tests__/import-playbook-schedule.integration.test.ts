// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { importPlaybooks } from "../import-executors-automation";

/**
 * Overwriting a playbook from an export recomputes what its trigger
 * derives, as an edit does. A yearly cron overwritten with "every minute"
 * kept its old nextRunAt, months away; the startup sweep only fills a
 * missing one.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("playbook import and its schedule (PostgreSQL)", () => {
	const id = `pbimport-${randomUUID().slice(0, 8)}`;
	const yearly = new Date(Date.now() + 200 * 86_400_000);

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.playbook.create({
			data: { id, name: id, triggerType: "cron", triggerConfig: { expression: "0 0 1 1 *" }, steps: [], enabled: true, nextRunAt: yearly, metricMatchState: { matched: true } },
		});
	});
	afterAll(async () => {
		await prisma.playbook.deleteMany({ where: { id } });
		await prisma.$disconnect();
	});

	const row = (expression: string, enabled = true) => ({
		id, name: id, description: null, triggerType: "cron", triggerConfig: { expression }, steps: [], chainRetry: 0, enabled, createdById: null, teamId: null,
	}) as never;

	it("schedules an overwritten cron by its new expression", async () => {
		const counts = { created: 0, updated: 0, skipped: 0 };
		await importPlaybooks(prisma as never, { playbooks: [row("* * * * *")] } as never, { overwriteExisting: true } as never, counts);

		const after = await prisma.playbook.findUniqueOrThrow({ where: { id } });
		expect(counts.updated).toBe(1);
		expect(after.nextRunAt!.getTime()).toBeLessThanOrEqual(Date.now() + 61_000);
		expect(after.metricMatchState).toBeNull();
	});

	it("clears the schedule of a playbook imported as disabled", async () => {
		await importPlaybooks(prisma as never, { playbooks: [row("* * * * *", false)] } as never, { overwriteExisting: true } as never, { created: 0, updated: 0, skipped: 0 });
		expect((await prisma.playbook.findUniqueOrThrow({ where: { id } })).nextRunAt).toBeNull();
	});
});
