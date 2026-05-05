import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    server: { count: vi.fn() },
    storageNode: { count: vi.fn() },
    setting: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { collectSystemHealthChecks, summarizeSystemHealth } = await import("../service");

describe("system health service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(2);
    mockPrisma.storageNode.count.mockResolvedValue(1);
    mockPrisma.setting.findMany.mockResolvedValue([]);
  });

  it("collects portable deployment and runtime checks without exposing secrets", async () => {
    const result = await collectSystemHealthChecks({ projectRoot: process.cwd() });

    expect(result.checks.length).toBeGreaterThan(3);
    expect(result.checks.some((check) => check.id === "database")).toBe(true);
    expect(result.checks.some((check) => check.id === "runtime-directories")).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/postgres:\/\/[^\s]+:[^\s]+@/i);
  });

  it("summarizes warning and critical checks", () => {
    expect(summarizeSystemHealth([
      { id: "ok", label: "OK", status: "healthy", message: "ok" },
      { id: "warn", label: "Warn", status: "warning", message: "warn" },
      { id: "bad", label: "Bad", status: "critical", message: "bad" },
    ])).toMatchObject({ total: 3, healthy: 1, warning: 1, critical: 1, overall: "critical" });
  });
});
