/**
 * Audit log lifecycle — prune rows older than the configured retention.
 *
 * audit_logs is the fastest-growing table in the schema (one row per login,
 * command execution, file operation) and previously had no retention path at
 * all, so it grew unbounded inside the shared application database. The job
 * maintenance worker calls pruneAuditLogs on its regular tick.
 *
 * Deletes run in bounded batches: the first run after enabling retention on a
 * mature instance can face millions of eligible rows, and one unbounded
 * deleteMany would hold locks and WAL for minutes.
 */
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";

const MAX_BATCHES_PER_SWEEP = 40;

export type AuditPruneResult = {
	/** Rows actually deleted this sweep. */
	deleted: number;
	/** Retention in effect this sweep (days); 0 means retention disabled. */
	retentionDays: number;
	/** True when the sweep hit its batch cap (more eligible rows remain). */
	truncated: boolean;
};

export async function pruneAuditLogs(options?: {
	retentionDays?: number;
	batchSize?: number;
}): Promise<AuditPruneResult> {
	const retentionDays = options?.retentionDays ?? config.audit.retentionDays;
	if (retentionDays <= 0) {
		return { deleted: 0, retentionDays: 0, truncated: false };
	}

	const batchSize = Math.min(Math.max(options?.batchSize ?? config.audit.pruneBatchSize, 100), 20_000);
	const olderThan = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

	let deleted = 0;
	let truncated = false;
	for (let batch = 0; batch < MAX_BATCHES_PER_SWEEP; batch++) {
		// Prisma deleteMany has no LIMIT: filtering only by createdAt would
		// delete the entire backlog in one statement. Select at most one batch
		// of indexed IDs, then delete only those rows.
		const rows = await prisma.auditLog.findMany({
			where: { createdAt: { lt: olderThan } },
			orderBy: [{ createdAt: "asc" }, { id: "asc" }],
			take: batchSize,
			select: { id: true },
		});
		if (rows.length === 0) return { deleted, retentionDays, truncated: false };
		const result = await prisma.auditLog.deleteMany({
			where: { id: { in: rows.map((row) => row.id) } },
		});
		deleted += result.count;
		if (rows.length < batchSize) {
			truncated = false;
			return { deleted, retentionDays, truncated };
		}
		truncated = true;
	}
	return { deleted, retentionDays, truncated };
}
