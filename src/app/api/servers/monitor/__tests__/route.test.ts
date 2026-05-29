import { describe, expect, it, vi } from "vitest";

const { requireApiPermissionMock, collectServerMetricsMock } = vi.hoisted(
  () => ({
    requireApiPermissionMock: vi.fn(),
    collectServerMetricsMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/server/monitor", () => ({
  collectServerMetrics: collectServerMetricsMock,
}));

import { GET } from "../route";

describe("/api/servers/monitor", () => {
  it("returns 403 when the session lacks server read permission", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce(
      Response.json({ error: "权限不足" }, { status: 403 }),
    );

    const response = await GET(
      new Request("https://example.com/api/servers/monitor?serverId=srv_1"),
    );

    expect(response.status).toBe(403);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("server:read");
    expect(collectServerMetricsMock).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "权限不足" });
  });

  it("collects metrics when the session has server read permission", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    collectServerMetricsMock.mockResolvedValueOnce({
      ok: true,
      cpu: { usagePercent: 12 },
    });

    const response = await GET(
      new Request("https://example.com/api/servers/monitor?serverId=srv_1"),
    );

    expect(response.status).toBe(200);
    expect(requireApiPermissionMock).toHaveBeenCalledWith("server:read");
    expect(collectServerMetricsMock).toHaveBeenCalledWith("srv_1");
    await expect(response.json()).resolves.toMatchObject({ ok: true });
  });
});
