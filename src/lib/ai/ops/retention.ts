import { prisma } from "@/lib/db";
import { AI_OPS_LOG_RETENTION_KEEP, AI_OPS_SCAN_JOB_TYPE } from "./types";

/** Keep the newest logs, including any inserted between finding the boundary and deleting. */
export async function pruneAiOpsLogs(currentLogId?: string) {
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
