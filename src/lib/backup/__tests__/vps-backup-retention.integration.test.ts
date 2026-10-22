// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { pruneOldVpsBackupRecords } from "../vps-backup-service";
import { pruneAfterBackup } from "../vps-backup-job-worker";

/**
 * Retention never removes a server's last good backup of a type. With backups
 * failing for longer than the window, every completed one was older than the
 * cutoff and age alone deleted them all.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("VPS backup retention floor (PostgreSQL)", () => {
	const prefix = `vbr-${randomUUID().slice(0, 8)}`;
	const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.server.create({ data: { id: prefix, name: prefix, host: "vbr.test", username: "root", tags: [] } });
		await prisma.vpsBackupRecord.createMany({
			data: [
				{ id: `${prefix}-full-old`, serverId: prefix, backupType: "full", status: "COMPLETED", completedAt: daysAgo(30) },
				{ id: `${prefix}-full-new`, serverId: prefix, backupType: "full", status: "COMPLETED", completedAt: daysAgo(20) },
				{ id: `${prefix}-files`, serverId: prefix, backupType: "files", status: "COMPLETED", completedAt: daysAgo(25) },
				{ id: `${prefix}-failed`, serverId: prefix, backupType: "full", status: "FAILED", completedAt: daysAgo(1) },
			],
		});
	});
	afterAll(async () => {
		await prisma.vpsBackupRecord.deleteMany({ where: { serverId: prefix } });
		await prisma.server.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("keeps the newest completed backup of each type however old", async () => {
		await expect(pruneOldVpsBackupRecords(prefix, 7)).resolves.toBe(1);
		const left = (await prisma.vpsBackupRecord.findMany({ where: { serverId: prefix }, select: { id: true } })).map((row) => row.id).sort();
		expect(left).toEqual([`${prefix}-failed`, `${prefix}-files`, `${prefix}-full-new`].sort());
	});

	it("prunes a scheduled backup's history by its own schedule, not the server's first", async () => {
		// A paused 1-day schedule created first set the cutoff for an active
		// 30-day schedule's backups.
		const server = `${prefix}-sched`;
		await prisma.server.create({ data: { id: server, name: server, host: "vbr2.test", username: "root", tags: [] } });
		await prisma.vpsBackupSchedule.create({ data: { id: `${server}-paused`, serverId: server, name: "short", cronExpression: "0 3 * * *", backupType: "full", paths: [], retentionDays: 1, status: "PAUSED" } });
		await prisma.vpsBackupSchedule.create({ data: { id: `${server}-active`, serverId: server, name: "long", cronExpression: "0 4 * * *", backupType: "full", paths: [], retentionDays: 30 } });
		await prisma.vpsBackupRecord.createMany({
			data: [
				{ id: `${server}-5d`, serverId: server, scheduleId: `${server}-active`, backupType: "full", status: "COMPLETED", completedAt: daysAgo(5) },
				{ id: `${server}-40d`, serverId: server, scheduleId: `${server}-active`, backupType: "full", status: "COMPLETED", completedAt: daysAgo(40) },
				{ id: `${server}-now`, serverId: server, scheduleId: `${server}-active`, backupType: "full", status: "COMPLETED", completedAt: new Date() },
				{ id: `${server}-manual-5d`, serverId: server, backupType: "full", status: "COMPLETED", completedAt: daysAgo(5) },
			],
		});
		try {
			await pruneAfterBackup(`${server}-now`);
			const left = (await prisma.vpsBackupRecord.findMany({ where: { serverId: server }, select: { id: true } })).map((row) => row.id).sort();
			expect(left).toEqual([`${server}-5d`, `${server}-manual-5d`, `${server}-now`].sort());
		} finally {
			await prisma.vpsBackupRecord.deleteMany({ where: { serverId: server } });
			await prisma.vpsBackupSchedule.deleteMany({ where: { serverId: server } });
			await prisma.server.deleteMany({ where: { id: server } });
		}
	});
});
