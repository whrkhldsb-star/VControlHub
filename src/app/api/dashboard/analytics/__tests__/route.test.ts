import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    hourlyServerUsage: vi.fn(),
    dailyAuditActivity: vi.fn(),
    prisma: {
      server: { findMany: vi.fn() },
      downloadTask: { findMany: vi.fn() },
      imageUpload: { findMany: vi.fn() },
    },
  },
}));

vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: mocks.requireApiSession ,
  isSessionPayload: (value: unknown) => Boolean(value),
}));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.sessionHasPermission }));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ error: vi.fn(), warn: vi.fn(), info: vi.fn() }) }));
// The grouped statements themselves run against PostgreSQL in
// src/lib/dashboard/__tests__/analytics-queries.integration.test.ts; here: what the route asks them for.
vi.mock("@/lib/dashboard/analytics-queries", () => ({
  hourlyServerUsage: mocks.hourlyServerUsage,
  dailyAuditActivity: mocks.dailyAuditActivity,
}));

const route = await import("../route");

const session = { userId: "u1", username: "viewer", roles: ["viewer"] };

describe("/api/dashboard/analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(session);
    mocks.sessionHasPermission.mockReturnValue(false);
    mocks.hourlyServerUsage.mockResolvedValue([]);
    mocks.dailyAuditActivity.mockResolvedValue([]);
    mocks.prisma.server.findMany.mockResolvedValue([]);
    mocks.prisma.downloadTask.findMany.mockResolvedValue([]);
    mocks.prisma.imageUpload.findMany.mockResolvedValue([]);
  });

  it("returns the hourly usage of the last day and the audit activity of the last thirty", async () => {
    mocks.sessionHasPermission.mockImplementation((_session, permission: string) => permission === "server:read" || permission === "audit:read");
    mocks.hourlyServerUsage.mockResolvedValue([{ time: "2026-08-01T10:00:00.000Z", cpu: 60, memory: 40, disk: 20 }]);
    mocks.dailyAuditActivity.mockResolvedValue([{ date: "2026-08-01", total: 5001, actions: { login: 5000, logout: 1 } }]);
    const before = Date.now();

    const body = await (await route.GET(new Request("http://local/api/dashboard/analytics?type=all"))).json();

    expect(body.servers).toEqual([{ time: "2026-08-01T10:00:00.000Z", cpu: 60, memory: 40, disk: 20 }]);
    expect(body.audit).toEqual([{ date: "2026-08-01", total: 5001, actions: { login: 5000, logout: 1 } }]);
    const [serversSince] = mocks.hourlyServerUsage.mock.calls[0]!;
    const [auditSince] = mocks.dailyAuditActivity.mock.calls[0]!;
    const DAY = 24 * 60 * 60 * 1000;
    expect(before - (serversSince as Date).getTime()).toBeGreaterThanOrEqual(DAY - 5_000);
    expect(before - (serversSince as Date).getTime()).toBeLessThanOrEqual(DAY + 5_000);
    expect(before - (auditSince as Date).getTime()).toBeGreaterThanOrEqual(30 * DAY - 5_000);
    expect(before - (auditSince as Date).getTime()).toBeLessThanOrEqual(30 * DAY + 5_000);
  });

  it("rejects audit analytics when the session lacks audit:read", async () => {
    const response = await route.GET(new Request("http://local/api/dashboard/analytics?type=audit"));

    expect(response.status).toBe(403);
    expect(mocks.dailyAuditActivity).not.toHaveBeenCalled();
  });

  it("filters all analytics to the domains the session may read", async () => {
    mocks.sessionHasPermission.mockImplementation((_session, permission: string) => permission === "server:read");

    const response = await route.GET(new Request("http://local/api/dashboard/analytics?type=all"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveProperty("servers");
    expect(body).not.toHaveProperty("audit");
    expect(body).not.toHaveProperty("downloads");
    expect(body).not.toHaveProperty("imageBed");
    expect(mocks.hourlyServerUsage).toHaveBeenCalled();
    expect(mocks.dailyAuditActivity).not.toHaveBeenCalled();
  });

  it("reads the usage of the servers the strict server filter allows, and downloads/audit/image-bed by teamId", async () => {
    mocks.sessionHasPermission.mockImplementation(
      (_session, permission: string) =>
        permission === "server:read" ||
        permission === "storage:read" ||
        permission === "audit:read" ||
        permission === "image:read",
    );
    mocks.requireApiSession.mockResolvedValue({
      ...session,
      currentTeamId: "team_a",
      roles: ["viewer"],
    });
    mocks.prisma.server.findMany.mockResolvedValue([{ id: "srv_1" }, { id: "srv_2" }]);

    const response = await route.GET(new Request("http://local/api/dashboard/analytics?type=all"));
    expect(response.status).toBe(200);

    // Metric snapshots follow their Server security root, including its
    // per-user access rule, rather than trusting the snapshot's teamId alone.
    expect(mocks.prisma.server.findMany).toHaveBeenCalledWith({
      where: {
        AND: [
          { teamId: "team_a" },
          expect.objectContaining({ OR: expect.any(Array) }),
        ],
      },
      select: { id: true },
    });
    expect(mocks.hourlyServerUsage).toHaveBeenCalledWith(expect.any(Date), ["srv_1", "srv_2"]);
    expect(mocks.dailyAuditActivity).toHaveBeenCalledWith(expect.any(Date), "team_a");
    expect(mocks.prisma.downloadTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ teamId: "team_a" }),
      }),
    );
    expect(mocks.prisma.imageUpload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ teamId: "team_a" }),
      }),
    );
  });

  it("reads every customer's servers and audit rows for an administrator viewing all customers", async () => {
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.requireApiSession.mockResolvedValue({ ...session, roles: ["admin"], currentTeamId: null });

    await route.GET(new Request("http://local/api/dashboard/analytics?type=all"));

    expect(mocks.prisma.server.findMany).not.toHaveBeenCalled();
    expect(mocks.hourlyServerUsage).toHaveBeenCalledWith(expect.any(Date), null);
    expect(mocks.dailyAuditActivity).toHaveBeenCalledWith(expect.any(Date), null);
  });

  it("reads nothing for an account with no customer selected", async () => {
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.requireApiSession.mockResolvedValue({ ...session, roles: ["viewer"], currentTeamId: null });

    await route.GET(new Request("http://local/api/dashboard/analytics?type=all"));

    // No server matches the sentinel; the audit scope names a customer that does not exist, not "all".
    expect(mocks.prisma.server.findMany).toHaveBeenCalledWith({ where: { id: "__unassigned_servers_require_team_manage__" }, select: { id: true } });
    expect(mocks.hourlyServerUsage).toHaveBeenCalledWith(expect.any(Date), []);
    expect(mocks.dailyAuditActivity).toHaveBeenCalledWith(expect.any(Date), "__no_active_team__");
  });

  it("files download tasks under their application-time (Asia/Shanghai) day", async () => {
    mocks.sessionHasPermission.mockImplementation((_session, permission: string) => permission === "storage:read");
    // 01:00 on 2026-08-02 in Beijing is still 2026-08-01 in UTC.
    mocks.prisma.downloadTask.findMany.mockResolvedValueOnce([
      { id: "d1", status: "COMPLETED", createdAt: new Date("2026-08-01T17:00:00.000Z") },
      { id: "d2", status: "FAILED", createdAt: new Date("2026-08-01T15:00:00.000Z") },
    ]);

    const body = await (await route.GET(new Request("http://local/api/dashboard/analytics?type=downloads"))).json();

    expect(body.downloads).toEqual([
      { date: "2026-08-02", completed: 1, failed: 0, running: 0, pending: 0 },
      { date: "2026-08-01", completed: 0, failed: 1, running: 0, pending: 0 },
    ]);
  });
});
