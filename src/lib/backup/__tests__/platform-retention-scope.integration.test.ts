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
		const admin = await prisma.role.upsert({ where: { key: "admin" }, create: { key: "admin", name: "Admin" }, update: {} });
		await prisma.user.create({ data: {
			id: prefix, username: prefix, passwordHash: "not-a-login-hash", status: "ACTIVE", mustChangePassword: false,
			roles: { create: { roleId: admin.id } },
		} });
		await prisma.team.create({ data: { id: prefix, slug: prefix, name: prefix } });
		const schedule = (id: string, retentionDays: number) => ({ id: `${prefix}-${id}`, name: id, cronExpression: "0 3 * * *", backupType: "FULL", retentionDays, teamId: prefix });
		await prisma.backupSchedule.createMany({ data: [schedule("daily", 1), schedule("monthly", 30)] });
		const record = (id: string, completedAt: Date, scheduleId: string | null) => ({
			id: `${prefix}-${id}`, type: "FULL", status: "COMPLETED", filePath: `backups/${prefix}-${id}.tar.gz`, offsiteKey: `${prefix}-parked`, teamId: prefix, scheduleId, createdAt: completedAt, completedAt,
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
		await prisma.user.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("prunes only the backups of the schedule that ran", async () => {
		// The retention job a finished daily backup queues.
		await enqueueJob({
			type: BACKUP_RETENTION_JOB_TYPE,
			title: "Backup retention (1d)",
			payload: { olderThanDays: 1, teamId: prefix, projectRoot, scheduleId: `${prefix}-daily` },
			teamId: prefix,
			createdBy: prefix, maxAttempts: 1,
		});
		await expect(runBackupJobWorkerOnce()).resolves.toBe(true);
		const left = (await prisma.backupRecord.findMany({ where: { teamId: prefix }, select: { id: true } })).map((row) => row.id.slice(prefix.length + 1)).sort();
		expect(left).toEqual(["daily-a", "daily-b", "daily-c", "monthly-5d"]);
	});

	it("aggregates more than 500 records across pages, separates inventory, and matches manual cleanup", async () => {
		const { getBackupPolicySummary } = await import("../policy-summary");
		const { pruneOldBackupRecordsNow } = await import("../service-runtime");
		const teamId = prefix + "-summary";
		await prisma.team.create({ data: { id: teamId, name: teamId, slug: teamId } });
		try {
			const rows = Array.from({ length: 506 }, (_, i) => ({ id: teamId + i, type: "DATABASE", teamId,
				status: "COMPLETED", filePath: "backups/" + teamId + i, offsiteKey: `${prefix}-parked`, createdAt: daysAgo(i < 501 ? 1 : 40), fileSize: "7" }));
			await prisma.backupRecord.createMany({ data: rows });
			const admin = { userId: prefix, roles: ["admin" as const], currentTeamId: teamId };
			const { listBackupRecords } = await import("../service-crud");
			const { summarizeBackupPolicy } = await import("../service-policy");
			const page = await listBackupRecords(admin);
			expect(page).toHaveLength(500);
			const scoped = summarizeBackupPolicy(page);
			expect(scoped).toMatchObject({ totalRecords: 506, eligibleRecords: 5, totalCompletedSizeBytes: 3542, eligibleSizeBytes: 35, inventoryTotalRecords: 506 });
			const platform = await getBackupPolicySummary({ ...admin, currentTeamId: null });
			expect(platform.inventoryTotalRecords).toBeGreaterThanOrEqual(platform.totalRecords + 506);
			const actual = await pruneOldBackupRecordsNow({ teamId, projectRoot });
			expect(actual.deletedRecords).toBe(page.policySummary.eligibleRecords);
			await prisma.backupRecord.createMany({ data: [1, 2].map((day) => ({
				type: "DATABASE", teamId, status: "FAILED", filePath: "failed-" + day,
				errorMessage: "Permission denied " + day, createdAt: daysAgo(day),
			})) });
			expect((await getBackupPolicySummary(admin)).failureSummary).toEqual([
				{ category: "permission", count: 2, latestMessage: "Permission denied 1", latestRecordPath: "failed-1" },
			]);
		} finally {
			await prisma.backupRecord.deleteMany({ where: { teamId } });
			await prisma.team.delete({ where: { id: teamId } });
		}
	});
});
