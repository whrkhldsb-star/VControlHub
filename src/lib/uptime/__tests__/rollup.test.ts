import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
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

  it("turns covered sample time into daily uptime rows", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([
      // 2 online samples covering 10 minutes, 1 offline sample covering 5.
      { serverId: "s1", online: BigInt(2), offline: BigInt(1), online_s: 600, offline_s: 300 },
      { serverId: "s2", online: BigInt(0), offline: BigInt(1), online_s: null, offline_s: 300 },
    ]);

    const result = await rollupServerUptimeForDay(new Date("2026-07-19T12:00:00Z"));
    expect(result.upserted).toBe(2);
    expect(prismaMock.serverUptimeSnapshot.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.serverUptimeSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { serverId_date: { serverId: "s1", date: new Date("2026-07-18T16:00:00.000Z") } },
        create: expect.objectContaining({ serverId: "s1", uptimePercent: 66.67, onlineMinutes: 10, offlineMinutes: 5, checkCount: 3 }),
      }),
    );
  });

  it("weights by time, not by sample count, when the interval changed during the day", async () => {
    // 12 one-minute online samples (12 min) and one 30-minute offline sample.
    prismaMock.$queryRaw.mockResolvedValueOnce([{ serverId: "s1", online: 12, offline: 1, online_s: 720, offline_s: 1800 }]);
    await rollupServerUptimeForDay(new Date("2026-07-19T12:00:00Z"));
    expect(prismaMock.serverUptimeSnapshot.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ create: expect.objectContaining({ uptimePercent: 28.57, onlineMinutes: 12, offlineMinutes: 30, checkCount: 13 }) }),
    );
  });

  it("skips servers with no samples that day", async () => {
    prismaMock.$queryRaw.mockResolvedValueOnce([]);
    const result = await rollupServerUptimeForDay(new Date("2026-07-19T12:00:00Z"));
    expect(result.upserted).toBe(0);
    expect(prismaMock.serverUptimeSnapshot.upsert).not.toHaveBeenCalled();
  });
});
