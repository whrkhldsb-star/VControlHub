import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  hasBearerAuthorizationMock,
  authenticateBearerForPermissionsMock,
  collectAllHealthMock,
  getMetricHistoryMock,
  assertServerTeamAccessMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  hasBearerAuthorizationMock: vi.fn(),
  authenticateBearerForPermissionsMock: vi.fn(),
  collectAllHealthMock: vi.fn(),
  getMetricHistoryMock: vi.fn(),
  assertServerTeamAccessMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/auth/bearer-token", () => ({
  hasBearerAuthorization: hasBearerAuthorizationMock,
  authenticateBearerForPermissions: authenticateBearerForPermissionsMock,
}));
vi.mock("@/lib/health/service", () => ({
  collectAllHealth: collectAllHealthMock,
  getMetricHistory: getMetricHistoryMock,
}));
vi.mock("@/lib/server/team-access", () => ({ assertServerTeamAccess: assertServerTeamAccessMock }));

import { GET } from "../route";

const session = { userId: "user_1", username: "viewer", roles: ["viewer"] };

describe("/api/health", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // Route-level single-flight would otherwise reuse a sweep between the
    // tests below and hide calls the assertions expect.
    process.env.HEALTH_OVERVIEW_CACHE_TTL_MS = "0";
    requireApiPermissionMock.mockResolvedValue({ session });
    hasBearerAuthorizationMock.mockImplementation(
      (request: Request) => request.headers.has("authorization"),
    );
    authenticateBearerForPermissionsMock.mockResolvedValue({
      session,
      tokenId: "tok_1",
      scopes: ["health:read"],
    });
    collectAllHealthMock.mockResolvedValue({
      total: 1,
      online: 1,
      warning: 0,
      critical: 0,
      offline: 0,
      servers: [
        {
          serverId: "srv_1",
          serverName: "生产节点",
          host: "10.0.0.5",
          enabled: true,
          status: "healthy",
          cpu: 12.3,
          mem: 45.6,
          diskMax: 50,
          uptime: "1 day",
          lastCheck: "2026-05-06T00:00:00.000Z",
        },
      ],
    });
    getMetricHistoryMock.mockResolvedValue([
      {
        cpuUsage: 10,
        memUsage: 20,
        diskUsage: 30,
        isOnline: true,
        createdAt: new Date("2026-05-06T00:00:00.000Z"),
      },
    ]);
    assertServerTeamAccessMock.mockResolvedValue({ ok: true, server: { id: "srv_1" } });
  });

  it("returns 401 when the session is missing", async () => {
    requireApiPermissionMock.mockResolvedValueOnce(
      NextResponse.json({ error: "未登录或会话已过期" }, { status: 401 }),
    );

    const response = await GET(new Request("https://example.com/api/health"));

    expect(response.status).toBe(401);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("health:read");
    expect(collectAllHealthMock).not.toHaveBeenCalled();
  });

  it("requires health read permission via the shared API guard before exposing node health details", async () => {
    requireApiPermissionMock.mockResolvedValueOnce(
      NextResponse.json({ error: "缺少权限" }, { status: 403 }),
    );

    const response = await GET(new Request("https://example.com/api/health"));

    expect(response.status).toBe(403);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("health:read");
    expect(collectAllHealthMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "缺少权限" });
  });


  it("rejects Bearer tokens whose user no longer exists (no unscoped fleet dump)", async () => {
    authenticateBearerForPermissionsMock.mockResolvedValueOnce(
      Response.json({ error: "invalid token" }, { status: 401 }),
    );

    const response = await GET(
      new Request("https://example.com/api/health", {
        headers: { authorization: "Bearer whr_stale" },
      }),
    );

    expect(response.status).toBe(401);
    expect(collectAllHealthMock).not.toHaveBeenCalled();
    expect(getMetricHistoryMock).not.toHaveBeenCalled();
  });

  it("allows health read API tokens to fetch node health for external monitors", async () => {
    const response = await GET(
      new Request("https://example.com/api/health", {
        headers: { authorization: "Bearer whr_fake_health" },
      }),
    );

    expect(response.status).toBe(200);
    expect(authenticateBearerForPermissionsMock).toHaveBeenCalledWith(
      expect.any(Request),
      ["health:read"],
    );
    expect(requireApiPermissionMock).not.toHaveBeenCalled();
    expect(collectAllHealthMock).toHaveBeenCalledOnce();
    expect(collectAllHealthMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: "user_1" }),
    );
  });

  it("rejects invalid or insufficient Bearer tokens without falling back to session", async () => {
    authenticateBearerForPermissionsMock.mockResolvedValueOnce(
      Response.json({ error: "invalid token" }, { status: 401 }),
    );

    const response = await GET(
      new Request("https://example.com/api/health", {
        headers: { authorization: "Bearer invalid_token" },
      }),
    );

    expect(response.status).toBe(401);
    expect(requireApiPermissionMock).not.toHaveBeenCalled();
    expect(collectAllHealthMock).not.toHaveBeenCalled();
  });

  it("collects real-time health without coupling history snapshots to page requests", async () => {
    const response = await GET(new Request("https://example.com/api/health"));

    expect(response.status).toBe(200);
    expect(collectAllHealthMock).toHaveBeenCalledOnce();
    await expect(response.json()).resolves.toMatchObject({
      total: 1,
      servers: [{ serverId: "srv_1" }],
    });
  });

  it("applies health read permission to metric history", async () => {
    const response = await GET(
      new Request("https://example.com/api/health?historyFor=srv_1&hours=6"),
    );

    expect(response.status).toBe(200);
    expect(assertServerTeamAccessMock).toHaveBeenCalledWith(expect.any(Object), "srv_1");
    expect(getMetricHistoryMock).toHaveBeenCalledWith("srv_1", 6);
    await expect(response.json()).resolves.toMatchObject({
      history: [
        {
          cpu: 10,
          mem: 20,
          disk: 30,
          online: true,
          t: "2026-05-06T00:00:00.000Z",
        },
      ],
    });
  });

  it("returns 500 with apiError envelope when collectAllHealth throws", async () => {
    collectAllHealthMock.mockRejectedValueOnce(
      new Error("Unsupported state or unable to authenticate data"),
    );

    const response = await GET(new Request("https://example.com/api/health"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("Failed to fetch health data");
    expect(body.message).not.toContain("authenticate data");
    expect(body.error).toBe(body.message);
  });

  it("returns 500 with apiError envelope when getMetricHistory throws", async () => {
    getMetricHistoryMock.mockRejectedValueOnce(
      new Error("database connection lost"),
    );

    const response = await GET(
      new Request("https://example.com/api/health?historyFor=srv_1"),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.code).toBe("INTERNAL_ERROR");
    expect(body.message).toBe("Failed to fetch health data");
    expect(body.message).not.toContain("database connection lost");
    expect(body.error).toBe(body.message);
  });
});

