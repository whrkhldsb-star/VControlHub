// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { pruneJobEvents } from "@/lib/job/events";
import { pruneOperationTaskHistory } from "../retention";

/**
 * Retention on a real PostgreSQL. Everything here is dated in 2001 and pruned
 * with a 2002 cut-off, so rows of other tests are never in reach.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("operation history retention (PostgreSQL)", () => {
	const prefix = `ret-${randomUUID().slice(0, 8)}`;
	const old = (day: number) => new Date(Date.UTC(2001, 0, day));
	const cutoff = new Date(Date.UTC(2002, 0, 1));

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
	});
	afterAll(async () => {
		await prisma.job.deleteMany({ where: { type: prefix } });
		await prisma.deploymentSnapshot.deleteMany({ where: { templateName: prefix } });
		await prisma.commandTemplate.deleteMany({ where: { name: prefix } });
		await prisma.team.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("keeps a finished deployment while its rollback is still pending", async () => {
		// The rollback cascades with its source run: deleting the run lost the
		// record of a rollback command that kept going.
		const template = await prisma.commandTemplate.create({ data: { name: prefix, command: "deploy", teamId: prefix } });
		const run = (day: number) => prisma.deploymentRun.create({
			data: { templateId: template.id, variables: {}, renderedCommand: "deploy", serverIds: [], status: "COMPLETED", teamId: prefix, createdAt: old(day) },
		});
		const plain = await run(1);
		const rolling = await run(2);
		const newest = await run(3);
		const snapshot = await prisma.deploymentSnapshot.create({
			data: { templateId: template.id, templateName: prefix, deployCommand: "deploy", variables: {}, serverIds: [] },
		});
		await prisma.deploymentRollbackRun.create({
			data: { sourceRunId: rolling.id, snapshotId: snapshot.id, rollbackCommand: "rollback", status: "PENDING", serverIds: [] },
		});

		await pruneOperationTaskHistory({ olderThan: cutoff, keepLatest: 1 });
		const left = (await prisma.deploymentRun.findMany({ where: { teamId: prefix }, select: { id: true } })).map((row) => row.id);
		expect(left.sort()).toEqual([rolling.id, newest.id].sort());
		expect(left).not.toContain(plain.id);
	});

	it("prunes every job over its event budget, not a first slice of jobs with old events", async () => {
		// 600 quiet jobs with one old event each, then one crowded job.
		await prisma.job.createMany({ data: Array.from({ length: 600 }, (_, i) => ({ id: `${prefix}-q${i}`, type: prefix, title: "quiet", payload: {}, createdAt: old(1) })) });
		await prisma.jobEvent.createMany({ data: Array.from({ length: 600 }, (_, i) => ({ jobId: `${prefix}-q${i}`, type: "log", message: "x", createdAt: old(1) })) });
		const crowded = await prisma.job.create({ data: { id: `${prefix}-zz-crowded`, type: prefix, title: "crowded", payload: {}, createdAt: old(2) } });
		await prisma.jobEvent.createMany({ data: Array.from({ length: 8 }, (_, i) => ({ jobId: crowded.id, type: "log", message: `e${i}`, createdAt: old(2 + i) })) });

		await pruneJobEvents({ keepLatest: 3, olderThan: cutoff });
		expect(await prisma.jobEvent.count({ where: { jobId: crowded.id } })).toBe(3);
		expect(await prisma.jobEvent.count({ where: { jobId: `${prefix}-q0` } })).toBe(1);
	});
});
