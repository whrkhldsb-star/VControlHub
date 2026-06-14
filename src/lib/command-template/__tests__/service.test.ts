import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    commandTemplate: {
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const service = await import("../service");

describe("command template service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.commandTemplate.count.mockResolvedValue(1);
  });

  it("bounds command template list hydration while preserving built-in ordering", async () => {
    mockPrisma.commandTemplate.findMany.mockResolvedValue([]);

    await service.listTemplates();

    expect(mockPrisma.commandTemplate.findMany).toHaveBeenCalledWith({
      orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
      take: 200,
      include: { creator: { select: { username: true, displayName: true } } },
    });
  });

  it("seeds built-in templates via a single createMany call (TR-040)", async () => {
    mockPrisma.commandTemplate.count.mockResolvedValueOnce(0);
    mockPrisma.commandTemplate.createMany.mockResolvedValueOnce({ count: 12 });

    await service.seedBuiltinTemplates();

    expect(mockPrisma.commandTemplate.count).toHaveBeenCalledWith({
      where: { isBuiltin: true },
    });
    expect(mockPrisma.commandTemplate.createMany).toHaveBeenCalledTimes(1);
    // Ensure none of the 12 built-ins are still routed through `create`,
    // which would re-introduce the O(N) sequential round-trip pattern.
    expect(mockPrisma.commandTemplate.create).not.toHaveBeenCalled();
    const args = mockPrisma.commandTemplate.createMany.mock.calls[0]?.[0] as {
      data: Array<{ isBuiltin: boolean; name: string }>;
    } | undefined;
    expect(args).toBeDefined();
    expect(Array.isArray(args?.data)).toBe(true);
    expect(args?.data.length ?? 0).toBeGreaterThanOrEqual(12);
    expect(args?.data.every((row) => row.isBuiltin === true) ?? false).toBe(true);
  });

  it("skips seeding when built-in templates already exist", async () => {
    mockPrisma.commandTemplate.count.mockResolvedValueOnce(12);

    await service.seedBuiltinTemplates();

    expect(mockPrisma.commandTemplate.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.commandTemplate.create).not.toHaveBeenCalled();
  });
});
