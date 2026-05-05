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
});
