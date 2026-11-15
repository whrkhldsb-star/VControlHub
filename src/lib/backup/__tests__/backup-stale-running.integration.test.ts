// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { abandonStaleRunningBackupRecords } from "../service";
import { BACKUP_CREATE_JOB_TYPE } from "../service-types";

/**
 * A platform backup may now run for two hours, and its record is touched only when the command starts and
 * ends. A record past the sweep's window whose backup job still renews its lease is a backup in progress,
 * not one a dead worker left behind.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("stale RUNNING platform backups (PostgreSQL)", () => {
	const prefix = `bkstale-${randomUUID().slice(0, 8)}`;

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.backupRecord.createMany({
			data: [
				{ id: `${prefix}-busy`, type: "FULL", status: "RUNNING", filePath: `backups/${prefix}-busy.tar.gz` },
				{ id: `${prefix}-dead`, type: "FULL", status: "RUNNING", filePath: `backups/${prefix}-dead.tar.gz` },
			],
		});
		// A minute past the sweep's window (the command limit plus verification; 135 minutes by default), in
		// UTC wall time as the columns hold it.
		const minutes = Math.ceil(config.backup.staleRunningAfterMs / 60_000) + 1;
		await prisma.$executeRaw`UPDATE backup_records SET "updatedAt" = (NOW() AT TIME ZONE 'UTC') - make_interval(mins => ${minutes}::int) WHERE id LIKE ${`${prefix}-%`}`;
		await prisma.job.create({
			data: { id: `${prefix}-job`, type: BACKUP_CREATE_JOB_TYPE, title: "backup", payload: { backupId: `${prefix}-busy` }, status: "RUNNING", leaseExpiresAt: new Date(Date.now() + 5 * 60_000) },
		});
	});
	afterAll(async () => {
		await prisma.job.deleteMany({ where: { id: `${prefix}-job` } });
		await prisma.backupRecord.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("leaves a backup whose job still holds its lease and fails the abandoned one", async () => {
		const result = await abandonStaleRunningBackupRecords();
		expect(result.ids.filter((id) => id.startsWith(prefix))).toEqual([`${prefix}-dead`]);
		expect((await prisma.backupRecord.findUniqueOrThrow({ where: { id: `${prefix}-busy` } })).status).toBe("RUNNING");
		expect((await prisma.backupRecord.findUniqueOrThrow({ where: { id: `${prefix}-dead` } })).status).toBe("FAILED");
	});
});
