// @vitest-environment node
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { listAlertIncidents } from "@/lib/alert/incidents";
import { listStorageNodes } from "@/lib/storage/service-nodes";
import { GET as summary } from "../../summary/route";
import { GET as history } from "../route";

const { authenticate } = vi.hoisted(() => ({ authenticate: vi.fn() }));
vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: authenticate }));
vi.mock("@/lib/monitoring/local-network", () => ({ readLocalNetworkDeviceStats: async () => [] }));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("traffic and incident access in a large customer fleet (PostgreSQL)", () => {
  const teamId = "traffic-scope-" + randomUUID().slice(0, 8);
  const userId = teamId + "-reader";
  const session = { currentTeamId: teamId, userId, roles: ["viewer" as const], permissions: ["server:read" as const, "storage:read" as const] };
  const hostId = (i: number) => teamId + "-s" + String(i).padStart(4, "0");
  const ruleId = (i: number) => teamId + "-r" + String(i).padStart(4, "0");
  const granted = teamId + "-granted";
  const denied = teamId + "-denied";
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/test|audit|_ci/.test(url.pathname)) throw new Error("requires an isolated test database");
    await prisma.team.create({ data: { id: teamId, slug: teamId, name: teamId } });
    await prisma.user.create({ data: { id: userId, username: userId, passwordHash: "unused" } });
    await prisma.server.createMany({ data: Array.from({ length: 5002 }, (_, i) => ({
      id: hostId(i), teamId, name: hostId(i), host: hostId(i) + ".test", username: "test",
    })) });
    await prisma.alertRule.createMany({ data: Array.from({ length: 2001 }, (_, i) => ({
      id: ruleId(i), teamId, name: ruleId(i), metric: "cpu_usage", operator: "gte", threshold: 90,
    })) });
    await prisma.userServerAccess.create({ data: { userId, serverId: hostId(0), canRead: false } });
    for (const serverId of [hostId(0), hostId(5001)]) {
      await prisma.trafficSnapshot.create({ data: { source: "server", serverId, iface: "eth0", rxBytes: 1, txBytes: 1 } });
      await prisma.alertIncident.create({ data: {
        fingerprint: serverId, serverId, serverName: serverId, ruleId: ruleId(2000), metric: "cpu_usage", operator: "gte",
        threshold: 90, value: 95, title: "high", message: "high",
      } });
    }
    await prisma.storageNode.createMany({ data: [
      { id: denied, teamId, name: denied, driver: "LOCAL", basePath: "/test/denied" },
      { id: granted, teamId, name: granted, driver: "SFTP", basePath: "/test/granted", serverId: hostId(0) },
    ] });
    await prisma.userStorageAccess.create({ data: { userId, storageNodeId: denied, canRead: false } });
    authenticate.mockResolvedValue({ session });
  }, 60_000);

  afterAll(async () => {
    await prisma.alertRule.deleteMany({ where: { teamId } });
    await prisma.storageNode.deleteMany({ where: { teamId } });
    await prisma.trafficSnapshot.deleteMany({ where: { server: { teamId } } });
    await prisma.server.deleteMany({ where: { teamId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.$disconnect();
  });

  it("finds the only readable sample and incident past 5,000 servers and 2,000 rules", async () => {
    const response = await history(new Request("http://localhost/api/traffic/history"));
    expect(response.status).toBe(200);
    expect((await response.json()).history).toEqual([expect.objectContaining({ serverId: hostId(5001) })]);
    const incidents = await listAlertIncidents({ session, status: "OPEN", take: 10 });
    expect(incidents.map(({ serverId, ruleId }) => [serverId, ruleId])).toEqual([[hostId(5001), ruleId(2000)]]);
  });

  it("matches the regular storage list and hides the denied server behind a readable node", async () => {
    const regular = await listStorageNodes(session);
    const response = await summary(new NextRequest("http://localhost/api/traffic/summary"));
    expect(response.status).toBe(200);
    const { storageNodes } = await response.json();
    expect(regular.map((node) => node.id)).toEqual([granted]);
    expect(storageNodes).toEqual([expect.objectContaining({ id: granted, server: null, serverId: null, remoteServerId: null })]);
    expect(JSON.stringify(storageNodes)).not.toContain(hostId(0));
  });
});
