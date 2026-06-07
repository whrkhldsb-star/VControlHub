import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({ mockPrisma: { $queryRaw: vi.fn(), server: { count: vi.fn() }, storageNode: { count: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
const { getPublicStatus } = await import("./service");
describe("public status service", () => {
  beforeEach(() => vi.clearAllMocks());
  it("returns public-safe status without host or connection details", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(2);
    mockPrisma.storageNode.count.mockResolvedValue(1);
    const result = await getPublicStatus();
    const text = JSON.stringify(result);
    expect(result.summary.total).toBeGreaterThan(0);
    expect(text).not.toMatch(/host|port|DATABASE_URL|postgres|token|private/i);
  });

  it("does not describe configured inventory as proven online", async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ ok: 1 }]);
    mockPrisma.server.count.mockResolvedValue(2);
    mockPrisma.storageNode.count.mockResolvedValue(1);

    const result = await getPublicStatus();

    expect(result.checks.find((check) => check.id === "servers")?.message).toContain("未做实时 SSH/网络探测");
    expect(result.checks.find((check) => check.id === "storage")?.message).toContain("未做实时 SFTP/直连探测");
    expect(JSON.stringify(result.checks)).not.toContain("服务在线");
  });
});
