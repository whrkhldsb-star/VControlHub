/**
 * TR-031 E01: Cost tracking — daily snapshot worker.
 *
 * Aggregates the day's `cost_entries` into a `CostSnapshot` row once per
 * day. Idempotent: re-running the same day upserts the same row. The
 * snapshot is consumed by the /cost-summary trend chart and any future
 * BI / report surfaces.
 *
 * Pattern: same shape as `src/lib/operation-task/retention-worker.ts`
 *   - durable job type `cost.snapshot`
 *   - claimNextJob / heartbeatJob / completeJob / failJob
 *   - setInterval 24h + fire-once-on-startup
 *   - globalThis state mirror for re-entrancy
 */
import { JobStatus } from "@prisma/client";

import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { computeLeaseMs } from "@/lib/job/lease";
import {
	claimNextJob,
	completeJob,
	enqueueJob,
	failJob,
	heartbeatJob,
} from "@/lib/job/service";
import { createLogger } from "@/lib/logging";

import {
	COST_CATEGORY_VALUES,
	type CostCategory,
} from "./types";
import { upsertDailySnapshot } from "./service";

const logger = createLogger("cost-snapshot-worker");

export const COST_SNAPSHOT_JOB_TYPE = "cost.snapshot";
const COST_SNAPSHOT_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const COST_SNAPSHOT_LEASE_MS = computeLeaseMs("cost-snapshot");
const COST_SNAPSHOT_WORKER_ID = `${config.app.hostname || "vcontrolhub"}:cost-snapshot:${process.pid}`;

type CostSnapshotWorkerState = {
	started: boolean;
	running: boolean;
	timer: NodeJS.Timeout | null;
};

type CostSnapshotWorkerGlobal = typeof globalThis & {
	__vcontrolhubCostSnapshotWorker?: CostSnapshotWorkerState;
};

function getWorkerState(): CostSnapshotWorkerState {
	const globalState = globalThis as CostSnapshotWorkerGlobal;
	globalState.__vcontrolhubCostSnapshotWorker ??= {
		started: false,
		running: false,
		timer: null,
	};
	return globalState.__vcontrolhubCostSnapshotWorker;
}

async function hasActiveSnapshotJob(): Promise<boolean> {
	const existing = await prisma.job.findFirst({
		where: {
			type: COST_SNAPSHOT_JOB_TYPE,
			status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
		},
		select: { id: true },
	});
	return Boolean(existing);
}

async function enqueueCostSnapshotJob(reason: string) {
	if (await hasActiveSnapshotJob()) return null;
	return enqueueJob({
		type: COST_SNAPSHOT_JOB_TYPE,
		title: "成本每日聚合快照",
		payload: { reason, requestedAt: new Date().toISOString() },
		priority: -3, // Low — batch aggregation, not user-blocking
		maxAttempts: 2, // Daily cron — 1 retry is plenty
	});
}

/**
 * Build the snapshot payload for "today" (UTC). Aggregates every
 * cost_entry whose effectiveDate === today, in CNY by default.
 */
async function buildTodaySnapshot(today: Date) {
	const dayStart = new Date(
		Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate(), 0, 0, 0, 0),
	);
	const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

	const rows = await prisma.costEntry.findMany({
		where: { effectiveDate: { gte: dayStart, lt: dayEnd } },
		select: { category: true, amount: true },
		take: 10000, // P2: 单日 cost entry 数,1w 作 hard 上界
	});

	const byCategory = Object.fromEntries(
		COST_CATEGORY_VALUES.map((c) => [c, "0.00"]),
	) as Record<CostCategory, string>;

	let total = 0;
	let count = 0;
	for (const r of rows) {
		const cat = (COST_CATEGORY_VALUES as readonly string[]).includes(r.category)
			? (r.category as CostCategory)
			: "other";
		const amt = Number(r.amount.toString());
		const cur = Number(byCategory[cat] ?? "0");
		const next = (Number.isFinite(cur) ? cur : 0) + (Number.isFinite(amt) ? amt : 0);
		byCategory[cat] = next.toFixed(2);
		total += Number.isFinite(amt) ? amt : 0;
		count += 1;
	}

	return {
		snapshotDate: dayStart,
		totalAmount: total.toFixed(2),
		byCategory,
		entryCount: count,
	};
}

export async function runCostSnapshotWorkerOnce(reason = "manual"): Promise<boolean> {
	const state = getWorkerState();
	if (state.running) {
		logger.warn("Skipping cost snapshot tick because a previous tick is still running", {
			reason,
		});
		return false;
	}

	state.running = true;
	try {
		await enqueueCostSnapshotJob(reason);
		const job = await claimNextJob({
			workerId: COST_SNAPSHOT_WORKER_ID,
			types: [COST_SNAPSHOT_JOB_TYPE],
			leaseMs: COST_SNAPSHOT_LEASE_MS,
		});
		if (!job) return false;

		try {
			await heartbeatJob(job.id, COST_SNAPSHOT_WORKER_ID, {
				leaseMs: COST_SNAPSHOT_LEASE_MS,
				progress: "正在聚合当日成本",
			});
			const today = new Date();
			const payload = await buildTodaySnapshot(today);
			const snapshot = await upsertDailySnapshot(payload);
			await completeJob(job.id, COST_SNAPSHOT_WORKER_ID, {
				snapshotId: snapshot.id,
				snapshotDate: snapshot.snapshotDate,
				totalAmount: snapshot.totalAmount,
				entryCount: snapshot.entryCount,
				reason,
			});
			logger.info("Cost daily snapshot written", {
				snapshotId: snapshot.id,
				snapshotDate: snapshot.snapshotDate,
				totalAmount: snapshot.totalAmount,
				entryCount: snapshot.entryCount,
			});
			return true;
		} catch (error) {
			const message =
				error instanceof Error ? error.message : "成本每日快照聚合失败";
			await failJob(job.id, COST_SNAPSHOT_WORKER_ID, message.slice(0, 2000), {
				retryAfterMs: 60 * 60 * 1000, // 1h retry
			});
			logger.error("Cost snapshot failed", {
				reason,
				jobId: job.id,
				error: message,
			});
			return true;
		}
	} finally {
		state.running = false;
	}
}

export async function startCostSnapshotWorker() {
	const state = getWorkerState();
	if (state.started) return state;

	state.started = true;
	const intervalMs = COST_SNAPSHOT_INTERVAL_MS;

	void runCostSnapshotWorkerOnce("startup").catch((error) => {
		logger.error("Cost snapshot worker tick failed", {
			reason: "startup",
			error: error instanceof Error ? error.message : String(error),
		});
	});
	state.timer = setInterval(() => {
		void runCostSnapshotWorkerOnce("interval").catch((error) => {
			logger.error("Cost snapshot worker tick failed", {
				reason: "interval",
				error: error instanceof Error ? error.message : String(error),
			});
		});
	}, intervalMs);
	state.timer.unref?.();

	logger.info("Cost snapshot durable job worker started", {
		workerId: COST_SNAPSHOT_WORKER_ID,
		intervalMs,
	});
	return state;
}

export function stopCostSnapshotWorkerForTests() {
	const state = getWorkerState();
	if (state.timer) clearInterval(state.timer);
	state.started = false;
	state.running = false;
	state.timer = null;
}
