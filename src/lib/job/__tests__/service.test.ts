import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, configState } = vi.hoisted(() => ({
  mockPrisma: {
    job: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      count: vi.fn(),
      fields: { maxAttempts: "maxAttempts" },
    },
    jobEvent: {
      create: vi.fn(async () => ({ id: "event-1" })),
      createMany: vi.fn(async () => ({ count: 1 })),
      findMany: vi.fn(async () => []),
      deleteMany: vi.fn(async () => ({ count: 0 })),
    },
    $transaction: vi.fn(async (callback: any) => callback(mockPrisma)),
  },
  // TR-001 T13b: each test opts into specific cap values via `configState`;
  // the default is "all caps off" so the existing 7 tests keep their
  // original behaviour.
  configState: {
    jobMaxConcurrentGlobal: 0,
    jobMaxConcurrentPerUser: 0,
    jobMaxConcurrentPerNode: 0,
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/config/env", () => ({
  config: {
    get job() {
      return {
        get maxConcurrentGlobal() { return configState.jobMaxConcurrentGlobal; },
        get maxConcurrentPerUser() { return configState.jobMaxConcurrentPerUser; },
        get maxConcurrentPerNode() { return configState.jobMaxConcurrentPerNode; },
      };
    },
  },
}));

const { cancelJob, claimNextJob, completeJob, enqueueJob, failJob, heartbeatJob, pruneCompletedJobsByType, recoverStaleRunningJobs } = await import("../service");

