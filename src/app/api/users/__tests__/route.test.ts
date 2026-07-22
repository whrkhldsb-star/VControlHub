import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    hashPassword: vi.fn(),
    auditUserAction: vi.fn(),
    assertUserInActorScope: vi.fn(),
    userDirectoryWhere: vi.fn(),
    prisma: {
      user: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
      },
      role: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
      },
      userRole: {
        create: vi.fn(),
        createMany: vi.fn(),
        deleteMany: vi.fn(),
      },
      teamMember: {
        upsert: vi.fn(),
        findUnique: vi.fn(),
      },
      setting: {
        findUnique: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: mocks.hashPassword,
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));
vi.mock("@/lib/auth/team-scope", () => ({
  assertUserInActorScope: mocks.assertUserInActorScope,
  userDirectoryWhere: mocks.userDirectoryWhere,
}));
vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

const route = await import("../route");

const session = {
  userId: "admin1",
  username: "root",
  roles: ["admin"] as const,
  mustChangePassword: true,
  currentTeamId: "team-a",
  user: { id: "admin1" },
};

describe("/api/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.assertUserInActorScope.mockResolvedValue(undefined);
    mocks.userDirectoryWhere.mockReturnValue({
      OR: [{ id: "admin1" }, { teamMemberships: { some: { teamId: "team-a" } } }],
    });
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    mocks.prisma.setting.findUnique.mockResolvedValue(null);
    mocks.prisma.user.create.mockResolvedValue({ id: "user1", username: "alice" });
    mocks.prisma.role.findMany.mockResolvedValue([
      { id: "role-viewer", key: "viewer" },
      { id: "role-operator", key: "operator" },
    ]);
    mocks.prisma.userRole.createMany.mockResolvedValue({ count: 2 });
    mocks.prisma.teamMember.upsert.mockResolvedValue({ role: "member" });
  });

  it("lists users with team directory where", async () => {
    mocks.prisma.user.findMany.mockResolvedValue([
      {
        id: "user1",
        username: "alice",
        displayName: "Alice",
        status: "ACTIVE",
        mustChangePassword: false,
        createdAt: new Date("2026-01-01"),
        updatedAt: new Date("2026-01-01"),
        roles: [{ role: { key: "viewer", name: "Viewer" } }],
      },
    ]);

    const res = await route.GET(new Request("http://local/api/users"));
    expect(res.status).toBe(200);
    expect(mocks.userDirectoryWhere).toHaveBeenCalledWith(session);
    expect(mocks.prisma.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          OR: [{ id: "admin1" }, { teamMemberships: { some: { teamId: "team-a" } } }],
        },
      }),
    );
    await expect(res.json()).resolves.toEqual([
      expect.objectContaining({
        id: "user1",
        roles: [{ key: "viewer", name: "Viewer" }],
      }),
    ]);
  });

  it("creates users in one transaction and deduplicates role keys before assigning roles", async () => {
    const req = new Request("http://local/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: " alice ",
        displayName: " Alice Ops ",
        password: "Secret123",
        roleKeys: [" viewer ", "operator", "viewer", ""],
      }),
    });

    const res = await route.POST(req);

    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith({ where: { username: "alice" } });
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: "alice",
        displayName: "Alice Ops",
        passwordHash: "hashed-password",
      }),
    });
    expect(mocks.prisma.role.findMany).toHaveBeenCalledWith({
      where: { key: { in: ["viewer", "operator"] } },
      take: 2,
    });
    expect(mocks.prisma.userRole.createMany).toHaveBeenCalledWith({
      data: [
        { userId: "user1", roleId: "role-viewer" },
        { userId: "user1", roleId: "role-operator" },
      ],
      skipDuplicates: true,
    });
    expect(mocks.prisma.teamMember.upsert).toHaveBeenCalledWith({
      where: { teamId_userId: { teamId: "team-a", userId: "user1" } },
      update: {},
      create: { teamId: "team-a", userId: "user1", role: "member" },
    });
    expect(mocks.prisma.userRole.create).not.toHaveBeenCalled();
  });

  it("rejects unknown requested roles before creating a user", async () => {
    mocks.prisma.role.findMany.mockResolvedValue([{ id: "role-viewer", key: "viewer" }]);
    const req = new Request("http://local/api/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: "bob",
        password: "Secret123",
        roleKeys: ["viewer", "missing-role"],
      }),
    });

    const res = await route.POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringMatching(/Role|角色/) });
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(mocks.prisma.userRole.createMany).not.toHaveBeenCalled();
  });

  it("scopes PATCH target lookup via assertUserInActorScope", async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user1",
      username: "alice",
      status: "ACTIVE",
    });
    mocks.prisma.user.update.mockResolvedValue({ id: "user1", status: "DISABLED" });

    const req = new Request("http://local/api/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user1", action: "disable" }),
    });

    const res = await route.PATCH(req);
    expect(res.status).toBe(200);
    expect(mocks.assertUserInActorScope).toHaveBeenCalledWith(session, "user1");
    expect(mocks.prisma.user.update).toHaveBeenCalledWith({
      where: { id: "user1" },
      data: { status: "DISABLED" },
    });
  });

  it("returns 404 when PATCH target is outside actor team scope", async () => {
    const { NotFoundError } = await import("@/lib/errors");
    mocks.assertUserInActorScope.mockRejectedValueOnce(new NotFoundError("User not found"));

    const req = new Request("http://local/api/users", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "foreign", action: "disable" }),
    });

    const res = await route.PATCH(req);
    expect(res.status).toBe(404);
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });
});
