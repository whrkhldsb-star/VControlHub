// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { rollupServerUptimeForDay } from "@/lib/uptime/rollup";

import { getCapacityForecast } from "../capacity-service";
import { getMetricHistory } from "../service-metrics";

/**
 * A Windows server without the agent is sampled online with no values. Its
 * day must count as up (it read 0% every day), and nothing that averages the
 * samples may read the missing values as 0%. Real PostgreSQL only.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("unmeasured metric samples", () => {
  const prefix = `unmeasured-${randomUUID()}`;
  const now = Date.now();

  beforeAll(async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await prisma.server.create({ data: { id: prefix, name: prefix, host: "127.0.0.1", port: 1, username: "root", tags: [], operatingSystem: "WINDOWS" } });
    await prisma.metricSnapshot.createMany({
      data: Array.from({ length: 12 }, (_, index) => ({
        serverId: prefix, cpuUsage: null, memUsage: null, diskUsage: null, isOnline: true,
        intervalSeconds: 300, probeStatus: "ok", probeLatencyMs: 12, createdAt: new Date(now - (12 - index) * 300_000),
      })),
    });
  });

  afterAll(async () => {
    await prisma.serverUptimeSnapshot.deleteMany({ where: { serverId: prefix } });
    await prisma.metricSnapshot.deleteMany({ where: { serverId: prefix } });
    await prisma.server.deleteMany({ where: { id: prefix } });
    await prisma.$disconnect();
  });

  it("counts the server's day as up", async () => {
    await rollupServerUptimeForDay(new Date(now - 30 * 60_000));
    const days = await prisma.serverUptimeSnapshot.findMany({ where: { serverId: prefix } });
    expect(days.length).toBeGreaterThan(0);
    for (const day of days) {
      expect(day.uptimePercent).toBe(100);
      expect(day.offlineMinutes).toBe(0);
    }
  });

  it("has nothing to chart or forecast rather than 0% readings", async () => {
    expect(await getMetricHistory(prefix, 24)).toEqual([]);
    const forecast = await getCapacityForecast({ serverId: prefix, windowHours: 24, nowMs: now });
    const server = forecast.servers.find((row) => row.serverId === prefix);
    expect(server?.sampleCount ?? 0).toBe(0);
  });
});
