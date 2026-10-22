// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { abandonStalePendingBackupRecords } from "../service-crud";

/**
 * The stale-PENDING sweep voids backups nobody will run. It judged by the
 * record's creation: a two-day-old failure retried just now (fresh job
 * queued) was voided before the job could start.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("stale PENDING backups (PostgreSQL)", () => {
	const prefix = `bkstale-${randomUUID().slice(0, 8)}`;
	const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000);

	beforeAll(async () => {
		const database = new URL(process.env.DATABASE_URL!);
		if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
			throw new Error("requires an isolated loopback audit/test database");
		}
		await prisma.backupRecord.createMany({
			data: [
				{ id: `${prefix}-retried`, type: "DATABASE", status: "PENDING", filePath: `backups/${prefix}-a.sql.gz`, createdAt: twoDaysAgo },
				{ id: `${prefix}-orphan`, type: "DATABASE", status: "PENDING", filePath: `backups/${prefix}-b.sql.gz`, createdAt: twoDaysAgo },
			] as never,
		});
		// The orphan has not moved for two days; the retried one was queued now.
		await prisma.$executeRaw`UPDATE backup_records SET "updatedAt" = ${twoDaysAgo} WHERE id = ${`${prefix}-orphan`}`;
		await prisma.job.create({ data: { id: `${prefix}-job`, type: "backup.create", title: "retry", payload: { backupId: `${prefix}-retried` }, status: "PENDING" } });
	});
	afterAll(async () => {
		await prisma.job.deleteMany({ where: { id: `${prefix}-job` } });
		await prisma.backupRecord.deleteMany({ where: { id: { startsWith: prefix } } });
		await prisma.$disconnect();
	});

	it("voids the orphan and leaves the freshly queued retry", async () => {
		const result = await abandonStalePendingBackupRecords();
		expect(result.ids.filter((id) => id.startsWith(prefix))).toEqual([`${prefix}-orphan`]);
		expect((await prisma.backupRecord.findUniqueOrThrow({ where: { id: `${prefix}-retried` } })).status).toBe("PENDING");
	});
});
