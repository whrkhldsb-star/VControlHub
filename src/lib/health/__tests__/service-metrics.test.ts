import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ServerHealth } from "../service-types";

const createMany = vi.fn();
const serverFindMany = vi.fn();
const writeLatestMetrics = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    metricSnapshot: {
      createMany,
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    server: {
      findMany: serverFindMany,
      findUnique: vi.fn(),
    },
  },
}));
vi.mock("@/lib/public-status/latest-writer", () => ({ writeLatestMetrics }));

const { latestMetricInput, snapshotHealthOverview } = await import("../service-metrics");

const overview = (servers: ServerHealth[]) => ({ total: servers.length, online: 0, warning: 0, critical: 0, offline: 0, servers });

describe("snapshotHealthOverview", () => {
  beforeEach(() => {
    createMany.mockReset();
    createMany.mockResolvedValue({ count: 2 });
    writeLatestMetrics.mockReset();
    writeLatestMetrics.mockResolvedValue(1);
    serverFindMany.mockReset();
    serverFindMany.mockImplementation(async ({ where }: { where: { id: { in: string[] } } }) =>
      (where.id.in ?? []).map((id: string) => ({ id, teamId: null })),
    );
  });

  it("records offline hosts as isOnline=false with the failed probe", async () => {
    await snapshotHealthOverview(overview([
      {
        serverId: "s1",
        serverName: "a",
        host: "1.1.1.1",
        enabled: true,
        status: "offline",
        probeStatus: "failed",
        lastCheck: new Date().toISOString(),
        error: "Network unreachable",
      },
    ]));
    expect(createMany).toHaveBeenCalledWith({
      data: [{ serverId: "s1", cpuUsage: 0, memUsage: 0, diskUsage: 0, isOnline: false, intervalSeconds: 300, probeStatus: "failed", probeLatencyMs: null, teamId: null }],
    });
  });

  it("records SSH-auth warning hosts as isOnline=false instead of omitting them", async () => {
    await snapshotHealthOverview(overview([
      {
        serverId: "s11",
        serverName: "11",
        host: "154.196.139.44",
        enabled: true,
        status: "warning",
        probeStatus: "ok",
        latencyMs: 41.5,
        lastCheck: new Date().toISOString(),
        error: "SSH unreachable: All configured authentication methods failed",
      },
    ]), { intervalSeconds: 600 });
    expect(createMany).toHaveBeenCalledWith({
      data: [{ serverId: "s11", cpuUsage: 0, memUsage: 0, diskUsage: 0, isOnline: false, intervalSeconds: 600, probeStatus: "ok", probeLatencyMs: 41.5, teamId: null }],
    });
  });

  it("keeps metric samples for healthy hosts; no probe means probeStatus null (not measured)", async () => {
    await snapshotHealthOverview(overview([
      {
        serverId: "s2",
        serverName: "ok",
        host: "2.2.2.2",
        enabled: true,
        status: "healthy",
        cpu: 12,
        mem: 34,
        diskMax: 50,
        lastCheck: new Date().toISOString(),
      },
    ]));
    expect(createMany).toHaveBeenCalledWith({
      data: [{ serverId: "s2", cpuUsage: 12, memUsage: 34, diskUsage: 50, isOnline: true, intervalSeconds: 300, probeStatus: null, probeLatencyMs: null, teamId: null }],
    });
  });

  it("upserts the latest row for each checked server and survives an upsert failure", async () => {
    writeLatestMetrics.mockRejectedValueOnce(new Error("db down"));
    await snapshotHealthOverview(overview([
      { serverId: "s3", serverName: "x", host: "h", enabled: true, status: "offline", probeStatus: "failed", lastCheck: "2026-10-13T00:00:00.000Z" },
      { serverId: "s4", serverName: "y", host: "h", enabled: false, status: "offline", lastCheck: "2026-10-13T00:00:00.000Z" },
    ]));
    expect(writeLatestMetrics).toHaveBeenCalledWith([
      expect.objectContaining({ serverId: "s3", online: false, offlineReason: "unreachable", intervalSeconds: 300 }),
    ]);
    // The durable history sample is still written.
    expect(createMany).toHaveBeenCalledTimes(1);
  });
});

describe("latestMetricInput", () => {
  const at = new Date("2026-10-13T10:00:00.000Z");

  it("uses the sample's own time and source for Agent data, without a probe", () => {
    const input = latestMetricInput({
      serverId: "a1",
      serverName: "agent",
      host: "h",
      enabled: true,
      status: "healthy",
      cpu: 5,
      mem: 6,
      diskMax: 7,
      lastCheck: "2026-10-13T09:59:10.000Z",
      metrics: {
        cpu: { usagePercent: 5, cores: 2, loadAvg: [0.1, 0.2, 0.3] },
        memory: { totalMb: 1024, usedMb: 512, availableMb: 512, usagePercent: 50 },
        disk: [{ mount: "/", totalGb: "20G", usedGb: "5G", usagePercent: 25 }],
        network: [{ iface: "eth0", rxBytes: 100, txBytes: 50 }],
        uptime: "2 days, 3:04",
        timestamp: "2026-10-13T09:59:10.000Z",
        source: "agent",
      },
    }, at, 300);
    expect(input).toMatchObject({ serverId: "a1", online: true, checkedAt: at, probe: null, intervalSeconds: 300 });
    expect(input?.metrics?.sampledAt.toISOString()).toBe("2026-10-13T09:59:10.000Z");
    expect(input?.metrics?.source).toBe("agent");
    expect(input?.metrics?.values).toMatchObject({ cpuUsage: 5, memUsedMb: 512, netIface: "eth0", uptimeSeconds: 2 * 86_400 + 3 * 3_600 + 4 * 60 });
  });

  it("marks a reachable host whose metrics failed as collect_failed with its RTT", () => {
    expect(latestMetricInput({ serverId: "w", serverName: "w", host: "h", enabled: true, status: "warning", probeStatus: "ok", latencyMs: 12, lastCheck: "x" }, at, 300)).toMatchObject({
      online: false,
      offlineReason: "collect_failed",
      probe: { at, ok: true, latencyMs: 12 },
    });
  });

  it("skips disabled servers", () => {
    expect(latestMetricInput({ serverId: "d", serverName: "d", host: "h", enabled: false, status: "offline", lastCheck: "x" }, at, 300)).toBeNull();
  });
});
