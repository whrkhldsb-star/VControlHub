import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    job: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
      fields: { maxAttempts: "maxAttempts" },
    },
    $transaction: vi.fn(async (callback: any) => callback(mockPrisma)),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { cancelJob, claimNextJob, completeJob, enqueueJob, failJob, heartbeatJob, recoverStaleRunningJobs } = await import("../service");

describe("durable job service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
    await recoverStaleRunningJobs({ staleBefore: new Date("2026-06-08T08:55:00Z"), now });
    expect(mockPrisma.job.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: "RUNNING" }),
      data: expect.objectContaining({ status: "PENDING", errorMessage: "后台执行器心跳过期，已重新入队" }),
    }));
  });
});