describe("durable job service", () => {
  beforeEach(() => {
    // vi.resetAllMocks() — NOT vi.clearAllMocks() — because the cap tests
    // below queue multiple `mockResolvedValueOnce(...)` per test, and
    // `clearAllMocks` only wipes call history; a leftover Once in the
    // queue would silently leak from one test into the next (e.g. test
    // 7's "claims when under every cap" gets fed the leftover Once from
    // test 6's per-node stub and bails for the wrong reason). `resetAll`
    // wipes the queue AND the implementation, so we re-set the safe
    // defaults below for every test.
    vi.resetAllMocks();
    // Re-set default implementations (resetAllMocks wiped them).
    mockPrisma.job.findFirst.mockResolvedValue(null);
    mockPrisma.job.findUniqueOrThrow.mockResolvedValue(null);
    mockPrisma.job.updateMany.mockResolvedValue({ count: 0 });
    mockPrisma.job.create.mockResolvedValue({ id: "job-default" });
    mockPrisma.job.count.mockResolvedValue(0);
    configState.jobMaxConcurrentGlobal = 0;
    configState.jobMaxConcurrentPerUser = 0;
    configState.jobMaxConcurrentPerNode = 0;
  });

  it("enqueues a pending durable job with normalized defaults", async () => {
    mockPrisma.job.create.mockResolvedValue({ id: "job1" });

    await enqueueJob({ type: " backup.full ", title: " Full backup ", createdBy: "u1", maxAttempts: 0 });

    expect(mockPrisma.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        type: "backup.full",
        title: "Full backup",
        payload: {},
        createdBy: "u1",
        priority: 0,
        maxAttempts: 1,
      }),
    });
  });

  it("claims the oldest available pending or expired job with a worker lease", async () => {
    const now = new Date("2026-06-08T09:00:00Z");
    mockPrisma.job.findFirst.mockResolvedValue({ id: "job1", startedAt: null });
    mockPrisma.job.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.job.findUniqueOrThrow.mockResolvedValue({ id: "job1", workerId: "worker-a" });

    const claimed = await claimNextJob({ workerId: "worker-a", types: ["backup.full"], leaseMs: 60_000, now });

    expect(mockPrisma.job.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ type: { in: ["backup.full"] } }),
      orderBy: [{ priority: "desc" }, { availableAt: "asc" }, { createdAt: "asc" }],
    }));
    expect(mockPrisma.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "job1" }),
      data: expect.objectContaining({ workerId: "worker-a", workerHeartbeatAt: now, leaseExpiresAt: new Date("2026-06-08T09:01:00Z") }),
    }));
    expect(claimed).toEqual({ id: "job1", workerId: "worker-a" });
  });

  it("extends heartbeat leases and records progress", async () => {
    const now = new Date("2026-06-08T09:00:00Z");
    await heartbeatJob("job1", "worker-a", { progress: "50%", leaseMs: 120_000, now });

    expect(mockPrisma.job.updateMany).toHaveBeenCalledWith({
      where: { id: "job1", status: "RUNNING", workerId: "worker-a" },
      data: { workerHeartbeatAt: now, leaseExpiresAt: new Date("2026-06-08T09:02:00Z"), progress: "50%" },
    });
  });

  it("completes only the worker-owned running job", async () => {
    await completeJob("job1", "worker-a", { artifact: "backup.tar.gz" });

    expect(mockPrisma.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job1", status: "RUNNING", workerId: "worker-a" },
      data: expect.objectContaining({ status: "COMPLETED", result: { artifact: "backup.tar.gz" }, leaseExpiresAt: null, progress: "100%" }),
    }));
  });

  it("requeues retryable failures and finalizes exhausted failures", async () => {
    const now = new Date("2026-06-08T09:00:00Z");
    mockPrisma.job.findUnique.mockResolvedValueOnce({ attempts: 1, maxAttempts: 3 });
    await failJob("job1", "worker-a", "temporary", { retryAfterMs: 10_000, now });
    expect(mockPrisma.job.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "PENDING", availableAt: new Date("2026-06-08T09:00:10Z"), workerId: null }),
    }));

    mockPrisma.job.findUnique.mockResolvedValueOnce({ attempts: 3, maxAttempts: 3 });
    await failJob("job1", "worker-a", "fatal", { now });
    expect(mockPrisma.job.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED", completedAt: now, leaseExpiresAt: null }),
    }));
  });

  it("cancels pending/running jobs and recovers stale running jobs", async () => {
    await cancelJob("job1");
    expect(mockPrisma.job.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "job1", status: { in: ["PENDING", "RUNNING"] } },
      data: expect.objectContaining({ status: "CANCELLED", workerId: null }),
    }));

    const now = new Date("2026-06-08T09:00:00Z");
    mockPrisma.job.findMany.mockResolvedValueOnce([
      { id: "stale-1", type: "download.execute", title: "stale 1", attempts: 1, maxAttempts: 3 },
      { id: "stale-2", type: "command.execute", title: "stale 2", attempts: 2, maxAttempts: 3 },
    ]);
    const recovered = await recoverStaleRunningJobs({ staleBefore: new Date("2026-06-08T08:55:00Z"), now });
    expect(mockPrisma.job.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "RUNNING" }),
    }));
    expect(mockPrisma.job.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "RUNNING" }),
      data: expect.objectContaining({ status: "PENDING", errorMessage: "后台执行器心跳过期，已重新入队" }),
    }));
    // TR-001 T13a: return shape now includes the recovered id list so callers
    // can emit per-job events or surface what was rescued this tick. The
    // count is asserted via the updateMany mock return (default { count: 0 }
    // is fine — we're verifying the id surface, not the updateMany mock).
    expect(recovered.recovered).toEqual(["stale-1", "stale-2"]);
  });

  it("prunes only old completed jobs outside the retained latest set", async () => {
    const olderThan = new Date("2026-06-01T00:00:00Z");
    mockPrisma.job.findMany.mockResolvedValue([{ id: "keep-new" }, { id: "keep-recent" }]);
    mockPrisma.job.deleteMany.mockResolvedValue({ count: 8 });

    const result = await pruneCompletedJobsByType({ type: " alert.evaluate ", keepLatest: 2, olderThan });

    expect(mockPrisma.job.findMany).toHaveBeenCalledWith({
      where: { type: "alert.evaluate", status: "COMPLETED" },
      select: { id: true },
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
      take: 2,
    });
    expect(mockPrisma.job.deleteMany).toHaveBeenCalledWith({
      where: {
        type: "alert.evaluate",
        status: "COMPLETED",
        id: { notIn: ["keep-new", "keep-recent"] },
        completedAt: { lt: olderThan },
      },
    });
    expect(result).toEqual({ count: 8 });
  });

  // TR-001 T13b: concurrency caps. The three caps are independent and
  // configured via JOB_MAX_CONCURRENT_GLOBAL / _PER_USER / _PER_NODE; a
  // value of 0 (the default) disables the cap, so these tests explicitly
  // opt into a positive cap and verify the soft guard returns null when
  // the in-flight count has already reached the limit.
  describe("claimNextJob concurrency caps (T13b)", () => {
    it("returns null when the global cap is already at the limit", async () => {
      configState.jobMaxConcurrentGlobal = 2;
      // First count() call is the global cap check; the in-flight total is
      // already at 2 so the claim must bail before findFirst even runs.
      mockPrisma.job.count.mockResolvedValueOnce(2);

      const claimed = await claimNextJob({ workerId: "w-a", types: ["download.execute"] });

      expect(claimed).toBeNull();
      // We must NOT have run findFirst/updateMany, otherwise we'd be
      // claiming past the cap.
      expect(mockPrisma.job.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
    });

    it("returns null when the per-user cap is already at the limit", async () => {
      configState.jobMaxConcurrentPerUser = 3;
      // Global cap is left at 0 (disabled) → production code skips the
      // global count call, so we MUST NOT queue a Once for it. (Earlier
      // version of this test queued Once(0) "for global"; that Once
      // then leaked into the per-user check, returning 0 instead of 3
      // and the test claimed the job when it should have bailed.)
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: "job1",
        startedAt: null,
        createdBy: "u-1",
        targetStorageNodeId: null,
      });
      // Per-user check sees 3 already running for u-1.
      mockPrisma.job.count.mockResolvedValueOnce(3);

      const claimed = await claimNextJob({ workerId: "w-a" });

      expect(claimed).toBeNull();
      // We must have run the global count + findFirst (we picked a candidate
      // and decided to bail) but NOT the actual updateMany claim.
      expect(mockPrisma.job.findFirst).toHaveBeenCalledTimes(1);
      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
    });

    it("returns null when the per-node cap is already at the limit", async () => {
      configState.jobMaxConcurrentPerNode = 1;
      // Global + per-user caps are both disabled (0) → only the per-node
      // count call happens. Do NOT queue a Once for the skipped checks;
      // a leftover Once would get consumed by the per-node call and
      // return the wrong value.
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: "job1",
        startedAt: null,
        createdBy: "u-1",
        targetStorageNodeId: "node-A",
      });
      // The next count call is the per-node check; sees 1 already running
      // for node-A.
      mockPrisma.job.count.mockResolvedValueOnce(1);

      const claimed = await claimNextJob({ workerId: "w-a" });

      expect(claimed).toBeNull();
      expect(mockPrisma.job.updateMany).not.toHaveBeenCalled();
    });

    it("claims the job when under every configured cap", async () => {
      configState.jobMaxConcurrentGlobal = 5;
      configState.jobMaxConcurrentPerUser = 2;
      configState.jobMaxConcurrentPerNode = 1;
      mockPrisma.job.count
        .mockResolvedValueOnce(3) // global check: 3 in-flight, cap=5, OK
        .mockResolvedValueOnce(0) // per-user check: 0 in-flight for u-1, cap=2, OK
        .mockResolvedValueOnce(0); // per-node check: 0 in-flight for node-A, cap=1, OK
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: "job1",
        startedAt: null,
        createdBy: "u-1",
        targetStorageNodeId: "node-A",
      });
      mockPrisma.job.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.job.findUniqueOrThrow.mockResolvedValueOnce({ id: "job1", workerId: "w-a" });

      const claimed = await claimNextJob({ workerId: "w-a" });

      expect(claimed).toEqual({ id: "job1", workerId: "w-a" });
      // All three cap counts must have run before the claim.
      expect(mockPrisma.job.count).toHaveBeenCalledTimes(3);
      expect(mockPrisma.job.updateMany).toHaveBeenCalledTimes(1);
    });

    it("skips the per-user check for system jobs without a createdBy", async () => {
      configState.jobMaxConcurrentPerUser = 1;
      // Global cap is left at 0 (disabled). The candidate is a system
      // job (createdBy=null, no targetStorageNodeId) so the per-user
      // check is skipped by the production guard
      // `if (maxPerUser > 0 && candidate.createdBy)` and the per-node
      // check is skipped because targetStorageNodeId is null. Net
      // effect: no `count()` call at all on this code path.
      mockPrisma.job.findFirst.mockResolvedValueOnce({
        id: "job-sys",
        startedAt: null,
        createdBy: null, // system job (alert.evaluate / scheduled-task.tick)
        targetStorageNodeId: null,
      });
      // No count call happens — claim goes straight to updateMany.
      mockPrisma.job.updateMany.mockResolvedValueOnce({ count: 1 });
      mockPrisma.job.findUniqueOrThrow.mockResolvedValueOnce({ id: "job-sys", workerId: "w-a" });

      const claimed = await claimNextJob({ workerId: "w-a" });

      expect(claimed).toEqual({ id: "job-sys", workerId: "w-a" });
      // Zero count calls: global cap disabled, per-user skipped (no
      // createdBy), per-node skipped (no targetStorageNodeId). The
      // claim should go straight to updateMany.
      expect(mockPrisma.job.count).toHaveBeenCalledTimes(0);
      expect(mockPrisma.job.updateMany).toHaveBeenCalledTimes(1);
    });
  });

  it("persists targetStorageNodeId when enqueueJob is called with one", async () => {
    mockPrisma.job.create.mockResolvedValue({ id: "job-node" });

    await enqueueJob({
      type: "download.execute",
      title: "下载",
      createdBy: "u-1",
      targetStorageNodeId: "node-A",
    });

    expect(mockPrisma.job.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        targetStorageNodeId: "node-A",
        createdBy: "u-1",
      }),
    });
  });
});
