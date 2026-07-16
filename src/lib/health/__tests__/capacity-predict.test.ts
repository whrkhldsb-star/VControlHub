import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  buildServerForecast,
  forecastMetric,
  linearRegression,
  summarizeFleet,
  worstRisk,
  type MetricSample,
} from "../capacity-predict";

function makeSeries(
  values: number[],
  options: { startMs?: number; stepMs?: number } = {},
): MetricSample[] {
  const startMs = options.startMs ?? Date.now() - values.length * 3_600_000;
  const stepMs = options.stepMs ?? 3_600_000;
  return values.map((value, i) => ({ t: startMs + i * stepMs, value }));
}

describe("linearRegression", () => {
  it("fits a perfect line", () => {
    const points = [
      { x: 0, y: 10 },
      { x: 1, y: 20 },
      { x: 2, y: 30 },
      { x: 3, y: 40 },
    ];
    const fit = linearRegression(points);
    expect(fit).not.toBeNull();
    expect(fit!.slope).toBeCloseTo(10, 5);
    expect(fit!.intercept).toBeCloseTo(10, 5);
    expect(fit!.r2).toBeCloseTo(1, 5);
  });

  it("returns null for a single point", () => {
    expect(linearRegression([{ x: 0, y: 1 }])).toBeNull();
  });
});

describe("forecastMetric", () => {
  const nowMs = Date.parse("2026-07-16T00:00:00.000Z");

  it("marks insufficient data when samples are sparse", () => {
    const samples = makeSeries([10, 11, 12], {
      startMs: nowMs - 3 * 3_600_000,
      stepMs: 3_600_000,
    });
    const result = forecastMetric(samples, "cpu", {
      windowHours: 168,
      horizonDays: 14,
      nowMs,
    });
    expect(result.risk).toBe("insufficient_data");
    expect(result.slopePerDay).toBeNull();
  });

  it("projects rising disk toward critical", () => {
    // 48 hourly samples: disk climbs ~1.2%/day from ~70%
    const values: number[] = [];
    for (let i = 0; i < 48; i++) {
      values.push(70 + (i / 24) * 1.2);
    }
    const samples = makeSeries(values, {
      startMs: nowMs - 48 * 3_600_000,
      stepMs: 3_600_000,
    });
    const result = forecastMetric(samples, "disk", {
      windowHours: 168,
      horizonDays: 14,
      nowMs,
    });
    expect(result.sampleCount).toBe(48);
    expect(result.slopePerDay).not.toBeNull();
    expect(result.slopePerDay!).toBeGreaterThan(0.5);
    expect(result.projected).not.toBeNull();
    expect(result.projected!).toBeGreaterThan(result.latest!);
    expect(result.daysUntil85).not.toBeNull();
    expect(["watch", "warning", "critical"]).toContain(result.risk);
  });

  it("classifies already-full disk as critical with daysUntil=0", () => {
    const values = Array.from({ length: 24 }, () => 96);
    const samples = makeSeries(values, {
      startMs: nowMs - 24 * 3_600_000,
      stepMs: 3_600_000,
    });
    const result = forecastMetric(samples, "disk", {
      windowHours: 48,
      horizonDays: 7,
      nowMs,
    });
    expect(result.risk).toBe("critical");
    expect(result.daysUntil95).toBe(0);
  });

  it("keeps stable low usage as ok", () => {
    const values = Array.from({ length: 48 }, (_, i) => 30 + Math.sin(i / 5));
    const samples = makeSeries(values, {
      startMs: nowMs - 48 * 3_600_000,
      stepMs: 3_600_000,
    });
    const result = forecastMetric(samples, "mem", {
      windowHours: 168,
      horizonDays: 14,
      nowMs,
    });
    expect(result.risk).toBe("ok");
    expect(result.daysUntil85).toBeNull();
  });
});

