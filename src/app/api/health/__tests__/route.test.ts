import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  requireApiPermissionMock,
  verifyBearerTokenMock,
  collectAllHealthMock,
  getMetricHistoryMock,
  snapshotMetricsMock,
} = vi.hoisted(() => ({
  requireApiPermissionMock: vi.fn(),
  verifyBearerTokenMock: vi.fn(),
  collectAllHealthMock: vi.fn(),
  getMetricHistoryMock: vi.fn(),
  snapshotMetricsMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));
vi.mock("@/lib/auth/bearer-token", () => ({
  verifyBearerToken: verifyBearerTokenMock,
}));
vi.mock("@/lib/health/service", () => ({
  collectAllHealth: collectAllHealthMock,
  getMetricHistory: getMetricHistoryMock,
  snapshotMetrics: snapshotMetricsMock,
}));

import { GET } from "../route";

const session = { userId: "user_1", username: "viewer", roles: ["viewer"] };

describe("/api/health", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    requireApiPermissionMock.mockResolvedValue({ session });
    verifyBearerTokenMock.mockResolvedValue(null);
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
    snapshotMetricsMock.mockResolvedValue(undefined);
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

  it("allows health read API tokens to fetch node health for external monitors", async () => {
    verifyBearerTokenMock.mockResolvedValueOnce({
      userId: "user_1",
      tokenId: "tok_1",
      scopes: ["health:read"],
    });

    const response = await GET(
      new Request("https://example.com/api/health", {
        headers: { authorization: "Bearer whr_fake_health" },
      }),
    );

    expect(response.status).toBe(200);
    expect(verifyBearerTokenMock).toHaveBeenCalledWith(
      expect.any(Request),
      "health:read",
    );
    expect(requireApiPermissionMock).not.toHaveBeenCalled();
    expect(collectAllHealthMock).toHaveBeenCalledOnce();
  });

  it("rejects invalid or insufficient Bearer tokens without falling back to session", async () => {
    verifyBearerTokenMock.mockResolvedValueOnce(null);

    const response = await GET(
      new Request("https://example.com/api/health", {
        headers: { authorization: "Bearer invalid_token" },
      }),
    );

    expect(response.status).toBe(401);
    expect(requireApiPermissionMock).not.toHaveBeenCalled();
    expect(collectAllHealthMock).not.toHaveBeenCalled();
  });

  it("collects health and snapshots metrics when the session has health read permission", async () => {
    const response = await GET(new Request("https://example.com/api/health"));

    expect(response.status).toBe(200);
    expect(collectAllHealthMock).toHaveBeenCalledOnce();
    expect(snapshotMetricsMock).toHaveBeenCalledWith(
      "srv_1",
      12.3,
      45.6,
      50,
      true,
    );
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

  it("returns 500 with error message when collectAllHealth throws", async () => {
    collectAllHealthMock.mockRejectedValueOnce(
      new Error("Unsupported state or unable to authenticate data"),
    );

    const response = await GET(new Request("https://example.com/api/health"));

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("健康数据采集失败");
    expect(body.error).toContain(
      "Unsupported state or unable to authenticate data",
    );
  });

  it("returns 500 with error message when getMetricHistory throws", async () => {
    getMetricHistoryMock.mockRejectedValueOnce(
      new Error("database connection lost"),
    );

    const response = await GET(
      new Request("https://example.com/api/health?historyFor=srv_1"),
    );

    expect(response.status).toBe(500);
    const body = await response.json();
    expect(body.error).toContain("健康历史获取失败");
    expect(body.error).toContain("database connection lost");
  });
});
