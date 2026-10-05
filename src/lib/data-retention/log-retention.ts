/**
 * Retention for append-only history tables that had no cleanup path.
 *
 * Each table below gains a row per event and was never pruned: agent jobs
 * (stdout up to 8 MiB per row), playbook runs, sync logs, finished upload
 * sessions, cloud-billing sync runs, and two tables anonymous traffic can
 * write to — share access logs (every public share hit) and ITSM events
 * (every rejected inbound signature). Only terminal rows older than the
 * table's retention are deleted; in-flight rows are never touched.
 *
 * Not here, on purpose: ExecutionLog and ScheduledTaskRun cascade from
 * CommandRequest (pruned by operation-task retention); backup records are
 * pruned with their archives by the backup domain; deployment snapshots and
 * daily cost/uptime rollups are small, long-lived history users read.
 *
 * LOG_RETENTION_DAYS overrides every table's default; 0 disables pruning.
 */
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;
const BATCH_SIZE = 2_000;
/** At most this many batches per table per sweep, so one huge backlog cannot stall a tick. */
const MAX_BATCHES_PER_TABLE = 10;

type Pruner = {
	/** Default retention in days for this table. */
	days: number;
	/** IDs of up to `take` prunable rows older than `before`, oldest first. */
	find: (before: Date, take: number) => Promise<Array<{ id: string }>>;
	remove: (ids: string[]) => Promise<{ count: number }>;
};

export const LOG_RETENTION_TABLES = {
	serverAgentJob: {
		days: 30,
		find: (before, take) => prisma.serverAgentJob.findMany({
			where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] }, createdAt: { lt: before } },
			orderBy: { createdAt: "asc" }, take, select: { id: true },
		}),
		remove: (ids) => prisma.serverAgentJob.deleteMany({ where: { id: { in: ids } } }),
	},
	mediaUploadSession: {
		days: 30,
		find: (before, take) => prisma.mediaUploadSession.findMany({
			where: { status: { in: ["COMPLETED", "CANCELLED", "FAILED"] }, updatedAt: { lt: before } },
			orderBy: { updatedAt: "asc" }, take, select: { id: true },
		}),
		remove: (ids) => prisma.mediaUploadSession.deleteMany({ where: { id: { in: ids } } }),
	},
	playbookRun: {
		days: 90,
		find: (before, take) => prisma.playbookRun.findMany({
			where: { status: { in: ["completed", "failed", "cancelled"] }, createdAt: { lt: before } },
			orderBy: { createdAt: "asc" }, take, select: { id: true },
		}),
		remove: (ids) => prisma.playbookRun.deleteMany({ where: { id: { in: ids } } }),
	},
	syncLog: {
		days: 90,
		find: (before, take) => prisma.syncLog.findMany({
			where: { status: { in: ["COMPLETED", "FAILED"] }, startedAt: { lt: before } },
			orderBy: { startedAt: "asc" }, take, select: { id: true },
		}),
		remove: (ids) => prisma.syncLog.deleteMany({ where: { id: { in: ids } } }),
	},
	itsmEvent: {
		days: 90,
		find: (before, take) => prisma.itsmEvent.findMany({
			where: { createdAt: { lt: before } },
			orderBy: { createdAt: "asc" }, take, select: { id: true },
		}),
		remove: (ids) => prisma.itsmEvent.deleteMany({ where: { id: { in: ids } } }),
	},
	shareAccessLog: {
		days: 180,
		find: (before, take) => prisma.shareAccessLog.findMany({
			where: { accessedAt: { lt: before } },
			orderBy: { accessedAt: "asc" }, take, select: { id: true },
		}),
		remove: (ids) => prisma.shareAccessLog.deleteMany({ where: { id: { in: ids } } }),
	},
	cloudBillingSyncRun: {
		days: 180,
		find: (before, take) => prisma.cloudBillingSyncRun.findMany({
			where: { status: { not: "running" }, startedAt: { lt: before } },
			orderBy: { startedAt: "asc" }, take, select: { id: true },
		}),
		remove: (ids) => prisma.cloudBillingSyncRun.deleteMany({ where: { id: { in: ids } } }),
	},
} satisfies Record<string, Pruner>;

export type LogRetentionTable = keyof typeof LOG_RETENTION_TABLES;

export type LogRetentionResult = {
	deleted: Partial<Record<LogRetentionTable, number>>;
	/** Tables that still had eligible rows when their batch cap was reached. */
	truncated: LogRetentionTable[];
	failed: Partial<Record<LogRetentionTable, string>>;
};

export function retentionDaysFor(table: LogRetentionTable, override = config.retention.logRetentionDays): number {
	return override ?? LOG_RETENTION_TABLES[table].days;
}

export async function pruneLogTables(options: { now?: Date; overrideDays?: number | null } = {}): Promise<LogRetentionResult> {
	const now = options.now ?? new Date();
	const override = options.overrideDays === undefined ? config.retention.logRetentionDays : options.overrideDays;
	const result: LogRetentionResult = { deleted: {}, truncated: [], failed: {} };
	for (const [name, pruner] of Object.entries(LOG_RETENTION_TABLES) as Array<[LogRetentionTable, Pruner]>) {
		const days = override ?? pruner.days;
		if (days <= 0) continue;
		const before = new Date(now.getTime() - days * DAY_MS);
		let deleted = 0;
		try {
			for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch++) {
				const rows = await pruner.find(before, BATCH_SIZE);
				if (rows.length === 0) break;
				deleted += (await pruner.remove(rows.map((row) => row.id))).count;
				if (rows.length < BATCH_SIZE) break;
				if (batch === MAX_BATCHES_PER_TABLE - 1) result.truncated.push(name);
			}
		} catch (error) {
			result.failed[name] = error instanceof Error ? error.message : String(error);
		}
		if (deleted > 0) result.deleted[name] = deleted;
	}
	return result;
}
