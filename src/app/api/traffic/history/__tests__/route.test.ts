import { describe, expect, it, vi, beforeEach } from "vitest";

const prismaMock = {
  server: {
    findMany: vi.fn(async (): Promise<Array<{ id: string }>> => []),
  },
  trafficSnapshot: {
    create: vi.fn(),
    findMany: vi.fn(),
  },
};

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: () => ({ OR: [{ teamId: "team_a" }, { teamId: null }] }),
}));
vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: vi.fn(async () => ({ session: { userId: "u1", roles: ["viewer"], currentTeamId: "team_a", mustChangePassword: false } })),
}));

const { GET } = await import("../route");

describe("/api/traffic/history", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns persisted traffic history rows", async () => {
    prismaMock.server.findMany.mockResolvedValueOnce([{ id: "srv_a" }]);
    prismaMock.trafficSnapshot.findMany.mockResolvedValueOnce([
      {
        source: "local",
        serverId: null,
        iface: "eth0",
        rxBytes: BigInt("1234"),
        txBytes: BigInt("4567"),
        rxRateBps: 100,
        txRateBps: 200,
        sampledAt: new Date("2026-06-28T10:00:00Z"),
      },
    ]);

    const response = await GET(new Request("http://localhost/api/traffic/history?hours=24&iface=eth0&source=local"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(prismaMock.server.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ teamId: "team_a" }, { teamId: null }] },
        select: { id: true },
      }),
    );
    expect(prismaMock.trafficSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ serverId: null }, { serverId: { in: ["srv_a"] } }],
        }),
      }),
    );
    expect(body.history).toEqual([
      {
        source: "local",
        serverId: null,
        iface: "eth0",
        rx: 100,
        tx: 200,
        rxBytes: "1234",
        txBytes: "4567",
        t: "2026-06-28T10:00:00.000Z",
      },
    ]);
  });
});
