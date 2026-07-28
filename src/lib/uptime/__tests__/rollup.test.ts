import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  metricSnapshot: { groupBy: vi.fn() },
  serverUptimeSnapshot: { upsert: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { rollupServerUptimeForDay } from "../rollup";

describe("rollupServerUptimeForDay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.serverUptimeSnapshot.upsert.mockResolvedValue({});
  });

  it("aggregates MetricSnapshot samples into daily uptime rows", async () => {
    prismaMock.metricSnapshot.groupBy.mockResolvedValueOnce([
      { serverId: "s1", isOnline: true, _count: { _all: 2 } },
      { serverId: "s1", isOnline: false, _count: { _all: 1 } },
      { serverId: "s2", isOnline: false, _count: { _all: 1 } },
    ]);

    const result = await rollupServerUptimeForDay(
      new Date("2026-07-19T12:00:00Z"),
    );
    expect(result.upserted).toBe(2);
    expect(prismaMock.serverUptimeSnapshot.upsert).toHaveBeenCalledTimes(2);

    expect(prismaMock.serverUptimeSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          serverId_date: {
            serverId: "s1",
            date: new Date("2026-07-19T00:00:00.000Z"),
          },
        },
        create: expect.objectContaining({
          serverId: "s1",
          uptimePercent: 66.67,
          onlineMinutes: 10,
          offlineMinutes: 5,
          checkCount: 3,
        }),
      }),
    );
  });

  it("skips servers with no samples that day", async () => {
    prismaMock.metricSnapshot.groupBy.mockResolvedValueOnce([]);
    const result = await rollupServerUptimeForDay(
      new Date("2026-07-19T12:00:00Z"),
    );
    expect(result.upserted).toBe(0);
    expect(prismaMock.serverUptimeSnapshot.upsert).not.toHaveBeenCalled();
  });
});
