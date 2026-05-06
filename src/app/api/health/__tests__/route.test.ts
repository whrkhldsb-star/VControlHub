import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireSessionMock, sessionHasPermissionMock, verifyApiTokenMock, collectAllHealthMock, getMetricHistoryMock, snapshotMetricsMock } = vi.hoisted(() => ({
  requireSessionMock: vi.fn(),
  sessionHasPermissionMock: vi.fn(),
  verifyApiTokenMock: vi.fn(),
  collectAllHealthMock: vi.fn(),
  getMetricHistoryMock: vi.fn(),
  snapshotMetricsMock: vi.fn(),
}));

vi.mock("@/lib/auth/require-session", () => ({ requireSession: requireSessionMock }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: sessionHasPermissionMock }));
vi.mock("@/lib/api-token/service", () => ({ verifyApiToken: verifyApiTokenMock }));
vi.mock("@/lib/health/service", () => ({
  collectAllHealth: collectAllHealthMock,
  getMetricHistory: getMetricHistoryMock,
  snapshotMetrics: snapshotMetricsMock,
}));

import { GET } from "../route";

describe("/api/health", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    requireSessionMock.mockResolvedValue({ userId: "user_1", username: "viewer", roles: ["viewer"] });
    verifyApiTokenMock.mockResolvedValue(null);
    sessionHasPermissionMock.mockReturnValue(true);
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
      { cpuUsage: 10, memUsage: 20, diskUsage: 30, isOnline: true, createdAt: new Date("2026-05-06T00:00:00.000Z") },
    ]);
    snapshotMetricsMock.mockResolvedValue(undefined);
  });

  it("returns 401 when the session is missing", async () => {
    requireSessionMock.mockRejectedValueOnce(new Error("unauthorized"));

    const response = await GET(new Request("https://example.com/api/health"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ error: "未认证" });
    expect(collectAllHealthMock).not.toHaveBeenCalled();
  });

  it("requires health read permission before exposing node health details", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);

    const response = await GET(new Request("https://example.com/api/health"));

    expect(response.status).toBe(403);
    expect(sessionHasPermissionMock).toHaveBeenCalledWith(
      { userId: "user_1", username: "viewer", roles: ["viewer"] },
      "health:read",
    );
    expect(collectAllHealthMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "缺少权限" });
  });

  it("allows health read API tokens to fetch node health for external monitors", async () => {
    verifyApiTokenMock.mockResolvedValueOnce({ userId: "user_1", tokenId: "tok_1", scopes: ["health:read"] });

    const response = await GET(new Request("https://example.com/api/health", { headers: { authorization: "Bearer whr_fake_health" } }));

    expect(response.status).toBe(200);
    expect(verifyApiTokenMock).toHaveBeenCalledWith("whr_fake_health");
    expect(collectAllHealthMock).toHaveBeenCalledOnce();
  });

  it("rejects API tokens without health read scope", async () => {
    verifyApiTokenMock.mockResolvedValueOnce({ userId: "user_1", tokenId: "tok_1", scopes: ["status:read"] });

    const response = await GET(new Request("https://example.com/api/health", { headers: { authorization: "Bearer whr_fake_status" } }));

    expect(response.status).toBe(403);
    expect(collectAllHealthMock).not.toHaveBeenCalled();
  });

  it("treats invalid Bearer tokens as unauthenticated and does not fall back to session", async () => {
    verifyApiTokenMock.mockResolvedValueOnce(null);

    const response = await GET(new Request("https://example.com/api/health", { headers: { authorization: "Bearer invalid_token" } }));

    expect(response.status).toBe(401);
    expect(requireSessionMock).not.toHaveBeenCalled();
    expect(collectAllHealthMock).not.toHaveBeenCalled();
  });


  it("collects health and snapshots metrics when the session has health read permission", async () => {
    const response = await GET(new Request("https://example.com/api/health"));

    expect(response.status).toBe(200);
    expect(collectAllHealthMock).toHaveBeenCalledOnce();
    expect(snapshotMetricsMock).toHaveBeenCalledWith("srv_1", 12.3, 45.6, 50, true);
    await expect(response.json()).resolves.toMatchObject({ total: 1, servers: [{ serverId: "srv_1" }] });
  });

  it("applies health read permission to metric history", async () => {
    const response = await GET(new Request("https://example.com/api/health?historyFor=srv_1&hours=6"));

    expect(response.status).toBe(200);
    expect(getMetricHistoryMock).toHaveBeenCalledWith("srv_1", 6);
    await expect(response.json()).resolves.toMatchObject({
      history: [{ cpu: 10, mem: 20, disk: 30, online: true, t: "2026-05-06T00:00:00.000Z" }],
    });
  });

  it("allows a valid health read Bearer token even when the ambient session lacks health permission", async () => {
    sessionHasPermissionMock.mockReturnValueOnce(false);
    verifyApiTokenMock.mockResolvedValueOnce({ userId: "user_1", tokenId: "tok_1", scopes: ["health:read"] });

    const response = await GET(new Request("https://example.com/api/health", { headers: { authorization: "Bearer whr_fake_health" } }));

    expect(response.status).toBe(200);
    expect(verifyApiTokenMock).toHaveBeenCalledWith("whr_fake_health");
    expect(collectAllHealthMock).toHaveBeenCalledOnce();
  });
});
