import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireApiPermission: vi.fn(), getShareAccessReport: vi.fn(), auditUserAction: vi.fn() }));
vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/share-link/service", () => ({ getShareAccessReport: mocks.getShareAccessReport }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../route");
const session = { userId: "admin-1", roles: ["admin"], currentTeamId: "team-1" };
const report = { range: { days: 30, action: "all" }, totals: { total: 1 }, byShare: [], logs: [{ accessedAt: "2026-07-14T00:00:00.000Z", action: "download", ip: "1.2.3.4", userAgent: "Browser, v1", share: { id: "s1", name: "Report", path: "docs/a.pdf", permissionLevel: "download" } }] };

describe("share access report route", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.requireApiPermission.mockResolvedValue({ session }); mocks.getShareAccessReport.mockResolvedValue(report); mocks.auditUserAction.mockResolvedValue(undefined); });

  it("requires share:manage and returns a scoped JSON report", async () => {
    const response = await route.GET(new Request("http://local/api/shares/access-report?days=30&action=all"));
    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("share:manage");
    expect(mocks.getShareAccessReport).toHaveBeenCalledWith({ session, days: 30, action: "all", take: undefined });
  });

  it("exports escaped CSV and audits the export", async () => {
    const response = await route.GET(new Request("http://local/api/shares/access-report?format=csv"));
    const body = await response.text();
    expect(response.headers.get("content-type")).toContain("text/csv");
    expect(body).toContain('"Browser, v1"');
    expect(mocks.auditUserAction).toHaveBeenCalledWith("admin-1", "share.access-report.export", expect.objectContaining({ rows: 1 }));
  });
});
