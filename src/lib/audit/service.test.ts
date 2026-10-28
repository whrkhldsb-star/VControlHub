import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    auditLog: {
      create: vi.fn(),
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

const { listAuditLogs, getAuditStats, exportAuditLogs, writeAuditLog } = await import("./service");

import type { RoleKey } from "@/lib/auth/rbac";

const teamUser = { userId: "u1", roles: ["operator"] as RoleKey[], currentTeamId: "team_a" };
const adminUser = { userId: "admin", roles: ["admin"] as RoleKey[], currentTeamId: "team_a" };

describe("writeAuditLog", () => {
  it("stores user-typed text that holds U+0000, which jsonb cannot", async () => {
    mockPrisma.auditLog.create.mockResolvedValue({});
    await writeAuditLog({ actorType: "USER", action: "login.failed", detail: { username: "ab\u0000cd", nested: { note: ["x\u0000"] } } });
    expect(mockPrisma.auditLog.create.mock.calls[0]![0].data.detail).toEqual({ username: "ab\uFFFDcd", nested: { note: ["x\uFFFD"] } });
  });
});

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
        { teamId: "team_a" },
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

  it("does not apply a customer filter for administrators viewing all customers", async () => {
    await listAuditLogs({ session: { ...adminUser, currentTeamId: null } });

    const where = mockPrisma.auditLog.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({});
  });

  it("scopes administrators to the customer they selected", async () => {
    await listAuditLogs({ session: adminUser });

    const where = mockPrisma.auditLog.findMany.mock.calls[0]?.[0]?.where;
    expect(where).toEqual({ teamId: adminUser.currentTeamId });
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
        where: { teamId: "team_a" },
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
      where: { teamId: "team_a" },
    });
    expect(mockPrisma.auditLog.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { teamId: "team_a" },
      }),
    );
  });
});
