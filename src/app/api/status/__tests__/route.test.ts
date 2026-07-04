/**
 * TR-018: API 回归测试基线 - status route
 *
 * /api/status 公开状态页基础。覆盖：返回值结构 + dynamic 标志。
 */
import { describe, expect, it, vi } from "vitest";

const getPublicStatusMock = vi.fn();
const getPublicStatusSummaryMock = vi.fn();
const getApiSessionMock = vi.fn();
vi.mock("@/lib/status/service", () => ({
  getPublicStatus: getPublicStatusMock,
  getPublicStatusSummary: getPublicStatusSummaryMock,
}));
vi.mock("@/lib/auth/api-session", () => ({
  getApiSession: getApiSessionMock,
}));

const route = await import("../route");

describe("GET /api/status", () => {
  it("未登录时返 summary（仅 overall + generatedAt + service，隐藏 checks 详情）", async () => {
    getApiSessionMock.mockResolvedValueOnce(null);
    const summaryPayload = {
      generatedAt: "2026-06-12T00:00:00.000Z",
      service: "vcontrolhub",
      summary: { overall: "warning" },
    };
    getPublicStatusSummaryMock.mockResolvedValueOnce(summaryPayload);
    const res = await route.GET(new Request("http://localhost/api/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(summaryPayload);
    expect(body).not.toHaveProperty("checks");
  });

  it("已登录时返完整 status（含 checks）", async () => {
    getApiSessionMock.mockResolvedValueOnce({ userId: "u1" });
    const fullPayload = {
      generatedAt: "2026-06-12T00:00:00.000Z",
      service: "vcontrolhub",
      summary: { overall: "warning", total: 3, healthy: 2, warning: 1, critical: 0 },
      checks: [
        { id: "database", label: "数据库", status: "healthy", message: "可用" },
        { id: "servers", label: "VPS 管理", status: "healthy", message: "已启用 5 台 VPS" },
        { id: "storage", label: "云盘服务", status: "warning", message: "已配置 6 个存储节点" },
      ],
    };
    getPublicStatusMock.mockResolvedValueOnce(fullPayload);
    const res = await route.GET(new Request("http://localhost/api/status"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual(fullPayload);
    expect(body.checks).toHaveLength(3);
  });

  it("propagates service errors as 500", async () => {
    getApiSessionMock.mockResolvedValueOnce(null);
    getPublicStatusSummaryMock.mockRejectedValueOnce(new Error("db down"));
    await expect(route.GET(new Request("http://localhost/api/status"))).rejects.toThrow("db down");
  });
});
