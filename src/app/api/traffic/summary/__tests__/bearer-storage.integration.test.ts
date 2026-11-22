// @vitest-environment node
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApiToken } from "@/lib/api-token/service";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { prisma } from "@/lib/db";
import { GET } from "../route";

vi.mock("@/lib/monitoring/local-network", () => ({ readLocalNetworkDeviceStats: async () => [] }));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("traffic summary Bearer storage access (PostgreSQL)", () => {
  const id = "traffic-bearer-" + randomUUID();
  const where = { id };
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || !/audit|test|_ci/.test(url.pathname)) throw new Error("requires an isolated loopback test database");
    await prisma.$transaction(async (tx) => {
      await tx.team.create({ data: { id, name: id, slug: id } });
      await tx.identityTemplate.create({ data: { id, name: id, permissions: ["api-token:manage", "server:read", "storage:read"] } });
      await tx.user.create({ data: {
        id, username: id, status: "ACTIVE", passwordHash: "test", mustChangePassword: false,
        teamMembership: { create: { teamId: id, identityTemplateId: id } },
      } });
      await tx.storageNode.create({ data: { id, name: id, teamId: id, driver: "LOCAL", basePath: "/" } });
    });
  });
  afterAll(async () => {
    await prisma.storageNode.deleteMany({ where });
    await prisma.user.deleteMany({ where });
    await prisma.identityTemplate.deleteMany({ where });
    await prisma.team.deleteMany({ where });
    await prisma.$disconnect();
  });

  it("intersects token scopes, owner permissions and the node's live grant", async () => {
    const session = await verifySessionToken(await createSessionToken({ userId: id, username: id, roles: [], currentTeamId: id, mustChangePassword: false }));
    const serverOnly = await createApiToken({ session, name: "server", scopes: ["server:read"] });
    const withStorage = await createApiToken({ session, name: "storage", scopes: ["server:read", "storage:read"] });
    async function nodes(token: string) {
      const response = await GET(new NextRequest("http://localhost/api/traffic/summary", { headers: { authorization: "Bearer " + token } }));
      expect(response.status).toBe(200);
      return (await response.json()).storageNodes;
    }
    expect(await nodes(serverOnly.token)).toEqual([]);
    expect(await nodes(withStorage.token)).toMatchObject([{ id }]);
    await prisma.userStorageAccess.create({ data: { id, userId: id, storageNodeId: id, canRead: false } });
    expect(await nodes(withStorage.token)).toEqual([]);
    await prisma.userStorageAccess.delete({ where });
    await prisma.identityTemplate.update({ where, data: { permissions: ["server:read"] } });
    expect(await nodes(withStorage.token)).toEqual([]);
  });
});