describe("/api/health single-flight", () => {
  const overview = { total: 1, online: 1, warning: 0, critical: 0, offline: 0, servers: [] };

  function sessionFor(userId: string) {
    return { userId, username: userId, roles: ["viewer"] };
  }

  beforeEach(() => {
    vi.resetAllMocks();
    process.env.HEALTH_OVERVIEW_CACHE_TTL_MS = "10000";
    hasBearerAuthorizationMock.mockImplementation(
      (request: Request) => request.headers.has("authorization"),
    );
    collectAllHealthMock.mockResolvedValue(overview);
  });

  it("collapses concurrent polls onto a single fleet sweep", async () => {
    const session = sessionFor("user_concurrent");
    requireApiPermissionMock.mockResolvedValue({ session });
    authenticateBearerForPermissionsMock.mockResolvedValue({
      session,
      tokenId: "tok_1",
      scopes: ["health:read"],
    });

    const [first, second] = await Promise.all([
      GET(new Request("https://example.com/api/health")),
      GET(new Request("https://example.com/api/health")),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(collectAllHealthMock).toHaveBeenCalledOnce();
  });

  it("reuses a fresh sweep for subsequent polls inside the TTL", async () => {
    const session = sessionFor("user_reuse");
    requireApiPermissionMock.mockResolvedValue({ session });

    await GET(new Request("https://example.com/api/health"));
    await GET(new Request("https://example.com/api/health"));

    expect(collectAllHealthMock).toHaveBeenCalledOnce();
  });

  it("never serves one user's overview to another user", async () => {
    requireApiPermissionMock
      .mockResolvedValueOnce({ session: sessionFor("user_a") })
      .mockResolvedValueOnce({ session: sessionFor("user_b") });

    await GET(new Request("https://example.com/api/health"));
    await GET(new Request("https://example.com/api/health"));

    expect(collectAllHealthMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed sweep", async () => {
    const session = sessionFor("user_failure");
    requireApiPermissionMock.mockResolvedValue({ session });
    collectAllHealthMock.mockRejectedValueOnce(new Error("ssh pool exhausted"));

    const failed = await GET(new Request("https://example.com/api/health"));
    const retried = await GET(new Request("https://example.com/api/health"));

    expect(failed.status).toBe(500);
    expect(retried.status).toBe(200);
    expect(collectAllHealthMock).toHaveBeenCalledTimes(2);
  });
});
