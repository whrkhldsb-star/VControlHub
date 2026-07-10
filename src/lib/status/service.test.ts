import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockPrisma, scheduleStorageNodeHealthProbeMock } = vi.hoisted(() => ({
	mockPrisma: {
		$queryRaw: vi.fn(),
		server: { count: vi.fn() },
		storageNode: { findMany: vi.fn() },
	},
	// TR-049: stub the lazy probe so the status tests don't actually fan
	// out background SSH round-trips during unit runs. We assert on the
	// call count in a dedicated test below.
	scheduleStorageNodeHealthProbeMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/storage/health", () => ({
	scheduleStorageNodeHealthProbe: scheduleStorageNodeHealthProbeMock,
}));

const { getPublicStatus, getPublicStatusSummary } = await import("./service");

describe("public status service", () => {
	beforeEach(() => vi.clearAllMocks());

	// TR-049: the status service must schedule a lazy storage probe on
	// every call (it's the cheap no-op-or-fan-out path that makes the
	// "6 个待探测" message eventually disappear in the UI). The actual
	// background work is exercised in health-scheduler.test.ts.
	it("schedules a lazy storage probe every time /api/status is hit", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(0);
    mockPrisma.storageNode.findMany.mockResolvedValue([]);

    await getPublicStatus();

    expect(scheduleStorageNodeHealthProbeMock).toHaveBeenCalledTimes(1);
  });

	it("returns public-safe status without host or connection details", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(2);
    mockPrisma.storageNode.findMany.mockResolvedValue([
      { healthStatus: "HEALTHY", lastHealthCheckAt: new Date("2026-06-09T00:00:00Z") },
    ]);

    const result = await getPublicStatus();
    const text = JSON.stringify(result);

    expect(result.summary.total).toBeGreaterThan(0);
    expect(text).not.toMatch(/DATABASE_URL|postgres:\/\/|token|private|password|secret|connection\s*string/i);
  });

  it("does not describe configured inventory as proven online", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(2);
    mockPrisma.storageNode.findMany.mockResolvedValue([
      { healthStatus: "UNKNOWN", lastHealthCheckAt: null },
    ]);

    const result = await getPublicStatus();

    expect(result.checks.find((check) => check.id === "servers")?.message).toContain("no real-time SSH/network probing");
    expect(result.checks.find((check) => check.id === "storage")?.message).toContain("1 pending probe");
    expect(JSON.stringify(result.checks)).not.toContain("service online");
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
    expect(storage?.message).toContain("3 storage nodes configured");
    expect(storage?.message).toContain("1 recently probed healthy");
    expect(storage?.message).toContain("1 unhealthy");
    expect(storage?.message).toContain("1 pending probe");
    expect(storage?.message).toContain("not be shown on the public status page");
    expect(result.summary.overall).toBe("warning");
  });
});

describe("public status summary (TR-053)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("公开端点只暴露 overall + generatedAt + service，隐藏 checks 详情", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(5);
    mockPrisma.storageNode.findMany.mockResolvedValue([
      { healthStatus: "HEALTHY", lastHealthCheckAt: new Date("2026-06-09T00:00:00Z") },
      { healthStatus: "UNKNOWN", lastHealthCheckAt: null },
    ]);

    const summary = await getPublicStatusSummary();
    const text = JSON.stringify(summary);

    expect(summary.summary.overall).toMatch(/healthy|warning|critical/);
    expect(summary).toHaveProperty("generatedAt");
    expect(summary).toHaveProperty("service");
    // 不应泄露节点数、探测状态、节点详情
    expect(summary).not.toHaveProperty("checks");
    expect(text).not.toMatch(/storage node|probe healthy|pending probe|SSH\/network|VPS instances/i);
  });
});
