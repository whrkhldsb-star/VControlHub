import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { listAuditLogs } = await import("./service");

describe("listAuditLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
    mockPrisma.auditLog.count.mockResolvedValue(0);
  });

  it("uses PostgreSQL-compatible case-insensitive search filters without querying enum fields for arbitrary terms", async () => {
    await listAuditLogs({ search: "login" });

    const where = mockPrisma.auditLog.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({
      OR: [
        { action: { contains: "login", mode: "insensitive" } },
        {
          actor: {
            is: {
              OR: [
                { username: { contains: "login", mode: "insensitive" } },
                { displayName: { contains: "login", mode: "insensitive" } },
              ],
            },
          },
        },
      ],
    });
    expect(mockPrisma.auditLog.count).toHaveBeenCalledWith({ where });
  });

  it("adds an exact actorType filter only when the search term is a valid ActorType enum value", async () => {
    await listAuditLogs({ search: "system" });

    const where = mockPrisma.auditLog.findMany.mock.calls[0]?.[0]?.where;
    expect(where.OR).toContainEqual({ actorType: "SYSTEM" });
  });
});
