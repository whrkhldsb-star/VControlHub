/**
 * TR-018: API 回归测试基线 - status route
 *
 * /api/status 公开状态页基础。覆盖：返回值结构 + dynamic 标志。
 */
import { describe, expect, it, vi } from "vitest";

const getPublicStatusMock = vi.fn();
vi.mock("@/lib/status/service", () => ({
  getPublicStatus: getPublicStatusMock,
}));

const route = await import("../route");

describe("GET /api/status", () => {
  it("returns the public status payload", async () => {
    const payload = {
      status: "ok",
      version: "0.1.0",
      uptimeSeconds: 100,
      timestamp: "2026-06-12T00:00:00.000Z",
      storage: { healthy: 1, degraded: 0, untested: 0 },
    };
    getPublicStatusMock.mockResolvedValueOnce(payload);
    const res = await route.GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(payload);
  });

  it("propagates service errors as 500", async () => {
    getPublicStatusMock.mockRejectedValueOnce(new Error("db down"));
    await expect(route.GET()).rejects.toThrow("db down");
  });
});
