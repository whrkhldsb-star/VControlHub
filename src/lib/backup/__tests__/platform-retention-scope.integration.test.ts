// @vitest-environment node
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { enqueueJob } from "@/lib/job/service";
import { BACKUP_RETENTION_JOB_TYPE, runBackupJobWorkerOnce } from "../job-worker";

/**
 * A schedule's retention ran over every backup of its customer: a daily
 * schedule keeping 1 day deleted a monthly schedule's 5-day-old archive.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("platform backup retention scope (PostgreSQL)", () => {
	const prefix = `pbr-${randomUUID().slice(0, 8)}`;
	const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);
	const projectRoot = path.join(os.tmpdir(), prefix);

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
		const schedule = (id: string, retentionDays: number) => ({ id: `${prefix}-${id}`, name: id, cronExpression: "0 3 * * *", backupType: "FULL", retentionDays, teamId: prefix });
		await prisma.backupSchedule.createMany({ data: [schedule("daily", 1), schedule("monthly", 30)] });
		const record = (id: string, completedAt: Date, scheduleId: string | null) => ({
			id: `${prefix}-${id}`, type: "FULL", status: "COMPLETED", filePath: `backups/${prefix}-${id}.tar.gz`, teamId: prefix, scheduleId, createdAt: completedAt, completedAt,
		});
		await prisma.backupRecord.createMany({
			data: [
				record("monthly-5d", daysAgo(5), `${prefix}-monthly`),
				record("daily-2d", daysAgo(2), `${prefix}-daily`),
				record("daily-a", new Date(), `${prefix}-daily`),
				record("daily-b", new Date(), `${prefix}-daily`),
				record("daily-c", new Date(), `${prefix}-daily`),
			],
		});
	});
	afterAll(async () => {
		await prisma.job.deleteMany({ where: { teamId: prefix } });
		await prisma.backupRecord.deleteMany({ where: { teamId: prefix } });
		await prisma.backupSchedule.deleteMany({ where: { teamId: prefix } });
		await prisma.team.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("prunes only the backups of the schedule that ran", async () => {
		// The retention job a finished daily backup queues.
		await enqueueJob({
			type: BACKUP_RETENTION_JOB_TYPE,
			title: "Backup retention (1d)",
			payload: { olderThanDays: 1, teamId: prefix, projectRoot, scheduleId: `${prefix}-daily` },
			teamId: prefix,
			maxAttempts: 1,
		});
		await expect(runBackupJobWorkerOnce()).resolves.toBe(true);
		const left = (await prisma.backupRecord.findMany({ where: { teamId: prefix }, select: { id: true } })).map((row) => row.id.slice(prefix.length + 1)).sort();
		expect(left).toEqual(["daily-a", "daily-b", "daily-c", "monthly-5d"]);
	});
});
