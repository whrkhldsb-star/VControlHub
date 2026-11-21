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
import type { Prisma } from "@prisma/client";
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
	prepare?: (now: Date) => Promise<unknown>;
	remove: (ids: string[], before: Date) => Promise<{ count: number }>;
};

function itsmPruner(days: number, rejected: boolean): Pruner {
	const where = (before: Date): Prisma.ItsmEventWhereInput => ({
		eventType: rejected ? "security.rejected" : { not: "security.rejected" },
		OR: [{ status: { in: ["ok", "ignored"] } }, { status: "error", externalId: null }],
		createdAt: { lt: before },
		payload: { path: ["terminalAtMs"], lt: before.getTime() },
	});
	return {
		days,
		find: (before, take) => prisma.itsmEvent.findMany({
			where: where(before), orderBy: { createdAt: "asc" }, take, select: { id: true },
		}),
		remove: (ids, before) => prisma.itsmEvent.deleteMany({ where: { ...where(before), id: { in: ids } } }),
	};
}

// Older rows have no terminal timestamp. Start their clock at first observation
// instead of guessing from createdAt. Bound the upgrade work on each sweep.
function dateLegacyTerminalEvents(now: Date) {
	return prisma.$executeRaw`
		WITH legacy AS (
			SELECT id FROM itsm_events WHERE
				(status IN ('ok', 'ignored') OR (status = 'error' AND "externalId" IS NULL))
				AND jsonb_typeof(payload) = 'object' AND NOT (payload ? 'terminalAtMs')
			ORDER BY "createdAt", id LIMIT ${BATCH_SIZE} FOR UPDATE SKIP LOCKED
		)
		UPDATE itsm_events e SET payload = jsonb_set(e.payload, '{terminalAtMs}', to_jsonb(${now.getTime()}::bigint))
		FROM legacy WHERE e.id = legacy.id
	`;
}

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
			// A session awaiting manual recovery (outcome unknown, chunks kept on
			// disk) is not history: its metadata is what the recovery runbook
			// lists. It goes only once an administrator resolved it.
			where: { status: { in: ["COMPLETED", "CANCELLED", "FAILED"] }, recoveryRequired: false, updatedAt: { lt: before } },
			orderBy: { updatedAt: "asc" }, take, select: { id: true },
		}),
		remove: (ids) => prisma.mediaUploadSession.deleteMany({ where: { id: { in: ids }, recoveryRequired: false } }),
	},
	mediaUploadRecovery: {
		// Uploads whose outcome stayed unknown kept their ≤ 2 GiB assembled file
		// for ever (A4-19). Ninety days is long past any recovery; the temp dir
		// goes with the row.
		days: 90,
		find: (before, take) => prisma.mediaUploadSession.findMany({
			where: { recoveryRequired: true, updatedAt: { lt: before } },
			orderBy: { updatedAt: "asc" }, take, select: { id: true },
		}),
		remove: async (ids) => {
			// Loaded on demand: the upload module reads the media config at import time.
			const { cleanupMediaUploadTempDir } = await import("@/lib/upload/service");
			for (const id of ids) await cleanupMediaUploadTempDir(id).catch(() => undefined);
			return prisma.mediaUploadSession.deleteMany({ where: { id: { in: ids }, recoveryRequired: true } });
		},
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
	itsmEvent: { ...itsmPruner(90, false), prepare: dateLegacyTerminalEvents },
	itsmRejectedEvent: itsmPruner(7, true),
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
			await pruner.prepare?.(now);
			for (let batch = 0; batch < MAX_BATCHES_PER_TABLE; batch++) {
				const rows = await pruner.find(before, BATCH_SIZE);
				if (rows.length === 0) break;
				deleted += (await pruner.remove(rows.map((row) => row.id), before)).count;
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
