import { Prisma } from "@prisma/client";
import { teamWhere } from "@/lib/auth/team-scope";
import type { SessionPayload } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { DEFAULT_KEEP_LATEST_PER_TYPE, DEFAULT_RETENTION_DAYS, FAILURE_CATEGORIES, summarizeBackupPolicy } from "./service-policy";
import { isBackupType, type BackupFailureSummaryItem, type BackupPolicySummary } from "./service-types";

type Aggregate = {
	type: string; status: string; count: number; bytes: number; older: number; eligible: number; eligibleBytes: number;
	oldest: Date; latest: Date; largest: number; path: string;
};

/** The manual cleanup always has one owner, including the platform (null). */
export async function getBackupPolicySummary(session?: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">) {
	const visible = session ? teamWhere(session) : {};
	const teamId = visible.teamId ?? null;
	const cutoff = new Date(Date.now() - DEFAULT_RETENTION_DAYS * 86_400_000);
	return prisma.$transaction(async (tx) => {
		const groups = await tx.$queryRaw<Aggregate[]>`
			WITH ranked AS (
				SELECT type, status, "filePath", COALESCE("completedAt", "createdAt") AS finished, "createdAt",
					CASE WHEN trim("fileSize") ~ '^[0-9]+$' THEN trim("fileSize")::numeric ELSE 0 END AS bytes,
					row_number() OVER (PARTITION BY type, status ORDER BY COALESCE("completedAt", "createdAt") DESC, "createdAt" DESC, id) AS position
				FROM backup_records WHERE "teamId" IS NOT DISTINCT FROM ${teamId}::text
			), candidates AS (
				SELECT *, (status = 'PRUNING' OR (status IN ('FAILED', 'VOIDED') AND "createdAt" < ${cutoff})
					OR (status = 'COMPLETED' AND type IN ('FILES','FULL','DATABASE') AND position > ${DEFAULT_KEEP_LATEST_PER_TYPE} AND finished < ${cutoff})) AS eligible
				FROM ranked
			)
			SELECT type, status, count(*)::int AS count, sum(bytes)::float8 AS bytes,
				min(finished) AS oldest, max(finished) AS latest, max(bytes)::float8 AS largest,
				(array_agg("filePath" ORDER BY bytes DESC, finished DESC))[1] AS path,
				count(*) FILTER (WHERE finished < ${cutoff})::int AS older, count(*) FILTER (WHERE eligible)::int AS eligible,
				coalesce(sum(bytes) FILTER (WHERE eligible),0)::float8 AS "eligibleBytes"
			FROM candidates GROUP BY type, status
		`;
		const summary: BackupPolicySummary = summarizeBackupPolicy([]);
		const categories = FAILURE_CATEGORIES.map(([category, pattern]) => Prisma.sql`
			WHEN lower("errorMessage") ~ ${pattern.source} THEN ${category}::text`);
		summary.failureSummary = await tx.$queryRaw<BackupFailureSummaryItem[]>`
			WITH failures AS (
				SELECT id, CASE ${Prisma.join(categories, " ")} ELSE 'unknown' END AS category,
					COALESCE("completedAt", "createdAt") AS finished, "filePath" AS "latestRecordPath",
					COALESCE(NULLIF("errorMessage", ''), NULLIF(note, '')) AS "latestMessage"
				FROM backup_records WHERE "teamId" IS NOT DISTINCT FROM ${teamId}::text AND status = 'FAILED'
			), latest AS (
				SELECT DISTINCT ON (category) *, (count(*) OVER (PARTITION BY category))::int AS count
				FROM failures ORDER BY category, finished DESC, id
			)
			SELECT category, count, "latestMessage", "latestRecordPath" FROM latest ORDER BY count DESC, finished DESC
		`;
		let eligibleRecords = 0;
		let eligibleSizeBytes = 0;
		for (const group of groups) {
			summary.totalRecords += group.count;
			eligibleRecords += group.eligible;
			eligibleSizeBytes += group.eligibleBytes;
			if (group.status === "FAILED") summary.failedRecords += group.count;
			if (group.status === "RUNNING" || group.status === "PENDING") summary.runningRecords += group.count;
			if (group.status !== "COMPLETED") continue;
			summary.completedRecords += group.count;
			summary.totalCompletedSizeBytes += group.bytes;
			summary.recordsOlderThan30Days += group.older;
			if (isBackupType(group.type)) summary.byType[group.type] = { count: group.count, sizeBytes: group.bytes };
			if (!summary.oldestCompletedAt || group.oldest < summary.oldestCompletedAt) summary.oldestCompletedAt = group.oldest;
			if (!summary.latestCompletedAt || group.latest > summary.latestCompletedAt) summary.latestCompletedAt = group.latest;
			if (!summary.largestCompleted || group.largest > summary.largestCompleted.sizeBytes) {
				summary.largestCompleted = { type: group.type, sizeBytes: group.largest, filePath: group.path };
			}
		}
		const inventoryTotalRecords = visible.teamId ? summary.totalRecords : await tx.backupRecord.count({ where: visible });
		return { ...summary, teamId, eligibleRecords, eligibleSizeBytes, inventoryTotalRecords };
	}, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
