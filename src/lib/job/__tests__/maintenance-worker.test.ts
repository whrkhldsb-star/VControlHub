import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findMany: vi.fn(),
  updateMany: vi.fn(),
  recoverStaleRunningJobs: vi.fn(async (): Promise<{ count: number; recovered: string[]; failed: string[] }> => ({ count: 0, recovered: [], failed: [] })),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    job: {
      findMany: mocks.findMany,
      updateMany: mocks.updateMany,
    },
  },
}));

vi.mock("@/lib/config/env", () => ({
  config: { app: { hostname: "test-host" } },
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

vi.mock("@/lib/job/service", () => ({
  recoverStaleRunningJobs: mocks.recoverStaleRunningJobs,
}));

const {
  abandonOrphanPendingJobs,
  _knownJobTypesForTests,
  startJobMaintenanceWorker,
  stopJobMaintenanceWorkerForTests,
} = await import("../maintenance-worker");

describe("abandonOrphanPendingJobs", () => {
  beforeEach(() => {
    mocks.findMany.mockReset();
    mocks.updateMany.mockReset();
    mocks.recoverStaleRunningJobs.mockReset();
    mocks.updateMany.mockResolvedValue({ count: 1 });
    mocks.recoverStaleRunningJobs.mockResolvedValue({ count: 0, recovered: [], failed: [] });
  });

  it("cancels unknown job types after soft timeout", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: "j1", type: "playbook.command", createdAt: new Date(Date.now() - 2 * 24 * 3600_000), title: "orphan" },
      { id: "j2", type: "playbook.run", createdAt: new Date(Date.now() - 2 * 24 * 3600_000), title: "known" },
    ]);

    const result = await abandonOrphanPendingJobs({ olderThanMs: 24 * 3600_000, hardOrphanMs: 7 * 24 * 3600_000 });
    expect(result.cancelled).toBe(1);
    expect(result.ids).toEqual(["j1"]);
    expect(mocks.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "j1", status: "PENDING" },
        data: expect.objectContaining({
          status: "CANCELLED",
          errorMessage: expect.stringContaining("no consumer"),
        }),
      }),
    );
  });

  it("cancels known types only after hard orphan window", async () => {
    mocks.findMany.mockResolvedValueOnce([
      { id: "j3", type: "playbook.run", createdAt: new Date(Date.now() - 8 * 24 * 3600_000), title: "ancient" },
    ]);
    const result = await abandonOrphanPendingJobs({ olderThanMs: 24 * 3600_000, hardOrphanMs: 7 * 24 * 3600_000 });
    expect(result.cancelled).toBe(1);
    expect(result.ids).toEqual(["j3"]);
  });

  it("exposes known job types helper", () => {
    expect(_knownJobTypesForTests().has("playbook.run")).toBe(true);
  });

  it("startup tick also recovers stale RUNNING leases", async () => {
    mocks.findMany.mockResolvedValueOnce([]);
    mocks.recoverStaleRunningJobs.mockResolvedValueOnce({
      count: 1,
      recovered: ["stale-a"],
      failed: [],
    });
    await startJobMaintenanceWorker({ intervalMs: 60_000 });
    // Allow the fire-and-forget startup tick to settle.
    await new Promise((r) => setTimeout(r, 20));
    expect(mocks.recoverStaleRunningJobs).toHaveBeenCalledWith(
      expect.objectContaining({ staleBefore: expect.any(Date) }),
    );
    stopJobMaintenanceWorkerForTests();
  });
});
