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
    mockPrisma.job.groupBy.mockResolvedValue([{ type: "backup.create", _count: 3 }]);
    mockPrisma.job.count
      .mockResolvedValueOnce(2) // backup.create pending
      .mockResolvedValueOnce(1) // backup.create running
      .mockResolvedValueOnce(0); // backup.create failed

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
});
