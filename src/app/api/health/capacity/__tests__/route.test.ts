import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  getCapacityForecastMock,
  assertServerTeamAccessMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  getCapacityForecastMock: vi.fn(),
  assertServerTeamAccessMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/health/capacity-service", () => ({
  getCapacityForecast: getCapacityForecastMock,
}));
vi.mock("@/lib/server/team-access", () => ({
  assertServerTeamAccess: assertServerTeamAccessMock,
}));

import { GET } from "../route";

const session = {
  userId: "user_1",
  username: "viewer",
  roles: ["viewer"] as const,
  currentTeamId: "team_1",
  mustChangePassword: false,
};

describe("/api/health/capacity", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireApiPermissionMock.mockResolvedValue({ session });
    assertServerTeamAccessMock.mockResolvedValue({ ok: true, server: { id: "s1" } });
    getCapacityForecastMock.mockResolvedValue({
      summary: {
        serverCount: 1,
        forecastable: 1,
        insufficientData: 0,
        byRisk: { ok: 1, watch: 0, warning: 0, critical: 0, insufficient_data: 0 },
        worstRisk: "ok",
        horizonDays: 14,
        windowHours: 168,
        generatedAt: "2026-07-16T00:00:00.000Z",
      },
      servers: [],
    });
  });

  it("returns 401 when unauthenticated", async () => {
    requireApiPermissionMock.mockResolvedValueOnce(
      NextResponse.json({ error: "未登录" }, { status: 401 }),
    );
    const res = await GET(new Request("http://localhost/api/health/capacity"));
    expect(res.status).toBe(401);
  });

  it("returns forecast payload for authorized session", async () => {
    const res = await GET(new Request("http://localhost/api/health/capacity"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary.serverCount).toBe(1);
    expect(getCapacityForecastMock).toHaveBeenCalledWith(
      expect.objectContaining({ session }),
    );
  });

  it("checks team access when serverId is provided", async () => {
    const res = await GET(
      new Request("http://localhost/api/health/capacity?serverId=s1&horizonDays=7"),
    );
    expect(res.status).toBe(200);
    expect(assertServerTeamAccessMock).toHaveBeenCalledWith(session, "s1");
    expect(getCapacityForecastMock).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "s1", horizonDays: 7 }),
    );
  });

  it("returns 404 when server is outside team scope", async () => {
    assertServerTeamAccessMock.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: "Server not found" }, { status: 404 }),
    });
    const res = await GET(
      new Request("http://localhost/api/health/capacity?serverId=other"),
    );
    expect(res.status).toBe(404);
    expect(getCapacityForecastMock).not.toHaveBeenCalled();
  });
});
