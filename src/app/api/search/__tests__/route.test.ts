import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    getRemoteApps: vi.fn(),
    prisma: {
      server: { findMany: vi.fn() },
      playbook: { findMany: vi.fn() },
      quickService: { findMany: vi.fn() },
    },
  },
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: mocks.requireApiSession,
  isSessionPayload: (value: unknown) => Boolean(value),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: mocks.sessionHasPermission,
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/quick-service/app-source-sync", () => ({
  getRemoteApps: mocks.getRemoteApps,
}));
vi.mock("@/lib/quick-service/catalog", () => ({ SERVICE_CATALOG: [] }));

const route = await import("../route");

describe("/api/search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue({
      userId: "u1",
      username: "op",
      roles: ["operator"],
      currentTeamId: "team_a",
    });
    mocks.sessionHasPermission.mockReturnValue(false);
    mocks.prisma.server.findMany.mockResolvedValue([]);
    mocks.prisma.playbook.findMany.mockResolvedValue([]);
    mocks.prisma.quickService.findMany.mockResolvedValue([]);
    mocks.getRemoteApps.mockResolvedValue([]);
  });

  it("scopes remote quick-service installs to the caller's team servers", async () => {
    mocks.sessionHasPermission.mockImplementation(
      (_session, permission: string) => permission === "docker:manage",
    );

    const res = await route.GET(new Request("http://local/api/search?q=alist"));

    expect(res.status).toBe(200);
    // hub-host installs (serverId null) stay platform-visible; remote installs
    // inherit their Server's strict tenant scope.
    expect(mocks.prisma.quickService.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ serverId: null }, { server: { teamId: "team_a" } }],
        },
      }),
    );
  });

  it("does not query quick-services at all without docker:manage", async () => {
    const res = await route.GET(new Request("http://local/api/search?q=alist"));

    expect(res.status).toBe(200);
    expect(mocks.prisma.quickService.findMany).not.toHaveBeenCalled();
  });

  it("scopes servers with the strict server filter", async () => {
    mocks.sessionHasPermission.mockImplementation(
      (_session, permission: string) => permission === "server:read",
    );

    await route.GET(new Request("http://local/api/search?q=web"));

    const where = mocks.prisma.server.findMany.mock.calls[0]?.[0].where;
    expect(where).toMatchObject({ teamId: "team_a" });
  });
});
