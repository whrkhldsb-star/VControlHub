import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    requireApiSession: vi.fn(),
    hashPassword: vi.fn(),
    auditUserAction: vi.fn(),
		assertAdminAccessMayBeRemoved: vi.fn(),
		withAdminInvariantLock: vi.fn(),
    assertUserInActorScope: vi.fn(),
    userDirectoryWhere: vi.fn(),
    isGlobalTeamManager: vi.fn(),
    prisma: {
      user: {
        findMany: vi.fn(),
        findUnique: vi.fn(),
        create: vi.fn(),
        update: vi.fn(),
        count: vi.fn(),
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
      team: { findUnique: vi.fn() },
      identityTemplate: { findUnique: vi.fn() },
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
vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: mocks.requireApiSession, isSessionPayload: (value: unknown) => !(value instanceof Response) }));
vi.mock("@/lib/auth/password", () => ({
  hashPassword: mocks.hashPassword,
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));
vi.mock("@/lib/user/admin-invariant", () => ({
	assertAdminAccessMayBeRemoved: mocks.assertAdminAccessMayBeRemoved,
	withAdminInvariantLock: mocks.withAdminInvariantLock,
}));
vi.mock("@/lib/auth/team-scope", () => ({
  assertUserInActorScope: mocks.assertUserInActorScope,
  userDirectoryWhere: mocks.userDirectoryWhere,
  isGlobalTeamManager: mocks.isGlobalTeamManager,
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
    mocks.requireApiSession.mockResolvedValue(session);
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.assertUserInActorScope.mockResolvedValue(undefined);
    // The route's platform-admin guard treats non-global managers specially;
    // these tests use an admin session, which a real isGlobalTeamManager call
    // would classify as global.
    mocks.isGlobalTeamManager.mockReturnValue(true);
		mocks.assertAdminAccessMayBeRemoved.mockResolvedValue(undefined);
		mocks.withAdminInvariantLock.mockImplementation(async (operation) => operation());
    mocks.userDirectoryWhere.mockReturnValue({
      OR: [{ id: "admin1" }, { teamMembership: { is: { teamId: "team-a" } } }],
    });
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    mocks.prisma.setting.findUnique.mockResolvedValue(null);
    mocks.prisma.user.create.mockResolvedValue({ id: "user1", username: "alice" });
    mocks.prisma.role.findMany.mockResolvedValue([
      { id: "role-viewer", key: "viewer" },
      { id: "role-operator", key: "operator" },
    ]);
    mocks.prisma.role.findUnique.mockResolvedValue({ id: "role-admin" });
    mocks.prisma.team.findUnique.mockResolvedValue({ deletedAt: null });
    mocks.prisma.identityTemplate.findUnique.mockResolvedValue({ id: "identity:operator" });
  });

  const post = (body: unknown) => new Request("http://local/api/users", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  it("lists the directory with each account's type, customer and identity template", async () => {
    mocks.prisma.user.findMany.mockResolvedValue([
      {
        id: "user1", username: "alice", displayName: "Alice", status: "ACTIVE", mustChangePassword: false,
        createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
        roles: [],
        teamMembership: { team: { id: "team-a", name: "Acme", deletedAt: null }, identityTemplate: { id: "identity:operator", name: "客户运维", isBuiltin: true } },
      },
      {
        id: "admin1", username: "root", displayName: null, status: "ACTIVE", mustChangePassword: false,
        createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
        roles: [{ role: { key: "admin" } }],
        teamMembership: null,
      },
    ]);
    mocks.prisma.user.count.mockResolvedValue(2);

    const res = await route.GET(new Request("http://local/api/users"));

    expect(res.status).toBe(200);
    expect(mocks.userDirectoryWhere).toHaveBeenCalledWith(session);
    expect(mocks.prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { OR: [{ id: "admin1" }, { teamMembership: { is: { teamId: "team-a" } } }] },
      skip: 0,
      take: 50,
    }));
    const body = await res.json();
    expect(body).toMatchObject({ total: 2, page: 1, pageSize: 50, totalPages: 1 });
    expect(body.users[0]).toMatchObject({
      accountType: "customer",
      customer: { id: "team-a", name: "Acme", deleted: false },
      identityTemplate: { id: "identity:operator" },
    });
    expect(body.users[0]).not.toHaveProperty("roles");
    expect(body.users[1]).toMatchObject({ accountType: "admin", customer: null });
  });

  it("creates a customer account with its membership in one write", async () => {
    const res = await route.POST(post({
      username: " alice ",
      displayName: " Alice Ops ",
      password: "Secret123",
      account: { type: "customer", teamId: "team-a", identityTemplateId: "identity:operator" },
    }));

    expect(res.status).toBe(200);
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.user.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        username: "alice",
        displayName: "Alice Ops",
        passwordHash: "hashed-password",
        mustChangePassword: true,
        currentTeamId: "team-a",
        teamMembership: { create: { teamId: "team-a", identityTemplateId: "identity:operator" } },
      }),
      select: { id: true },
    });
    expect(mocks.prisma.user.create.mock.calls[0]![0].data).not.toHaveProperty("roles");
  });

  it("creates a platform administrator without any customer", async () => {
    const res = await route.POST(post({ username: "ops2", password: "Secret123", account: { type: "admin" } }));

    expect(res.status).toBe(200);
    const data = mocks.prisma.user.create.mock.calls[0]![0].data;
    expect(data.roles).toEqual({ create: { roleId: "role-admin" } });
    expect(data).not.toHaveProperty("teamMembership");
  });

  it("refuses a customer account for a deleted customer or an unknown template", async () => {
    mocks.prisma.team.findUnique.mockResolvedValueOnce({ deletedAt: new Date() });
    const deleted = await route.POST(post({ username: "bob", password: "Secret123", account: { type: "customer", teamId: "team-gone" } }));
    expect(deleted.status).toBe(404);

    mocks.prisma.identityTemplate.findUnique.mockResolvedValueOnce(null);
    const unknown = await route.POST(post({ username: "bob", password: "Secret123", account: { type: "customer", teamId: "team-a", identityTemplateId: "missing" } }));
    expect(unknown.status).toBe(404);
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
  });

  it("requires an account type", async () => {
    const res = await route.POST(post({ username: "bob", password: "Secret123" }));
    expect(res.status).toBe(400);
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
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

	it("rejects a PATCH that carries no action instead of reporting success", async () => {
		mocks.prisma.user.findUnique.mockResolvedValue({ id: "user1", username: "alice", status: "ACTIVE" });
		// {userId, newPassword} passes the schema but matches no branch: the old code
		// answered 200 {success:true} while leaving the password untouched.
		const res = await route.PATCH(new Request("http://local/api/users", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ userId: "user1", newPassword: "Secret123" }),
		}));
		expect(res.status).toBe(400);
		expect(mocks.prisma.user.update).not.toHaveBeenCalled();
	});

	it("resets a password and forces a change on next sign-in", async () => {
		mocks.prisma.user.findUnique.mockResolvedValue({ id: "user1", username: "alice", status: "ACTIVE" });
		mocks.prisma.user.update.mockResolvedValue({ id: "user1" });
		const res = await route.PATCH(new Request("http://local/api/users", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ userId: "user1", action: "reset_password", newPassword: "Secret123" }),
		}));
		expect(res.status).toBe(200);
		expect(mocks.prisma.user.update).toHaveBeenCalledWith({
			where: { id: "user1" },
			data: {
				passwordHash: "hashed-password",
				mustChangePassword: true,
				status: "PENDING_PASSWORD_RESET",
			},
		});
	});

	it("rejects legacy role assignment PATCHes before mutating roles", async () => {
		mocks.prisma.user.findUnique.mockResolvedValue({ id: "user1", username: "alice", status: "ACTIVE" });
		const res = await route.PATCH(new Request("http://local/api/users", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ userId: "user1", roleKeys: ["admin"] }),
		}));
		expect(res.status).toBe(400);
		expect(mocks.prisma.userRole.deleteMany).not.toHaveBeenCalled();
	});
});
