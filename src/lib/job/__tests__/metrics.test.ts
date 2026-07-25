import { describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    job: {
      count: vi.fn(),
      findFirst: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));

import { getJobBacklogMetrics } from "../metrics";

describe("getJobBacklogMetrics", () => {
  it("aggregates job counts and computes oldest pending age", async () => {
    const now = new Date();
    mockPrisma.job.count
      .mockResolvedValueOnce(5)  // pending
      .mockResolvedValueOnce(2)  // running
      .mockResolvedValueOnce(1)  // expiredLease
      .mockResolvedValueOnce(3)  // failed
      .mockResolvedValueOnce(100); // completed
    mockPrisma.job.findFirst.mockResolvedValue({ availableAt: new Date(now.getTime() - 30_000) });
    mockPrisma.job.groupBy.mockResolvedValue([
      { type: "backup.create", status: "PENDING", _count: 2 },
      { type: "backup.create", status: "RUNNING", _count: 1 },
      { type: "backup.create", status: "FAILED", _count: 0 },
    ]);

    const metrics = await getJobBacklogMetrics();
    expect(metrics.pending).toBe(5);
    expect(metrics.running).toBe(2);
    expect(metrics.expiredLease).toBe(1);
    expect(metrics.failed).toBe(3);
    expect(metrics.completed).toBe(100);
    expect(metrics.total).toBe(110);
    expect(metrics.oldestPendingMs).toBeGreaterThanOrEqual(29_000);
    expect(metrics.byType).toHaveLength(1);
    expect(metrics.byType[0]).toEqual({ type: "backup.create", pending: 2, running: 1, failed: 0 });
    // One groupBy for byType — no per-type count fan-out after the global counts.
    expect(mockPrisma.job.groupBy).toHaveBeenCalledTimes(1);
    expect(mockPrisma.job.count).toHaveBeenCalledTimes(5);
  });

  it("returns null oldestPendingMs when no pending jobs exist", async () => {
    mockPrisma.job.count.mockResolvedValue(0);
    mockPrisma.job.findFirst.mockResolvedValue(null);
    mockPrisma.job.groupBy.mockResolvedValue([]);
    const metrics = await getJobBacklogMetrics();
    expect(metrics.pending).toBe(0);
    expect(metrics.oldestPendingMs).toBeNull();
    expect(metrics.byType).toEqual([]);
  });

  it("applies teamWhere scope when session is provided", async () => {
    mockPrisma.job.count.mockReset();
    mockPrisma.job.findFirst.mockReset();
    mockPrisma.job.groupBy.mockReset();
    mockPrisma.job.count.mockResolvedValue(0);
    mockPrisma.job.findFirst.mockResolvedValue(null);
    mockPrisma.job.groupBy.mockResolvedValue([]);

    await getJobBacklogMetrics({
      userId: "u1",
      roles: ["viewer"],
      currentTeamId: "team_a",
    });

    const firstWhere = mockPrisma.job.count.mock.calls[0]?.[0]?.where;
    expect(firstWhere).toMatchObject({
      OR: [{ teamId: "team_a" }, { teamId: null }],
      status: "PENDING",
    });
  });
});
