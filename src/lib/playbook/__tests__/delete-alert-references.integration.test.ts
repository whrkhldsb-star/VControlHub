// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { deletePlaybook } from "../service";

/**
 * Alert rules name their remediation playbooks by id, with no foreign key: a
 * deleted playbook stayed on its rules (counted on their cards) and every
 * later fire tried, and failed, to start it.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("deleting a playbook (PostgreSQL)", () => {
	const prefix = `pbd${randomUUID().slice(0, 8)}`;
	const kept = `${prefix}-kept`;
	const gone = `${prefix}-gone`;
	const ruleId = `${prefix}-rule`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		for (const id of [kept, gone]) {
			await prisma.playbook.create({ data: { id, name: id, triggerType: "manual", triggerConfig: {}, steps: [] } });
		}
		await prisma.alertRule.create({ data: { id: ruleId, name: ruleId, metric: "cpu_usage", operator: "gt", threshold: 90, playbookIds: [gone, kept] } });
	});
	afterAll(async () => {
		await prisma.alertRule.deleteMany({ where: { id: ruleId } });
		await prisma.playbook.deleteMany({ where: { id: { in: [kept, gone] } } });
		await prisma.$disconnect();
	});

	it("removes the playbook from the alert rules that ran it", async () => {
		await deletePlaybook(gone, "system");

		expect(await prisma.playbook.count({ where: { id: gone } })).toBe(0);
		await expect(prisma.alertRule.findUnique({ where: { id: ruleId }, select: { playbookIds: true } }))
			.resolves.toEqual({ playbookIds: [kept] });
	});
});
