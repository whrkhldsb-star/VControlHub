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
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { checkBudgetAlerts, syncServerMonthlyCosts } from "../service";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  infoMock,
  warnMock,
  errorMock,
  jobMocks,
  existingJobs,
  lastSnapshot,
  groupByMock,
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
    updateMany: vi.fn(),
    enqueueJob: vi.fn(),
    claimNextJob: vi.fn(),
    heartbeatJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
  },
  existingJobs: vi.fn(),
  lastSnapshot: vi.fn(),
  groupByMock: vi.fn(),
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
    $transaction: async (work: (tx: unknown) => Promise<void>) => work({
      costSnapshot: { findFirst: lastSnapshot }, job: { findFirst: jobMocks.findFirst }, $queryRaw: existingJobs,
    }),
    job: {
      findFirst: jobMocks.findFirst,
      updateMany: jobMocks.updateMany,
    },
    costSnapshot: { findFirst: lastSnapshot },
    costEntry: {
      groupBy: groupByMock,
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

vi.mock("@/lib/concurrency/advisory-lock", () => ({
  lockForTransaction: vi.fn(async () => undefined),
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
  syncServerMonthlyCosts: vi.fn(async () => ({
    month: "2026-01",
    synced: 0,
    skipped: 0,
    entries: [],
  })),
  checkBudgetAlerts: vi.fn(async () => ({
    checked: 0,
    triggered: 0,
    notificationsSent: 0,
    duplicatesSkipped: 0,
    budgets: [],
  })),
}));

const worker = await import("../snapshot-worker");

const TODAY_GROUPS = [
  {
    category: "vps",
    _sum: { amount: { toString: () => "30.00" } },
    _count: { _all: 2 },
  },
  {
    category: "bandwidth",
    _sum: { amount: { toString: () => "5.50" } },
    _count: { _all: 1 },
  },
  {
    category: "other",
    _sum: { amount: { toString: () => "3.00" } },
    _count: { _all: 1 },
  },
  {
    category: "rogue-category",
    _sum: { amount: { toString: () => "1.00" } },
    _count: { _all: 1 },
  },
];

describe("cost-snapshot-worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobIds.next = 1;
    existingJobs.mockResolvedValue([]);
    lastSnapshot.mockResolvedValue(null);
    jobMocks.findFirst.mockResolvedValue(null);
    jobMocks.enqueueJob.mockImplementation(async (req) => ({
      id: `j-${jobIds.next++}`,
      ...req,
    }));
    jobMocks.claimNextJob.mockResolvedValue({ id: "j-1", createdAt: new Date() });
    jobMocks.heartbeatJob.mockResolvedValue(undefined);
    jobMocks.completeJob.mockResolvedValue(undefined);
    jobMocks.failJob.mockResolvedValue(undefined);
    groupByMock.mockResolvedValue(TODAY_GROUPS);
    findManyMock.mockResolvedValue([]);
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
    jobMocks.claimNextJob.mockResolvedValue(null);
    const a = await worker.startCostSnapshotWorker();
    const b = await worker.startCostSnapshotWorker();
    expect(a).toBe(b);
    await vi.waitFor(() => expect(a.running).toBe(false));
    // Don't leave the interval timer running in the test process.
    worker.stopCostSnapshotWorkerForTests();
  });

  it("runCostSnapshotWorkerOnce enqueues, claims, snapshots, completes", async () => {
    const result = await worker.runCostSnapshotWorkerOnce("interval");
    expect(result).toBe(true);
    expect(jobMocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: "cost.snapshot" }), expect.any(Object),
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

  it("queues every missing business day and drains all due claims in the same poll", async () => {
    vi.setSystemTime(new Date("2026-07-06T17:00:00Z"));
    lastSnapshot.mockResolvedValue({ snapshotDate: new Date("2026-07-04") });
    existingJobs.mockResolvedValueOnce([{ id: "retry" }]);
    jobMocks.claimNextJob.mockResolvedValue(null)
      .mockResolvedValueOnce({ id: "retry", payload: { targetDay: "2026-07-05" } })
      .mockResolvedValueOnce({ id: "next", payload: { targetDay: "2026-07-06" } });
    await worker.runCostSnapshotWorkerOnce("interval", true);
    expect(jobMocks.enqueueJob.mock.calls.map(([job]) => job.payload.targetDay)).toEqual(["2026-07-06", "2026-07-07"]);
    expect(jobMocks.completeJob.mock.calls.map(([id]) => id)).toEqual(["retry", "next"]);
  });

  it("takes the daily lock on the same transaction that inserts the job", async () => {
    await worker.runCostSnapshotWorkerOnce();
    const tx = vi.mocked(lockForTransaction).mock.calls[0]![0];
    expect(tx).toBeDefined();
    expect(jobMocks.enqueueJob.mock.calls[0]![1]).toBe(tx);
  });

  it("recovers from the last completed job even when a newer manual snapshot exists", async () => {
    vi.setSystemTime(new Date("2026-07-06T17:00:00Z"));
    jobMocks.findFirst.mockResolvedValueOnce({ payload: { targetDay: "2026-07-04" }, createdAt: new Date("2026-07-04") });
    lastSnapshot.mockResolvedValue({ snapshotDate: new Date("2026-07-07") });
    jobMocks.claimNextJob.mockResolvedValue(null);
    await worker.runCostSnapshotWorkerOnce("interval", true);
    expect(jobMocks.enqueueJob.mock.calls.map(([job]) => job.payload.targetDay)).toEqual(["2026-07-05", "2026-07-06", "2026-07-07"]);
  });

  it.each([
    { requestedAt: "2026-10-31T14:30:00Z" },
    { targetDay: "2026-10-31", requestedAt: "2026-10-31T16:30:00Z" },
  ])("keeps the requested business day and month on a November retry (%j)", async payload => {
    vi.setSystemTime(new Date("2026-10-31T17:00:00Z"));
    jobMocks.claimNextJob.mockResolvedValueOnce({ id: "old", payload });
    await worker.runCostSnapshotWorkerOnce();
    expect(jobMocks.enqueueJob.mock.calls[0]?.[0].payload.targetDay).toBe("2026-11-01");
    expect(syncServerMonthlyCosts).toHaveBeenCalledWith("2026-10");
    expect(upsertDailySnapshotMock.mock.calls[0]?.[0].snapshotDate).toEqual(new Date("2026-10-31"));
    expect(checkBudgetAlerts).toHaveBeenCalledWith(new Date("2026-10-31T04:00:00Z"));
  });

  it("skips enqueue when a PENDING/RUNNING job already exists", async () => {
    existingJobs.mockResolvedValueOnce([{ id: "j-existing" }]);
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
    expect(checkBudgetAlerts).toHaveBeenCalled();
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

  it.each(["snapshot", "budget"])("retries only the unfinished %s step after a checkpoint", async failed => {
    const job = { id: "checkpoint", attempts: 1, payload: { targetDay: "2026-07-30" } };
    jobMocks.claimNextJob.mockResolvedValueOnce(job);
    if (failed === "snapshot") upsertDailySnapshotMock.mockRejectedValueOnce(new Error("snapshot down"));
    else vi.mocked(checkBudgetAlerts).mockRejectedValueOnce(new Error("budget down"));
    await worker.runCostSnapshotWorkerOnce();
    const checkpoint = jobMocks.updateMany.mock.calls[0]?.[0];
    expect(checkpoint.where).toMatchObject({ attempts: 1, id: job.id, status: "RUNNING" });
    jobMocks.claimNextJob.mockResolvedValueOnce({ ...job, attempts: 2, result: checkpoint.data.result });
    await worker.runCostSnapshotWorkerOnce();
    expect(jobMocks.completeJob).toHaveBeenCalledTimes(1);
    expect(upsertDailySnapshotMock).toHaveBeenCalledTimes(failed === "snapshot" ? 2 : 1);
    expect(checkBudgetAlerts).toHaveBeenCalledTimes(failed === "budget" ? 2 : 1);
    expect(syncServerMonthlyCosts).toHaveBeenCalledTimes(1);
  });

  it("state.running blocks a concurrent tick (re-entrancy guard)", async () => {
    // Slow down the upsert so the second tick starts while the first is mid-flight.
    upsertDailySnapshotMock.mockImplementation(async (input) => {
      await new Promise((r) => setTimeout(r, 25));
      return { id: "snap-1", ...input };
    });
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
