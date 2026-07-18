import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    auditLog: {
      findMany: vi.fn(),
      count: vi.fn(),
      groupBy: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: vi.fn((session: { roles?: string[] }, perm: string) => {
    if (perm === "team:manage") {
      return Array.isArray(session.roles) && session.roles.includes("admin");
    }
    return false;
  }),
}));

const { listAuditLogs, getAuditStats, exportAuditLogs } = await import("./service");

import type { RoleKey } from "@/lib/auth/rbac";

const teamUser = { userId: "u1", roles: ["operator"] as RoleKey[], currentTeamId: "team_a" };
const adminUser = { userId: "admin", roles: ["admin"] as RoleKey[], currentTeamId: "team_a" };

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

  it("AND-composes teamWhere with search for non-admin sessions", async () => {
    await listAuditLogs({ search: "login", session: teamUser });

    const where = mockPrisma.auditLog.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({
      AND: [
        { OR: [{ teamId: "team_a" }, { teamId: null }] },
        {
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
        },
      ],
    });
  });

  it("does not apply team filter for team:manage admin sessions", async () => {
    await listAuditLogs({ session: adminUser });

    const where = mockPrisma.auditLog.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({});
  });
});

describe("exportAuditLogs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
  });

  it("scopes export with teamWhere for non-admin sessions", async () => {
    await exportAuditLogs({ session: teamUser });
    expect(mockPrisma.auditLog.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ teamId: "team_a" }, { teamId: null }] },
      }),
    );
  });
});

describe("getAuditStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.count.mockResolvedValue(0);
    mockPrisma.auditLog.groupBy.mockResolvedValue([]);
  });

  it("scopes stats queries with teamWhere for non-admin sessions", async () => {
    await getAuditStats(teamUser);
    expect(mockPrisma.auditLog.count).toHaveBeenCalledWith({
      where: { OR: [{ teamId: "team_a" }, { teamId: null }] },
    });
    expect(mockPrisma.auditLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { OR: [{ teamId: "team_a" }, { teamId: null }] },
      }),
    );
  });
});