describe("buildServerForecast + summarizeFleet", () => {
  const nowMs = Date.parse("2026-07-16T00:00:00.000Z");

  it("aggregates overall risk from the worst metric", () => {
    const risingDisk = makeSeries(
      Array.from({ length: 48 }, (_, i) => 80 + i * 0.15),
      { startMs: nowMs - 48 * 3_600_000 },
    );
    const stable = makeSeries(
      Array.from({ length: 48 }, () => 20),
      { startMs: nowMs - 48 * 3_600_000 },
    );
    const server = buildServerForecast({
      serverId: "s1",
      serverName: "node-a",
      host: "10.0.0.1",
      cpu: stable,
      mem: stable,
      disk: risingDisk,
      windowHours: 168,
      horizonDays: 14,
      nowMs,
    });
    expect(server.metrics).toHaveLength(3);
    expect(server.overallRisk).not.toBe("ok");
    expect(["warning", "critical", "watch"]).toContain(server.overallRisk);
  });

  it("summarizes fleet risk counts", () => {
    const stable = makeSeries(
      Array.from({ length: 24 }, () => 15),
      { startMs: nowMs - 24 * 3_600_000 },
    );
    const a = buildServerForecast({
      serverId: "a",
      serverName: "a",
      cpu: stable,
      mem: stable,
      disk: stable,
      windowHours: 48,
      horizonDays: 7,
      nowMs,
    });
    const b = buildServerForecast({
      serverId: "b",
      serverName: "b",
      cpu: [],
      mem: [],
      disk: [],
      windowHours: 48,
      horizonDays: 7,
      nowMs,
    });
    const summary = summarizeFleet([a, b], { windowHours: 48, horizonDays: 7, nowMs });
    expect(summary.serverCount).toBe(2);
    expect(summary.insufficientData).toBe(1);
    expect(summary.byRisk.ok + summary.byRisk.watch + summary.byRisk.warning + summary.byRisk.critical).toBe(
      summary.forecastable,
    );
  });

  it("worstRisk prefers critical over warning", () => {
    expect(worstRisk(["ok", "warning", "critical"])).toBe("critical");
    expect(worstRisk(["insufficient_data", "ok"])).toBe("ok");
  });
});

describe("getCapacityForecast service", () => {
  const findManyServers = vi.fn();
  const findManySnapshots = vi.fn();

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    findManyServers.mockReset();
    findManySnapshots.mockReset();
  });

  it("returns empty summary when no servers in scope", async () => {
    vi.doMock("@/lib/db", () => ({
      prisma: {
        server: { findMany: findManyServers },
        metricSnapshot: { findMany: findManySnapshots },
      },
    }));
    vi.doMock("@/lib/auth/team-scope", () => ({ teamWhere: () => ({}) }));
    findManyServers.mockResolvedValue([]);

    const { getCapacityForecast } = await import("../capacity-service");
    const result = await getCapacityForecast({ nowMs: Date.parse("2026-07-16T00:00:00Z") });
    expect(result.servers).toEqual([]);
    expect(result.summary.serverCount).toBe(0);
    expect(findManySnapshots).not.toHaveBeenCalled();
  });

  it("builds forecasts from online snapshots only", async () => {
    vi.doMock("@/lib/db", () => ({
      prisma: {
        server: { findMany: findManyServers },
        metricSnapshot: { findMany: findManySnapshots },
      },
    }));
    vi.doMock("@/lib/auth/team-scope", () => ({ teamWhere: () => ({}) }));

    const nowMs = Date.parse("2026-07-16T12:00:00.000Z");
    findManyServers.mockResolvedValue([
      { id: "s1", name: "prod", host: "1.1.1.1", enabled: true },
    ]);
    findManySnapshots.mockResolvedValue(
      Array.from({ length: 24 }, (_, i) => ({
        serverId: "s1",
        cpuUsage: 40 + i * 0.1,
        memUsage: 50,
        diskUsage: 60 + i * 0.2,
        createdAt: new Date(nowMs - (24 - i) * 3_600_000),
      })),
    );

    const { getCapacityForecast } = await import("../capacity-service");
    const result = await getCapacityForecast({
      windowHours: 48,
      horizonDays: 14,
      nowMs,
    });
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0]!.serverId).toBe("s1");
    expect(result.servers[0]!.metrics).toHaveLength(3);
    expect(result.summary.serverCount).toBe(1);
    expect(findManySnapshots).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ isOnline: true }),
      }),
    );
  });
});
