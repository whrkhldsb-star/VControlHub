// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { abandonStaleRunningVpsBackupRecords, VPS_BACKUP_CREATE_JOB_TYPE } from "../vps-backup-service";

/**
 * The record of a long transfer is not touched while it runs; its job's
 * lease is. A record older than the reaper's window whose job still holds a
 * live lease is a backup in progress and must not be failed.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("stale RUNNING VPS backups (PostgreSQL)", () => {
	const prefix = `vbstale-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.server.create({ data: { id: prefix, name: prefix, host: "vbstale.test", username: "root", tags: [] } });
		await prisma.vpsBackupRecord.createMany({
			data: [
				{ id: `${prefix}-busy`, serverId: prefix, backupType: "full", status: "RUNNING" },
				{ id: `${prefix}-dead`, serverId: prefix, backupType: "full", status: "RUNNING" },
			],
		});
		// Both last touched a minute past the reaper's window (the remote command's limit plus download and
		// upload; 95 minutes by default). Columns hold UTC wall time: a bare NOW() is the session zone's, hours
		// off on a PostgreSQL not set to UTC.
		const minutes = Math.ceil(config.backup.vpsStaleRunningAfterMs / 60_000) + 1;
		await prisma.$executeRaw`UPDATE vps_backup_records SET "updatedAt" = (NOW() AT TIME ZONE 'UTC') - make_interval(mins => ${minutes}::int) WHERE "serverId" = ${prefix}`;
		await prisma.job.create({
			data: { id: `${prefix}-job`, type: VPS_BACKUP_CREATE_JOB_TYPE, title: "backup", payload: { recordId: `${prefix}-busy` }, status: "RUNNING", leaseExpiresAt: new Date(Date.now() + 5 * 60_000) },
		});
	});
	afterAll(async () => {
		await prisma.job.deleteMany({ where: { id: `${prefix}-job` } });
		await prisma.vpsBackupRecord.deleteMany({ where: { serverId: prefix } });
		await prisma.server.deleteMany({ where: { id: prefix } });
		await prisma.$disconnect();
	});

	it("leaves a backup whose job still holds its lease and fails the abandoned one", async () => {
		const result = await abandonStaleRunningVpsBackupRecords();
		expect(result.ids.filter((id) => id.startsWith(prefix))).toEqual([`${prefix}-dead`]);
		const busy = await prisma.vpsBackupRecord.findUniqueOrThrow({ where: { id: `${prefix}-busy` } });
		expect(busy.status).toBe("RUNNING");
	});
});
