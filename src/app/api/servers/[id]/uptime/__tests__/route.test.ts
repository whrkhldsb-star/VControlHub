/**
 * GET /api/servers/[id]/uptime
 *
 * Two properties matter here. First, tenant isolation: `serverId` comes straight
 * from the URL, so `assertServerTeamAccess` must run before any snapshot row is
 * read. Second, the window: the route must return today plus the previous 89 days
 * — a UTC-midnight floor, not a rolling 90×24h cutoff, or the oldest day would
 * drop in and out depending on the hour the request lands.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    findMany: vi.fn(),
    assertServerTeamAccess: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));

vi.mock("@/lib/db", () => ({
  prisma: { serverUptimeSnapshot: { findMany: mocks.findMany } },
}));

vi.mock("@/lib/server/team-access", () => ({
  assertServerTeamAccess: mocks.assertServerTeamAccess,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const route = await import("../route");

const session = { userId: "u1", username: "alice", roles: ["operator"], currentTeamId: "team_1" };

function request(id = "srv1") {
  return {
    req: new Request(`http://local/api/servers/${id}/uptime`, { method: "GET" }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

function snapshot(date: string, overrides: Record<string, unknown> = {}) {
  return {
    date: new Date(`${date}T00:00:00.000Z`),
    uptimePercent: 99.5,
    onlineMinutes: 1433,
    offlineMinutes: 7,
    checkCount: 288,
    ...overrides,
  };
}

describe("GET /api/servers/[id]/uptime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.assertServerTeamAccess.mockResolvedValue({ ok: true, server: { id: "srv1", teamId: "team_1" } });
    mocks.findMany.mockResolvedValue([]);
  });

  it("requires the server:read permission", async () => {
    const { req, ctx } = request();
    await route.GET(req as never, ctx);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("server:read");
  });

  it("returns one entry per snapshot with the date reduced to YYYY-MM-DD", async () => {
    mocks.findMany.mockResolvedValue([
      snapshot("2026-08-30", { uptimePercent: 100, offlineMinutes: 0, onlineMinutes: 1440 }),
      snapshot("2026-08-31"),
    ]);

    const { req, ctx } = request();
    const res = await route.GET(req as never, ctx);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data).toEqual([
      { date: "2026-08-30", uptimePercent: 100, onlineMinutes: 1440, offlineMinutes: 0, checkCount: 288 },
      { date: "2026-08-31", uptimePercent: 99.5, onlineMinutes: 1433, offlineMinutes: 7, checkCount: 288 },
    ]);
  });

  it("returns an empty list rather than 404 for a server with no history", async () => {
    const { req, ctx } = request();
    const res = await route.GET(req as never, ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [] });
  });

  it("404s a server outside the caller's team without reading any snapshot", async () => {
    mocks.assertServerTeamAccess.mockResolvedValue({
      ok: false,
      response: new Response(JSON.stringify({ error: "Server not found" }), { status: 404 }),
    });

    const { req, ctx } = request("srv-other");
    const res = await route.GET(req as never, ctx);

    expect(res.status).toBe(404);
    expect(mocks.findMany).not.toHaveBeenCalled();
  });

  it("checks team scope against the id from the URL", async () => {
    const { req, ctx } = request("srv-42");
    await route.GET(req as never, ctx);
    expect(mocks.assertServerTeamAccess).toHaveBeenCalledWith(session, "srv-42");
  });

  it("queries a 90-day window floored to UTC midnight, ordered oldest first", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-31T18:45:12.000Z"));
    try {
      const { req, ctx } = request();
      await route.GET(req as never, ctx);
    } finally {
      vi.useRealTimers();
    }

    expect(mocks.findMany).toHaveBeenCalledWith({
      where: { serverId: "srv1", date: { gte: new Date("2026-06-03T00:00:00.000Z") } },
      orderBy: { date: "asc" },
      take: 90,
    });
  });

  it("scopes the snapshot query to the requested server", async () => {
    const { req, ctx } = request("srv-42");
    await route.GET(req as never, ctx);
    const where = mocks.findMany.mock.calls[0]?.[0]?.where;
    expect(where?.serverId).toBe("srv-42");
  });
});
