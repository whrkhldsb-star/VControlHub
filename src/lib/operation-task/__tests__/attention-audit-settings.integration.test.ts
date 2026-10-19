// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { getAuditStats } from "@/lib/audit/service";
import { getSettingUpdateMetadata } from "@/lib/settings/service";
import { listOperationTaskResult } from "../service";

/**
 * Summaries computed from capped candidate sets, on a real PostgreSQL: the
 * task centre's "attention" ranking, the audit overview's high-risk count and
 * who last changed a setting.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("capped summaries (PostgreSQL)", () => {
	const prefix = `cap-sum-${randomUUID().slice(0, 8)}`;
	const platform = { userId: prefix, roles: ["admin" as const], currentTeamId: null };

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
		await prisma.user.createMany({
			data: [
				{ id: prefix, username: prefix, passwordHash: "not-a-login-hash" },
				{ id: `${prefix}-old`, username: `${prefix}-old`, passwordHash: "not-a-login-hash" },
			],
		});
	});
	afterAll(async () => {
		await prisma.job.deleteMany({ where: { type: `${prefix}.execute` } });
		await prisma.auditLog.deleteMany({ where: { OR: [{ teamId: prefix }, { actorId: { startsWith: prefix } }] } });
		await prisma.setting.deleteMany({ where: { key: "platform.name", value: { startsWith: prefix } } });
		await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.team.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("ranks an older failure first even behind a full page of newer pending tasks", async () => {
		const type = `${prefix}.execute`;
		const base = Date.now() - 3_600_000;
		await prisma.job.create({ data: { type, title: "old failure", payload: {}, status: "FAILED", createdBy: prefix, createdAt: new Date(base) } });
		await prisma.job.createMany({
			data: Array.from({ length: 20 }, (_, i) => ({ type, title: `pending ${i}`, payload: {}, status: "PENDING" as const, createdBy: prefix, createdAt: new Date(base + (i + 1) * 60_000) })),
		});
		const result = await listOperationTaskResult({ taskType: type, sort: "attention", limit: 20 }, platform);
		expect(result.tasks[0]).toMatchObject({ title: "old failure", status: "failed" });
		expect(result.failureSummary.length).toBeGreaterThan(0);
	});

	it("counts a rare high-risk action outside the top 20 actions", async () => {
		const actor = prefix;
		const rows = Array.from({ length: 20 }, (_, i) => [0, 1].map(() => ({ actorId: actor, actorType: "USER" as const, action: `${prefix}.common${i}`, detail: {}, teamId: prefix }))).flat();
		await prisma.auditLog.createMany({ data: [...rows, { actorId: actor, actorType: "USER", action: "server.delete", detail: {}, teamId: prefix }] });
		const stats = await getAuditStats({ userId: prefix, roles: ["admin"], currentTeamId: prefix });
		expect(stats.total).toBe(41);
		expect(stats.byAction["server.delete"]).toBeUndefined();
		expect(stats.highRiskByAction["server.delete"]).toBe(1);
	});

	it("does not credit a setting's latest change to an older audit entry", async () => {
		const tenAm = new Date(Date.now() - 2 * 3_600_000);
		await prisma.auditLog.create({
			data: { actorId: `${prefix}-old`, actorType: "USER", action: "settings.update", detail: { keys: ["platform.name"] }, createdAt: tenAm },
		});
		// Saved later; its own audit write failed (audit is best effort).
		await prisma.setting.upsert({
			where: { key: "platform.name" },
			create: { key: "platform.name", value: `${prefix} new` },
			update: { value: `${prefix} new` },
		});
		const metadata = await getSettingUpdateMetadata(["platform.name", "dashboard.layout.dragReorderEnabled"]);
		const row = await prisma.setting.findUniqueOrThrow({ where: { key: "platform.name" } });
		expect(metadata["platform.name"]).toMatchObject({ updatedAt: row.updatedAt, actorId: null, actorName: null });
	});
});
