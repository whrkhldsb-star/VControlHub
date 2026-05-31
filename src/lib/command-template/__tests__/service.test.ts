import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    commandTemplate: {
      count: vi.fn(),
      create: vi.fn(),
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
});
