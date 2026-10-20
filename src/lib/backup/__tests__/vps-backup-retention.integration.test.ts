// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { pruneOldVpsBackupRecords } from "../vps-backup-service";

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
});
