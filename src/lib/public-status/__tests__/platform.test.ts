import { describe, expect, it, vi } from "vitest";

const { groups, servers, probe } = vi.hoisted(() => ({ groups: vi.fn(), servers: vi.fn(), probe: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { $queryRaw: vi.fn(), server: { count: servers }, storageNode: { groupBy: groups } } }));
vi.mock("@/lib/storage/health", () => ({ scheduleStorageNodeHealthProbe: probe }));

import { getPublicStatus, getPublicStatusSummary } from "../platform";

describe("anonymous platform status", () => {
  it.each([["UNKNOWN", 0, "warning"], ["HEALTHY", 1, "healthy"], ["UNHEALTHY", 1, "warning"]])("agrees with the details for %s storage", async (healthStatus, checked, expected) => {
    servers.mockResolvedValue(1);
    groups.mockResolvedValue([{ healthStatus, _count: { _all: 1, lastHealthCheckAt: checked } }]);
    probe.mockClear();
    const brief = await getPublicStatusSummary();
    expect(brief.summary).toEqual({ overall: expected });
    expect(brief).not.toHaveProperty("checks");
    expect(probe).not.toHaveBeenCalled();
    expect((await getPublicStatus()).summary.overall).toBe(brief.summary.overall);
    expect(probe).toHaveBeenCalledOnce();
  });
});
