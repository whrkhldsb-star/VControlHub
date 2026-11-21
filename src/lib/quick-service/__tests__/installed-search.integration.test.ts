// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import { GET } from "@/app/api/search/route";

const auth = vi.hoisted(() => ({ session: vi.fn() }));
vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: auth.session, isSessionPayload: () => true }));
vi.mock("@/lib/quick-service/app-source-sync", () => ({ getRemoteApps: async () => [] }));

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("installed service search (PostgreSQL)", () => {
  const teamId = "search-" + randomUUID();
  const earlier = teamId + "-first", later = teamId + "-last";
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/test|audit|_ci/.test(db.pathname)) throw new Error("requires a local test database");
    auth.session.mockResolvedValue({ userId: teamId, roles: ["operator"], permissions: ["docker:manage"], currentTeamId: teamId });
    await prisma.team.create({ data: { id: teamId, name: teamId, slug: teamId } });
    await prisma.server.createMany({ data: [earlier, later].map(id => ({ id, teamId, name: id, host: id + ".test", username: "ops" })) });
    await prisma.quickService.createMany({ data: [
      ...Array.from({ length: 501 }, (_, i) => ({
        serverId: earlier, instanceKey: earlier, slug: "filler-" + i, name: "A " + i, image: "fixture", port: 8200,
      })),
      { serverId: later, instanceKey: later, slug: "ghost", name: "Z Ghost instance", image: "fixture", port: 2368, status: "running" },
    ] });
  });
  afterAll(async () => {
    await prisma.quickService.deleteMany({ where: { serverId: { in: [earlier, later] } } });
    await prisma.server.deleteMany({ where: { teamId } });
    await prisma.team.deleteMany({ where: { id: teamId } });
    await prisma.$disconnect();
  });

  it("finds the 502nd instance by its key even when its slug belongs to a built-in app", async () => {
    const response = await GET(new Request("http://local/api/search?q=" + later));
    expect(response.status).toBe(200);
    expect((await response.json()).results).toEqual([
      expect.objectContaining({ id: "quick-service:ghost", label: "Z Ghost instance" }),
    ]);
  });
});
