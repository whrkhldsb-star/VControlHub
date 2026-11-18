import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type StaleBackupKind = "platform-running" | "vps-running" | "vps-pending";

/** Decide eligibility before LIMIT, and keep ownership of each record until its transition commits. */
export async function failStaleBackupRecords(kind: StaleBackupKind, cutoff: Date, limit: number, reason: string) {
	const platform = kind === "platform-running";
	const pending = kind === "vps-pending";
	const table = platform ? Prisma.sql`backup_records` : Prisma.sql`vps_backup_records`;
	const timestamp = pending ? Prisma.sql`b."createdAt"` : Prisma.sql`b."updatedAt"`;
	const jobType = platform ? "backup.create" : "vps-backup.create";
	const payloadKey = platform ? "backupId" : "recordId";
	const now = new Date();
	const liveJob = pending
		? Prisma.sql`j.status IN ('PENDING', 'RUNNING')`
		: Prisma.sql`j.status = 'RUNNING' AND j."leaseExpiresAt" > ${now}`;
	const rows = await prisma.$queryRaw<{ id: string }[]>`
		WITH orphans AS (
			SELECT b.id, ${timestamp} AS touched FROM ${table} b
			WHERE b.status = ${pending ? "PENDING" : "RUNNING"} AND ${timestamp} < ${cutoff}
			  AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.type = ${jobType}
			      AND j.payload->>(${payloadKey}::text) = b.id AND ${liveJob})
			ORDER BY touched, b.id
			LIMIT ${limit} FOR NO KEY UPDATE OF b SKIP LOCKED
		), failed AS (
			UPDATE ${table} b SET status = 'FAILED', "errorMessage" = ${reason}, "completedAt" = ${now}, "updatedAt" = ${now}
			FROM orphans WHERE b.id = orphans.id RETURNING b.id
		)
		SELECT failed.id FROM failed JOIN orphans USING (id) ORDER BY orphans.touched, orphans.id
	`;
	return { abandoned: rows.length, ids: rows.map((row) => row.id) };
}
