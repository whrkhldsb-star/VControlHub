import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    auditUserAction: vi.fn(),
    assertUserInActorScope: vi.fn(),
    isGlobalTeamManager: vi.fn(),
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
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));
vi.mock("@/lib/auth/team-scope", () => ({
  assertUserInActorScope: mocks.assertUserInActorScope,
  isGlobalTeamManager: mocks.isGlobalTeamManager,
  teamWhere: mocks.teamWhere,
}));
vi.mock("@/lib/storage/access-control", () => ({
  getStorageAccessUsage: mocks.getStorageAccessUsage,
  parseNullableBigIntInput: mocks.parseNullableBigIntInput,
}));
vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

const route = await import("../route");

const session = {
  userId: "admin1",
  username: "root",
  roles: ["operator"] as const,
  mustChangePassword: false,
  currentTeamId: "team-a",
};

describe("/api/users/permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.assertUserInActorScope.mockResolvedValue(undefined);
    mocks.isGlobalTeamManager.mockReturnValue(false);
    mocks.teamWhere.mockReturnValue({
      OR: [{ teamId: "team-a" }, { teamId: null }],
    });
    mocks.getStorageAccessUsage.mockResolvedValue(BigInt(0));
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user1",
      username: "alice",
      displayName: "Alice",
      roles: [],
      storageAccess: [],
    });
    mocks.prisma.role.findMany.mockResolvedValue([]);
    mocks.prisma.permission.findMany.mockResolvedValue([]);
    mocks.prisma.storageNode.findMany.mockResolvedValue([{ id: "node-a" }]);
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
          storageAccess: expect.objectContaining({
            where: { storageNode: { OR: [{ teamId: "team-a" }, { teamId: null }] } },
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
        }),
      }),
    );
    expect(res.status).toBe(200);
    expect(mocks.assertUserInActorScope).toHaveBeenCalledWith(session, "user1");
    expect(mocks.prisma.userStorageAccess.deleteMany).toHaveBeenCalledWith({
      where: {
        userId: "user1",
        storageNode: { OR: [{ teamId: "team-a" }, { teamId: null }] },
      },
    });
    expect(mocks.prisma.userStorageAccess.createMany).toHaveBeenCalled();
  });
});
