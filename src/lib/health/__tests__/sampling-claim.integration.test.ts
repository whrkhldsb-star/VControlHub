// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { persistServerTrafficFromMetrics } from "@/lib/monitoring/server-traffic-snapshot";
import type { ServerMetrics } from "@/lib/server/monitor";
import { getMetricHistory, snapshotHealthOverview } from "../service-metrics";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("sampling claim and report time (PostgreSQL)", () => {
  const id = `sample-${randomUUID()}`;
  const jobIds = [id + "-a", id + "-b"];
  const time = new Date(Date.now() - 120_000);
  const metrics: ServerMetrics = {
    source: "agent", timestamp: time.toISOString(), uptime: "1 day",
    cpu: { usagePercent: 42, cores: 1, loadAvg: [1, 1, 1] }, memory: { totalMb: 10, usedMb: 5, availableMb: 5, usagePercent: 50 },
    disk: [], network: [{ iface: "eth0", rxBytes: 1000, txBytes: 2000 }],
  };
  const claim = (jobId: string) => ({ jobId, workerId: "sampler", attempts: 1, signal: new AbortController().signal });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) throw new Error("requires an isolated loopback test database");
    await prisma.team.create({ data: { id, name: id, slug: id } });
    await prisma.server.create({ data: { id, teamId: id, name: id, host: "localhost", port: 1, username: "test", tags: [] } });
    await prisma.job.createMany({ data: jobIds.map((jobId) => ({ id: jobId, title: "sampling", type: "health.sample", payload: {}, workerId: "sampler", attempts: 1, status: "RUNNING" as const, leaseExpiresAt: new Date(Date.now() + 120_000) })) });
  });
  afterAll(async () => {
    await prisma.trafficSnapshot.deleteMany({ where: { serverId: id } });
    await prisma.metricSnapshot.deleteMany({ where: { serverId: id } });
    await prisma.job.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.server.deleteMany({ where: { id } });
    await prisma.team.deleteMany({ where: { id } });
    await prisma.$disconnect();
  });

  it("stores a repeated report once at source time, including overlapping jobs and job reclaim", async () => {
    const written = await Promise.all(jobIds.map((jobId) => persistServerTrafficFromMetrics(id, metrics, claim(jobId))));
    expect(written.filter(Boolean)).toHaveLength(1);
    const won = jobIds[written.indexOf(true)]!;
    const again = { ...metrics, timestamp: new Date(time.getTime() + 1000).toISOString() };
    expect(await persistServerTrafficFromMetrics(id, again, claim(won))).toBe(false);
    expect(await prisma.trafficSnapshot.findMany({ where: { serverId: id }, select: { sampledAt: true } })).toEqual([{ sampledAt: time }]);
  });

  it("preserves partial metrics, checks access in the history query and fences a lost generation", async () => {
    const active = claim(jobIds[0]!);
    const overview = { online: 1, total: 1, warning: 0, offline: 0, critical: 0, servers: [{
      enabled: true, serverId: id, serverName: id, host: "localhost", status: "healthy" as const, cpu: 42, mem: 50, lastCheck: metrics.timestamp,
    }] };
    expect(await snapshotHealthOverview(overview, { claim: active })).toEqual({ count: 1 });
    expect(await snapshotHealthOverview(overview, { claim: active })).toEqual({ count: 0 });
    expect(await getMetricHistory(id, 24, { roles: [], userId: id, currentTeamId: id })).toMatchObject([{ cpuUsage: 42, memUsage: 50, diskUsage: null }]);
    expect(await getMetricHistory(id, 24, { roles: [], userId: id, currentTeamId: id + "-other" })).toEqual([]);
    await prisma.job.update({ where: { id: active.jobId }, data: { attempts: 2, workerId: "new-worker" } });
    await expect(snapshotHealthOverview(overview, { claim: active })).rejects.toThrow("lease lost");
    await expect(persistServerTrafficFromMetrics(id, metrics, active)).rejects.toThrow("lease lost");
    expect(await prisma.metricSnapshot.count({ where: { serverId: id } })).toBe(1);
  });
});
