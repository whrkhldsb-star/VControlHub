import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    $transaction: vi.fn(async (queries: Promise<unknown>[]) => Promise.all(queries)),
    auditLog: {
      create: vi.fn(),
      findMany: vi.fn(), findFirst: vi.fn(),
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

const { listAuditLogs, getAuditStats, prepareAuditExport, writeAuditLog } = await import("./service");

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

describe("prepareAuditExport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.auditLog.findMany.mockResolvedValue([]);
  });

  it("scopes export with teamWhere for non-admin sessions", async () => {
    await prepareAuditExport({ session: teamUser });
    expect(mockPrisma.auditLog.findFirst).toHaveBeenCalledWith(
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

it("groups terminal command execution events with historical bare actions and filters the same family", async () => {
  mockPrisma.auditLog.groupBy.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce(
    ["command.execute", "command.execute.completed", "command.execute.failed", "command.execute.cancelled"].map(action => ({ action, _count: 1 })));
  expect((await getAuditStats({ ...teamUser, currentTeamId: "stats-family" })).highRiskByAction).toEqual({ "command.execute": 4 });
  await listAuditLogs({ action: "command.execute" });
  expect(mockPrisma.auditLog.findMany).toHaveBeenLastCalledWith(expect.objectContaining({
    where: { OR: [{ action: "command.execute" }, { action: { startsWith: "command.execute." } }] },
  }));
});

it.each([false, true])("probes the first omitted key before signalling truncation (%s)", async (overflow) => {
  const key = { id: "start", createdAt: new Date() };
  mockPrisma.auditLog.findFirst.mockResolvedValueOnce(key).mockResolvedValueOnce(overflow ? key : null);
  const result = await prepareAuditExport({ session: teamUser });
  expect(result.truncated).toBe(overflow);
  expect(mockPrisma.auditLog.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: { teamId: "team_a" }, skip: 50000, select: { createdAt: true, id: true } }));
});
