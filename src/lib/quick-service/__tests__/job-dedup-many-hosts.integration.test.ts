// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { closeAdvisoryLockPoolForTests } from "@/lib/concurrency/advisory-lock";
import { enqueueQuickServiceJob, QUICK_SERVICE_JOB_TYPE } from "../job-worker";

/**
 * One app, many hosts. The active-job check read the app's first 20 jobs
 * and then looked for this host among them: with 20 other hosts queued, a
 * second start for host 21 was queued again instead of reused.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("quick service job reuse with many hosts (PostgreSQL)", () => {
	const slug = `qsdedup-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.job.createMany({
			data: Array.from({ length: 21 }, (_, i) => ({
				type: QUICK_SERVICE_JOB_TYPE,
				title: `start ${i}`,
				status: "PENDING" as const,
				createdAt: new Date(Date.now() - (30 - i) * 1000),
				payload: { action: "start", slug, instanceKey: `server:host-${i}`, serverId: `host-${i}` },
			})),
		});
	});
	afterAll(async () => {
		await prisma.job.deleteMany({ where: { type: QUICK_SERVICE_JOB_TYPE, payload: { path: ["slug"], equals: slug } } });
		await closeAdvisoryLockPoolForTests();
		await prisma.$disconnect();
	});

	it("reuses host 21's queued start", async () => {
		const result = await enqueueQuickServiceJob({ title: "start again", payload: { action: "start", slug, instanceKey: "server:host-20", serverId: "host-20" } as never });
		expect(result.reused).toBe(true);
		expect(await prisma.job.count({ where: { type: QUICK_SERVICE_JOB_TYPE, payload: { path: ["slug"], equals: slug } } })).toBe(21);
	});
});
