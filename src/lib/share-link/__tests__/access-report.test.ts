import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  logFindMany: vi.fn(), logGroupBy: vi.fn(), shareFindMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ prisma: {
  shareAccessLog: { findMany: mocks.logFindMany, groupBy: mocks.logGroupBy },
  shareLink: { findMany: mocks.shareFindMany },
} }));

import { getShareAccessReport } from "../service";

describe("share access aggregate report", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.logFindMany
      .mockResolvedValueOnce([{ id: "log-1", action: "download", ip: "203.0.113.1", userAgent: "Browser", accessedAt: new Date("2026-07-14T00:00:00Z"), shareLink: { id: "share-1", name: "Report", path: "docs/report.pdf", permissionLevel: "download", revokedAt: null } }])
      .mockResolvedValueOnce([{ ip: "203.0.113.1" }]);
    mocks.logGroupBy.mockResolvedValue([
      { shareLinkId: "share-1", action: "view", _count: { _all: 2 } },
      { shareLinkId: "share-1", action: "download", _count: { _all: 1 } },
    ]);
    mocks.shareFindMany.mockResolvedValue([{ id: "share-1", name: "Report", path: "docs/report.pdf", permissionLevel: "download", revokedAt: null }]);
  });

  it("aggregates totals and forces share-link team scope on every query", async () => {
    const report = await getShareAccessReport({ session: { userId: "admin", roles: ["admin"], currentTeamId: "team-1" }, days: 30 });
    expect(report.totals).toEqual({ total: 3, view: 2, download: 1, passwordAttempt: 0, uniqueIps: 1 });
    expect(report.byShare[0]).toMatchObject({ shareId: "share-1", total: 3, view: 2, download: 1 });
    expect(report.logs[0]?.accessedAt).toBe("2026-07-14T00:00:00.000Z");
    expect(mocks.logGroupBy).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ shareLink: {} }) }));
  });

  it("applies action filters and bounds report inputs", async () => {
    await getShareAccessReport({ session: { userId: "viewer", roles: ["viewer"], currentTeamId: "team-1" }, days: 999, action: "download", take: 999 });
    expect(mocks.logFindMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ take: 500, where: expect.objectContaining({ action: "download", shareLink: { OR: [{ teamId: "team-1" }, { teamId: null }] } }) }));
  });
});
