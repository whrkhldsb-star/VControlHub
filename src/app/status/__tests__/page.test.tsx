/**
 * /status page exposure:
 * - anonymous: overall summary + public uptime heatmap (display names only)
 * - authenticated: full checks + uptime
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const getCurrentSessionMock = vi.fn();
const getPublicStatusMock = vi.fn();
const getPublicStatusSummaryMock = vi.fn();
const getAllUptimeDataInternalMock = vi.fn();

vi.mock("@/lib/auth/server-session", () => ({
  getCurrentSession: getCurrentSessionMock,
}));
vi.mock("@/lib/status/service", () => ({
  getPublicStatus: getPublicStatusMock,
  getPublicStatusSummary: getPublicStatusSummaryMock,
}));
vi.mock("@/lib/uptime/internal", () => ({
  getAllUptimeDataInternal: getAllUptimeDataInternalMock,
}));
vi.mock("@/lib/i18n/translations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/i18n/translations")>(
    "@/lib/i18n/translations",
  );
  return {
    ...actual,
    getServerLocale: async () => "en" as const,
  };
});
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

describe("/status page exposure", () => {
  beforeEach(() => {
    getCurrentSessionMock.mockReset();
    getPublicStatusMock.mockReset();
    getPublicStatusSummaryMock.mockReset();
    getAllUptimeDataInternalMock.mockReset();
  });

  it("anonymous: summary + uptime heatmap, no full component checks", async () => {
    getCurrentSessionMock.mockResolvedValueOnce(null);
    getPublicStatusSummaryMock.mockResolvedValueOnce({
      generatedAt: "2026-07-17T00:00:00.000Z",
      service: "vcontrolhub",
      summary: { overall: "healthy" },
    });
    getAllUptimeDataInternalMock.mockResolvedValueOnce({
      servers: [{ id: "s1", name: "edge-1", data: [{ date: "2026-07-16", uptimePercent: 100 }] }],
    });

    const { default: StatusPage } = await import("../page");
    const tree = await StatusPage();
    const html = JSON.stringify(tree);

    expect(getPublicStatusSummaryMock).toHaveBeenCalledTimes(1);
    expect(getPublicStatusMock).not.toHaveBeenCalled();
    expect(getAllUptimeDataInternalMock).toHaveBeenCalledTimes(1);
    expect(html).not.toMatch(/Database|VPS management|Cloud drive service/);
    expect(html).toMatch(/Healthy|healthy|Overall|Service Status/i);
    expect(html).toMatch(/edge-1/);
    expect(html).toMatch(/Historical uptime|uptime/i);
  });

  it("authenticated: full checks + uptime path", async () => {
    getCurrentSessionMock.mockResolvedValueOnce({ userId: "u1", roles: ["admin"] });
    getPublicStatusMock.mockResolvedValueOnce({
      generatedAt: "2026-07-17T00:00:00.000Z",
      service: "vcontrolhub",
      summary: { overall: "warning", total: 2, healthy: 1, warning: 1, critical: 0 },
      checks: [
        { id: "database", label: "Database", status: "healthy", message: "Available" },
        {
          id: "servers",
          label: "VPS management",
          status: "warning",
          message: "1 VPS instances enabled; no real-time SSH/network probing",
        },
      ],
    });
    getAllUptimeDataInternalMock.mockResolvedValueOnce({
      servers: [{ id: "s1", name: "edge-1", data: [{ date: "2026-07-16", uptimePercent: 100 }] }],
    });

    const { default: StatusPage } = await import("../page");
    const tree = await StatusPage();
    const html = JSON.stringify(tree);

    expect(getPublicStatusMock).toHaveBeenCalledTimes(1);
    expect(getPublicStatusSummaryMock).not.toHaveBeenCalled();
    expect(getAllUptimeDataInternalMock).toHaveBeenCalledTimes(1);
    expect(html).toMatch(/Database/);
    expect(html).toMatch(/edge-1/);
  });
});
