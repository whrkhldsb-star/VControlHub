import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $queryRaw: vi.fn(),
    server: { count: vi.fn() },
    storageNode: { findMany: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { getPublicStatus } = await import("./service");

describe("public status service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns public-safe status without host or connection details", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(2);
    mockPrisma.storageNode.findMany.mockResolvedValue([
      { healthStatus: "HEALTHY", lastHealthCheckAt: new Date("2026-06-09T00:00:00Z") },
    ]);

    const result = await getPublicStatus();
    const text = JSON.stringify(result);

    expect(result.summary.total).toBeGreaterThan(0);
    expect(text).not.toMatch(/host|port|basePath|DATABASE_URL|postgres|token|private/i);
  });

  it("does not describe configured inventory as proven online", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(2);
    mockPrisma.storageNode.findMany.mockResolvedValue([
      { healthStatus: "UNKNOWN", lastHealthCheckAt: null },
    ]);

    const result = await getPublicStatus();

    expect(result.checks.find((check) => check.id === "servers")?.message).toContain("未做实时 SSH/网络探测");
    expect(result.checks.find((check) => check.id === "storage")?.message).toContain("1 个待探测");
    expect(JSON.stringify(result.checks)).not.toContain("服务在线");
  });

  it("summarizes persisted storage probe results and downgrades unhealthy storage to warning", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(1);
    mockPrisma.storageNode.findMany.mockResolvedValue([
      { healthStatus: "HEALTHY", lastHealthCheckAt: new Date("2026-06-09T00:00:00Z") },
      { healthStatus: "UNHEALTHY", lastHealthCheckAt: new Date("2026-06-09T00:01:00Z") },
      { healthStatus: "UNKNOWN", lastHealthCheckAt: null },
    ]);

    const result = await getPublicStatus();
    const storage = result.checks.find((check) => check.id === "storage");

    expect(storage).toMatchObject({ status: "warning" });
    expect(storage?.message).toContain("已配置 3 个存储节点");
    expect(storage?.message).toContain("1 个最近探测健康");
    expect(storage?.message).toContain("1 个异常");
    expect(storage?.message).toContain("1 个待探测");
    expect(storage?.message).toContain("不会在公开状态页展示");
    expect(result.summary.overall).toBe("warning");
  });
});
