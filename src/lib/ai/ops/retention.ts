import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { AI_OPS_LOG_RETENTION_KEEP, AI_OPS_SCAN_JOB_TYPE, type AiOpsRecommendedAction } from "./types";

// Sample workers retain 50 runs. For other types retain the largest worker history (200).
// Both planning and execution exclude these rows, even if other maintenance ran after review.
function excessCompletedJobs(cutoff: Date, types = Prisma.empty) {
	return Prisma.sql`SELECT id, "updatedAt" FROM (
		SELECT id, type, "updatedAt", row_number() OVER (PARTITION BY type ORDER BY "updatedAt" DESC, id DESC) AS position
		FROM jobs WHERE status = 'COMPLETED' ${types}
	) ranked WHERE "updatedAt" < ${cutoff} AND position > CASE WHEN type IN ('health.sample', 'traffic.sample') THEN 50 ELSE 200 END`;
}

export async function planJobCleanup(cutoff: Date) {
	const candidates = await prisma.$queryRaw<Array<{ id: string; excess: bigint }>>`
		SELECT id, count(*) OVER () AS excess FROM (${excessCompletedJobs(cutoff)}) excess_jobs
		ORDER BY "updatedAt", id LIMIT 1000`;
	return { count: Number(candidates[0]?.excess ?? 0), cutoff: cutoff.toISOString(), ids: candidates.map(({ id }) => id) };
}

export async function pruneReviewedJobs(tx: Prisma.TransactionClient, scope: NonNullable<AiOpsRecommendedAction["cleanup"]>) {
	if (!scope.ids.length) return 0;
	const ids = Prisma.join(scope.ids);
	const cutoff = new Date(scope.cutoff);
	const types = Prisma.sql`AND type IN (SELECT type FROM jobs WHERE id IN (${ids}))`;
	return tx.$executeRaw`DELETE FROM jobs WHERE id IN (${ids}) AND status = 'COMPLETED' AND "updatedAt" < ${cutoff}
		AND id IN (SELECT id FROM (${excessCompletedJobs(cutoff, types)}) still_excess)`;
}

/** Keep the newest logs, including any inserted between finding the boundary and deleting. */
export async function pruneAiOpsLogs(currentLogId?: string) {
	// A process can also die on its final attempt. The queue reaper may then
	// terminate or prune the Job without ever handing it to a new scan worker.
	await prisma.$executeRaw`UPDATE ai_ops_logs l SET status = 'skipped', "completedAt" = CURRENT_TIMESTAMP,
		"updatedAt" = CURRENT_TIMESTAMP, "errorMessage" = 'The scan lost its job lease'
		WHERE l.status = 'running' AND l."jobId" IS NOT NULL AND NOT EXISTS (
			SELECT 1 FROM jobs j WHERE j.id = l."jobId" AND j.status IN ('PENDING', 'RUNNING')
		)`;
	const [boundary] = await prisma.aiOpsLog.findMany({
		orderBy: [{ createdAt: "desc" }, { id: "desc" }],
		skip: AI_OPS_LOG_RETENTION_KEEP - 1,
		take: 1,
		select: { createdAt: true, id: true },
	});
	if (!boundary) return { count: 0 };
	// A completed report is also the dispatch receipt until its Job is acknowledged.
	const active = await prisma.job.findMany({
		where: { type: AI_OPS_SCAN_JOB_TYPE, status: { in: ["PENDING", "RUNNING"] } },
		select: { id: true },
	});
	return prisma.aiOpsLog.deleteMany({ where: {
		...(currentLogId ? { id: { not: currentLogId } } : {}),
		status: { not: "running" },
		...(active.length ? { AND: [{ OR: [{ jobId: null }, { jobId: { notIn: active.map((job) => job.id) } }] }] } : {}),
		OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }],
	} });
}
