import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  jobFindFirst: vi.fn(),
  enqueueJob: vi.fn(),
  claimNextJob: vi.fn(),
  heartbeatJob: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  collectAllHealth: vi.fn(),
  snapshotHealthOverview: vi.fn(),
  pruneMetricSnapshots: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: { job: { findFirst: mocks.jobFindFirst } } }));
vi.mock("@/lib/job/service", () => ({
  enqueueJob: mocks.enqueueJob,
  claimNextJob: mocks.claimNextJob,
  heartbeatJob: mocks.heartbeatJob,
  completeJob: mocks.completeJob,
  failJob: mocks.failJob,
}));
vi.mock("../service-collect", () => ({ collectAllHealth: mocks.collectAllHealth }));
vi.mock("../service-metrics", () => ({
  snapshotHealthOverview: mocks.snapshotHealthOverview,
  pruneMetricSnapshots: mocks.pruneMetricSnapshots,
}));

import { enqueueHealthSampleIfIdle, runHealthSamplingWorkerOnce, stopHealthSamplingWorkerForTests } from "../sampling-worker";

describe("fleet health background sampling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopHealthSamplingWorkerForTests();
    mocks.jobFindFirst.mockResolvedValue(null);
    mocks.enqueueJob.mockResolvedValue({ id: "queued" });
    mocks.claimNextJob.mockResolvedValue({ id: "job1", payload: {}, attempts: 1, maxAttempts: 3 });
    mocks.collectAllHealth.mockResolvedValue({
      total: 2, online: 1, warning: 0, critical: 0, offline: 1,
      servers: [
        { serverId: "s1", enabled: true, status: "healthy", cpu: 10, mem: 20, diskMax: 30 },
        { serverId: "s2", enabled: true, status: "offline" },
      ],
    });
    mocks.snapshotHealthOverview.mockResolvedValue({ count: 2 });
    mocks.pruneMetricSnapshots.mockResolvedValue({ count: 4 });
  });

  it("does not enqueue a duplicate pending/running sample", async () => {
    mocks.jobFindFirst.mockResolvedValue({ id: "active" });
    expect(await enqueueHealthSampleIfIdle("interval")).toBe(false);
    expect(mocks.enqueueJob).not.toHaveBeenCalled();
  });

  it("collects, batches snapshots, prunes retention and completes the durable job", async () => {
    expect(await runHealthSamplingWorkerOnce("test")).toBe(true);
    expect(mocks.snapshotHealthOverview).toHaveBeenCalledWith(expect.objectContaining({ total: 2 }));
    expect(mocks.pruneMetricSnapshots).toHaveBeenCalledWith(expect.any(Date));
    expect(mocks.completeJob).toHaveBeenCalledWith("job1", expect.any(String), expect.objectContaining({ sampled: 2, offline: 1, pruned: 4 }));
  });

  it("fails the durable job instead of reporting false success", async () => {
    mocks.collectAllHealth.mockRejectedValue(new Error("collector unavailable"));
    expect(await runHealthSamplingWorkerOnce()).toBe(true);
    expect(mocks.failJob).toHaveBeenCalledWith("job1", expect.any(String), "collector unavailable", expect.any(Object));
    expect(mocks.completeJob).not.toHaveBeenCalled();
  });
});
