import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    prisma: {
      metricSnapshot: { findMany: vi.fn() },
      downloadTask: { findMany: vi.fn() },
      auditLog: { findMany: vi.fn() },
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

const route = await import("../route");

const session = { userId: "u1", username: "viewer", roles: ["viewer"] };

describe("/api/dashboard/analytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(session);
    mocks.sessionHasPermission.mockReturnValue(false);
    mocks.prisma.metricSnapshot.findMany.mockResolvedValue([]);
    mocks.prisma.downloadTask.findMany.mockResolvedValue([]);
    mocks.prisma.auditLog.findMany.mockResolvedValue([]);
    mocks.prisma.imageUpload.findMany.mockResolvedValue([]);
  });

  it("rejects audit analytics when the session lacks audit:read", async () => {
    const response = await route.GET(new Request("http://local/api/dashboard/analytics?type=audit"));

    expect(response.status).toBe(403);
    expect(mocks.prisma.auditLog.findMany).not.toHaveBeenCalled();
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
    expect(mocks.prisma.metricSnapshot.findMany).toHaveBeenCalled();
    expect(mocks.prisma.auditLog.findMany).not.toHaveBeenCalled();
  });
	  it("scopes metric snapshots through denormalized teamId and downloads/audit/image-bed by teamId", async () => {
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

    const response = await route.GET(new Request("http://local/api/dashboard/analytics?type=all"));
    expect(response.status).toBe(200);

    expect(mocks.prisma.metricSnapshot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { teamId: "team_a" },
            { teamId: null },
          ]),
        }),
      }),
    );
    expect(mocks.prisma.downloadTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { teamId: "team_a" },
            { teamId: null },
          ]),
        }),
      }),
    );
    expect(mocks.prisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { teamId: "team_a" },
            { teamId: null },
          ]),
        }),
      }),
    );
	    expect(mocks.prisma.imageUpload.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: expect.arrayContaining([
            { teamId: "team_a" },
            { teamId: null },
          ]),
        }),
      }),
	    );
	  });

  it("reads every audit page instead of truncating the dashboard total", async () => {
    mocks.sessionHasPermission.mockImplementation(
      (_session, permission: string) => permission === "audit:read",
    );
    const createdAt = new Date("2026-08-01T00:00:00.000Z");
    mocks.prisma.auditLog.findMany
      .mockResolvedValueOnce(Array.from({ length: 5000 }, (_, index) => ({
        id: `audit-${index}`,
        action: "login",
        createdAt,
      })))
      .mockResolvedValueOnce([{ id: "audit-5000", action: "logout", createdAt }]);

    const response = await route.GET(new Request("http://local/api/dashboard/analytics?type=audit"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.audit[0]).toMatchObject({ total: 5001, actions: { login: 5000, logout: 1 } });
    expect(mocks.prisma.auditLog.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ cursor: { id: "audit-4999" }, skip: 1 }),
    );
  });
});
