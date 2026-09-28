import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    requireApiSession: vi.fn(),
    auditUserAction: vi.fn(),
		assertAdminAccessMayBeRemoved: vi.fn(),
		withAdminInvariantLock: vi.fn(),
    assertUserInActorScope: vi.fn(),
    isGlobalTeamManager: vi.fn(),
    userHoldsTeamManage: vi.fn(),
    teamWhere: vi.fn(),
    getStorageAccessUsage: vi.fn(),
    parseNullableBigIntInput: vi.fn((v) => v ?? null),
    prisma: {
      user: {
        findUnique: vi.fn(),
      },
      role: {
        findMany: vi.fn(),
        upsert: vi.fn(),
      },
      permission: {
        findMany: vi.fn(),
      },
      storageNode: {
        findMany: vi.fn(),
      },
      server: { findMany: vi.fn() },
      userServerAccess: { deleteMany: vi.fn(), createMany: vi.fn() },
      userRole: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
        upsert: vi.fn(),
      },
      rolePermission: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      userStorageAccess: {
        deleteMany: vi.fn(),
        createMany: vi.fn(),
      },
      $transaction: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: mocks.requireApiSession, isSessionPayload: (value: unknown) => !(value instanceof Response) }));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));
vi.mock("@/lib/user/admin-invariant", () => ({
	assertAdminAccessMayBeRemoved: mocks.assertAdminAccessMayBeRemoved,
	withAdminInvariantLock: mocks.withAdminInvariantLock,
}));
vi.mock("@/lib/auth/team-scope", () => ({
  assertUserInActorScope: mocks.assertUserInActorScope,
  isGlobalTeamManager: mocks.isGlobalTeamManager,
  userHoldsTeamManage: mocks.userHoldsTeamManage,
  teamWhere: mocks.teamWhere,
}));
vi.mock("@/lib/storage/access-control", () => ({
  getStorageAccessUsage: mocks.getStorageAccessUsage,
  parseNullableBigIntInput: mocks.parseNullableBigIntInput,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

const route = await import("../route");

const session = {
  userId: "admin1",
  username: "root",
  roles: ["operator"] as const,
  permissions: ["user:read", "team:member:manage"] as const,
  mustChangePassword: false,
  currentTeamId: "team-a",
};

describe("/api/users/permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.requireApiSession.mockResolvedValue(session);
    mocks.assertUserInActorScope.mockResolvedValue(undefined);
		mocks.assertAdminAccessMayBeRemoved.mockResolvedValue(undefined);
		mocks.withAdminInvariantLock.mockImplementation(async (operation) => operation());
    mocks.isGlobalTeamManager.mockReturnValue(false);
    mocks.userHoldsTeamManage.mockResolvedValue(false);
    mocks.teamWhere.mockReturnValue({
      teamId: "team-a",
    });
    mocks.getStorageAccessUsage.mockResolvedValue(BigInt(0));
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user1",
      username: "alice",
      displayName: "Alice",
      roles: [],
      teamMemberships: [],
      storageAccess: [],
      serverAccess: [],
    });
    mocks.prisma.role.findMany.mockResolvedValue([]);
    mocks.prisma.permission.findMany.mockResolvedValue([]);
    mocks.prisma.storageNode.findMany.mockResolvedValue([{ id: "node-a" }]);
    mocks.prisma.server.findMany.mockResolvedValue([]);
  });

  it("GET asserts target user is in actor team scope", async () => {
    const res = await route.GET(
      new Request("http://local/api/users/permissions?userId=user1"),
    );
    expect(res.status).toBe(200);
    expect(mocks.assertUserInActorScope).toHaveBeenCalledWith(session, "user1");
    expect(mocks.prisma.user.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "user1" },
        select: expect.objectContaining({
          // Storage nodes are security roots: for non-global actors only the
          // current team's nodes are offered (null-team nodes quarantined).
          storageAccess: expect.objectContaining({
            where: { storageNode: { teamId: "team-a" } },
          }),
        }),
      }),
    );
  });

  it("GET returns 404 when target is outside team scope", async () => {
    const { NotFoundError } = await import("@/lib/errors");
    mocks.assertUserInActorScope.mockRejectedValueOnce(new NotFoundError("User not found"));
    const res = await route.GET(
      new Request("http://local/api/users/permissions?userId=foreign"),
    );
    expect(res.status).toBe(404);
    expect(mocks.prisma.user.findUnique).not.toHaveBeenCalled();
  });

  it("GET reports permissions after the target member's workspace ceiling", async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce({
      id: "user1",
      username: "alice",
      displayName: "Alice",
      roles: [{
        role: {
          key: "operator",
          name: "Operator",
          permissions: [
            { permission: { key: "server:read" } },
            { permission: { key: "server:write" } },
          ],
        },
      }],
      teamMemberships: [{ role: "member", accessRole: "viewer", permissionTemplate: null }],
      storageAccess: [],
      serverAccess: [],
    });
    const res = await route.GET(new Request("http://local/api/users/permissions?userId=user1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.effectivePermissions).toContain("server:read");
    expect(body.user.effectivePermissions).not.toContain("server:write");
    expect(body.user.resourceAccessBypassed).toBe(false);
  });

  it("PATCH scopes storage grant delete to team nodes for non-global managers", async () => {
    const res = await route.PATCH(
      new Request("http://local/api/users/permissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: "user1",
          storageAccess: [
            {
              storageNodeId: "node-a",
              pathPrefix: "docs",
              canRead: true,
              canWrite: false,
              canDelete: false,
            },
          ],
          storageAccessScopeIds: ["node-a"],
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.assertUserInActorScope).toHaveBeenCalledWith(session, "user1");
    expect(mocks.prisma.userStorageAccess.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        storageNodeId: { in: ["node-a"] },
      },
    });
    expect(mocks.prisma.userStorageAccess.createMany).toHaveBeenCalled();
  });

  it("PATCH rejects unknown role keys before replacing assignments", async () => {
    mocks.isGlobalTeamManager.mockReturnValue(true);
    mocks.requireApiSession.mockResolvedValue({ ...session, roles: ["admin"] });
    mocks.prisma.role.findMany.mockResolvedValueOnce([{ id: "r1", key: "viewer" }]);

    const res = await route.PATCH(
      new Request("http://local/api/users/permissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user1", roleKeys: ["viewer", "missing"] }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mocks.prisma.userRole.deleteMany).not.toHaveBeenCalled();
  });

	it("PATCH blocks a delegated manager from editing a platform manager's grants", async () => {
		mocks.prisma.user.findUnique.mockResolvedValueOnce({
			id: "user1",
			username: "alice",
			roles: [{ role: { key: "admin" } }],
			teamMemberships: [],
		});
		const response = await route.PATCH(new Request("http://local/api/users/permissions", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ userId: "user1", roleKeys: ["viewer"] }),
		}));

		expect(response.status).toBe(403);
		expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
	});

	it("PATCH checks the active-admin invariant before removing the admin role", async () => {
		mocks.isGlobalTeamManager.mockReturnValue(true);
		mocks.requireApiSession.mockResolvedValue({ ...session, roles: ["admin"] });
		// The delegation check reads role.permissions, so the mock must carry it.
		mocks.prisma.role.findMany.mockResolvedValueOnce([{ id: "r1", key: "viewer", permissions: [] }]);
		const res = await route.PATCH(new Request("http://local/api/users/permissions", {
			method: "PATCH",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ userId: "user1", roleKeys: ["viewer"] }),
		}));
		expect(res.status).toBe(200);
		expect(mocks.withAdminInvariantLock).toHaveBeenCalledOnce();
		expect(mocks.assertAdminAccessMayBeRemoved).toHaveBeenCalledWith("user1");
	});

  it("PATCH rejects unknown permission keys before replacing custom grants", async () => {
    mocks.isGlobalTeamManager.mockReturnValue(true);
    mocks.requireApiSession.mockResolvedValue({ ...session, roles: ["admin"] });
    mocks.prisma.role.upsert.mockResolvedValueOnce({ id: "custom-role" });
    mocks.prisma.permission.findMany.mockResolvedValueOnce([]);

    const res = await route.PATCH(
      new Request("http://local/api/users/permissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "user1", permissionKeys: ["unknown:grant"] }),
      }),
    );

    expect(res.status).toBe(400);
    expect(mocks.prisma.rolePermission.deleteMany).not.toHaveBeenCalled();
  });

  it("prevents workspace managers from changing platform account roles", async () => {
    const res = await route.PATCH(new Request("http://local/api/users/permissions", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user1", roleKeys: ["admin"] }),
    }));
    expect(res.status).toBe(403);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects member-level resource restrictions for a workspace administrator", async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce({
      id: "user1", username: "alice", roles: [], teamMemberships: [{ role: "admin" }],
    });
    const res = await route.PATCH(new Request("http://local/api/users/permissions", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: "user1", serverAccess: [], serverAccessScopeIds: [] }),
    }));
    expect(res.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects malformed quotas before replacing any storage grants", async () => {
    const res = await route.PATCH(new Request("http://local/api/users/permissions", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user1",
        storageAccess: [{ storageNodeId: "node-a", pathPrefix: "docs", canRead: true, quotaBytes: "unlimited-ish" }],
        storageAccessScopeIds: ["node-a"],
      }),
    }));
    expect(res.status).toBe(400);
    expect(mocks.prisma.userStorageAccess.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate normalized storage paths instead of silently dropping one", async () => {
    const res = await route.PATCH(new Request("http://local/api/users/permissions", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user1",
        storageAccess: [
          { storageNodeId: "node-a", pathPrefix: "docs/", canRead: true },
          { storageNodeId: "node-a", pathPrefix: "/docs", canRead: true },
        ],
        storageAccessScopeIds: ["node-a"],
      }),
    }));
    expect(res.status).toBe(400);
    expect(mocks.prisma.userStorageAccess.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects unsafe storage paths before replacing existing grants", async () => {
    const res = await route.PATCH(new Request("http://local/api/users/permissions", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({
        userId: "user1",
        storageAccess: [{ storageNodeId: "node-a", pathPrefix: "../secret", canRead: true }],
        storageAccessScopeIds: ["node-a"],
      }),
    }));
    expect(res.status).toBe(400);
    expect(mocks.prisma.userStorageAccess.deleteMany).not.toHaveBeenCalled();
  });
});
