/**
 * Tests for cost-snapshot-worker — TR-031 E01 每日 01:00 聚合 worker
 *
 * 覆盖：
 *   - 启动幂等 (idempotent)
 *   - 一次 tick: enqueue → claim → heartbeat → upsert → complete 完整路径
 *   - 已有 PENDING/RUNNING job → skip enqueue
 *   - buildTodaySnapshot 抛错 → failJob + logger.error
 *   - 重入保护 (state.running)
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	infoMock,
	warnMock,
	errorMock,
	jobMocks,
	findManyMock,
	upsertDailySnapshotMock,
	jobIds,
} = vi.hoisted(() => ({
	infoMock: vi.fn(),
	warnMock: vi.fn(),
	errorMock: vi.fn(),
	jobIds: { next: 1 },
	jobMocks: {
		findFirst: vi.fn(),
		enqueueJob: vi.fn(),
		claimNextJob: vi.fn(),
		heartbeatJob: vi.fn(),
		completeJob: vi.fn(),
		failJob: vi.fn(),
	},
	findManyMock: vi.fn(),
	upsertDailySnapshotMock: vi.fn(),
}));

vi.mock("@/lib/logging", () => ({
	createLogger: () => ({
		info: infoMock,
		warn: warnMock,
		error: errorMock,
	}),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		job: {
			findFirst: jobMocks.findFirst,
		},
		costEntry: {
			findMany: findManyMock,
		},
		server: {
			findMany: findManyMock,
		},
	},
}));

vi.mock("@/lib/job/service", () => ({
	enqueueJob: jobMocks.enqueueJob,
	claimNextJob: jobMocks.claimNextJob,
	heartbeatJob: jobMocks.heartbeatJob,
	completeJob: jobMocks.completeJob,
	failJob: jobMocks.failJob,
}));

vi.mock("@/lib/job/lease", () => ({
	computeLeaseMs: () => 5 * 60 * 1000,
}));

vi.mock("@/lib/config/env", () => ({
	config: { app: { hostname: "test-host" } },
}));

// Mock the cost service's upsertDailySnapshot (avoid pulling decimal types
// into the test).
vi.mock("@/lib/cost/service", () => ({
	upsertDailySnapshot: upsertDailySnapshotMock,
	syncServerMonthlyCosts: vi.fn(async () => ({ month: "2026-01", synced: 0, skipped: 0, entries: [] })),
	checkBudgetAlerts: vi.fn(async () => ({ checked: 0, triggered: 0, notificationsSent: 0, duplicatesSkipped: 0, budgets: [] })),
}));

const worker = await import("../snapshot-worker");

const TODAY_ROWS = [
	{ category: "vps", amount: { toString: () => "10.00" } },
	{ category: "bandwidth", amount: { toString: () => "5.50" } },
	{ category: "vps", amount: { toString: () => "20.00" } },
	{ category: "other", amount: { toString: () => "3.00" } },
	{ category: "rogue-category", amount: { toString: () => "1.00" } },
];

describe("cost-snapshot-worker", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		jobIds.next = 1;
		jobMocks.findFirst.mockResolvedValue(null);
		jobMocks.enqueueJob.mockImplementation(async (req) => ({ id: `j-${jobIds.next++}`, ...req }));
		jobMocks.claimNextJob.mockResolvedValue({ id: "j-1" });
		jobMocks.heartbeatJob.mockResolvedValue(undefined);
		jobMocks.completeJob.mockResolvedValue(undefined);
		jobMocks.failJob.mockResolvedValue(undefined);
		findManyMock.mockResolvedValue(TODAY_ROWS);
		upsertDailySnapshotMock.mockImplementation(async (input) => ({
			id: "snap-1",
			snapshotDate: input.snapshotDate.toISOString().slice(0, 10),
			totalAmount: input.totalAmount,
			byCategory: input.byCategory,
			entryCount: input.entryCount,
			createdAt: new Date().toISOString(),
		}));
	});

	it("startCostSnapshotWorker is idempotent", async () => {
		const a = await worker.startCostSnapshotWorker();
		const b = await worker.startCostSnapshotWorker();
		expect(a).toBe(b);
		// Don't leave the interval timer running in the test process.
		worker.stopCostSnapshotWorkerForTests();
	});

	it("runCostSnapshotWorkerOnce enqueues, claims, snapshots, completes", async () => {
		const result = await worker.runCostSnapshotWorkerOnce("interval");
		expect(result).toBe(true);
		expect(jobMocks.enqueueJob).toHaveBeenCalledWith(
			expect.objectContaining({ type: "cost.snapshot" }),
		);
		expect(jobMocks.claimNextJob).toHaveBeenCalledWith(
			expect.objectContaining({ types: ["cost.snapshot"] }),
		);
		expect(upsertDailySnapshotMock).toHaveBeenCalledTimes(1);
		const arg = upsertDailySnapshotMock.mock.calls[0]![0];
		// 5 rows, 1 rogue category bucketed to "other"
		expect(arg.entryCount).toBe(5);
		expect(arg.totalAmount).toBe("39.50"); // 10 + 5.5 + 20 + 3 + 1
		expect(arg.byCategory.vps).toBe("30.00");
		expect(arg.byCategory.bandwidth).toBe("5.50");
		expect(arg.byCategory.storage).toBe("0.00");
		expect(arg.byCategory.other).toBe("4.00");
		expect(jobMocks.completeJob).toHaveBeenCalledWith(
			"j-1",
			expect.stringContaining("cost-snapshot"),
			expect.objectContaining({ snapshotId: "snap-1", entryCount: 5 }),
		);
		expect(errorMock).not.toHaveBeenCalled();
	});

	it("skips enqueue when a PENDING/RUNNING job already exists", async () => {
		jobMocks.findFirst.mockResolvedValueOnce({ id: "j-existing" });
		// claimNextJob still finds it
		jobMocks.claimNextJob.mockResolvedValueOnce({ id: "j-existing" });
		const result = await worker.runCostSnapshotWorkerOnce("interval");
		expect(result).toBe(true);
		expect(jobMocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("returns false and does nothing when there is no claimable job", async () => {
		jobMocks.claimNextJob.mockResolvedValueOnce(null);
		const result = await worker.runCostSnapshotWorkerOnce("interval");
		expect(result).toBe(false);
		expect(upsertDailySnapshotMock).not.toHaveBeenCalled();
		expect(jobMocks.completeJob).not.toHaveBeenCalled();
	});

	it("failJob is called when upsertDailySnapshot throws", async () => {
		upsertDailySnapshotMock.mockRejectedValueOnce(new Error("DB down"));
		const result = await worker.runCostSnapshotWorkerOnce("interval");
		expect(result).toBe(true);
		expect(jobMocks.failJob).toHaveBeenCalledWith(
			"j-1",
			expect.stringContaining("cost-snapshot"),
			expect.stringContaining("DB down"),
			expect.objectContaining({ retryAfterMs: 60 * 60 * 1000 }),
		);
		expect(errorMock).toHaveBeenCalledWith(
			"Cost snapshot failed",
			expect.objectContaining({ error: expect.stringContaining("DB down") }),
		);
	});

	it("state.running blocks a concurrent tick (re-entrancy guard)", async () => {
		// Slow down the upsert so the second tick starts while the first is mid-flight.
		upsertDailySnapshotMock.mockImplementation(
			async (input) => {
				await new Promise((r) => setTimeout(r, 25));
				return { id: "snap-1", ...input };
			},
		);
		const first = worker.runCostSnapshotWorkerOnce("first");
		const second = await worker.runCostSnapshotWorkerOnce("second");
		expect(second).toBe(false); // blocked by state.running
		expect(warnMock).toHaveBeenCalledWith(
			expect.stringContaining("Skipping cost snapshot tick"),
			expect.objectContaining({ reason: "second" }),
		);
		await first;
	});
});
