import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    requireApiSession: vi.fn(),
    auditUserAction: vi.fn(),
    setAccountType: vi.fn(),
    listIdentityTemplates: vi.fn(),
    getStorageAccessUsage: vi.fn(),
    parseNullableBigIntInput: vi.fn((v) => v ?? null),
    prisma: {
      user: { findUnique: vi.fn() },
      team: { findMany: vi.fn() },
      teamMember: { findUnique: vi.fn() },
      storageNode: { findMany: vi.fn() },
      server: { findMany: vi.fn() },
      userServerAccess: { deleteMany: vi.fn(), createMany: vi.fn() },
      userStorageAccess: { deleteMany: vi.fn(), createMany: vi.fn() },
      $transaction: vi.fn(),
    },
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: mocks.requireApiSession, isSessionPayload: (value: unknown) => !(value instanceof Response) }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/user/account-type", () => ({ setAccountType: mocks.setAccountType }));
vi.mock("@/lib/auth/identity-template-service", () => ({ listIdentityTemplates: mocks.listIdentityTemplates }));
vi.mock("@/lib/storage/access-control", () => ({
  getStorageAccessUsage: mocks.getStorageAccessUsage,
  parseNullableBigIntInput: mocks.parseNullableBigIntInput,
  releaseStorageQuotaGuard: vi.fn(async () => undefined),
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

const route = await import("../route");

const admin = { userId: "admin1", username: "root", roles: ["admin"] as const, mustChangePassword: false, currentTeamId: null };

const patch = (body: unknown) => route.PATCH(new Request("http://local/api/users/permissions", {
  method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
}));

describe("/api/users/permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: admin });
    mocks.requireApiSession.mockResolvedValue(admin);
    mocks.getStorageAccessUsage.mockResolvedValue(BigInt(0));
    mocks.listIdentityTemplates.mockResolvedValue([
      { id: "identity:operator", name: "客户运维", isBuiltin: true, permissions: ["server:read", "server:ssh"] },
    ]);
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.team.findMany.mockResolvedValue([{ id: "team-a", name: "Acme" }]);
    mocks.prisma.storageNode.findMany.mockResolvedValue([{ id: "node-a" }]);
    mocks.prisma.server.findMany.mockResolvedValue([]);
    mocks.prisma.teamMember.findUnique.mockResolvedValue({ teamId: "team-a" });
    mocks.prisma.user.findUnique.mockResolvedValue({
      id: "user1",
      username: "alice",
      displayName: "Alice",
      roles: [],
      teamMembership: {
        teamId: "team-a",
        team: { name: "Acme", deletedAt: null },
        identityTemplateId: "identity:operator",
        identityTemplate: { permissions: ["server:read", "server:ssh"] },
      },
      storageAccess: [],
      serverAccess: [],
    });
  });

  it("requires the platform-only user:manage permission", async () => {
    await route.GET(new Request("http://local/api/users/permissions?userId=user1"));
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("user:manage");
  });

  it("GET describes a customer account: customer, template and effective permissions", async () => {
    const res = await route.GET(new Request("http://local/api/users/permissions?userId=user1"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user).toMatchObject({
      accountType: "customer",
      teamId: "team-a",
      identityTemplateId: "identity:operator",
      effectivePermissions: expect.arrayContaining(["server:read", "server:ssh", "team:read", "user:read"]),
    });
    expect(body.customers).toEqual([{ id: "team-a", name: "Acme" }]);
    // Narrowing choices come from the account's own customer only.
    expect(mocks.prisma.server.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { teamId: "team-a" } }));
  });

  it("GET reports a platform administrator without customer resources", async () => {
    mocks.prisma.user.findUnique.mockResolvedValueOnce({
      id: "admin2", username: "ops", displayName: null,
      roles: [{ role: { key: "admin" } }], teamMembership: null, storageAccess: [], serverAccess: [],
    });
    const res = await route.GET(new Request("http://local/api/users/permissions?userId=admin2"));
    const body = await res.json();
    expect(body.user.accountType).toBe("admin");
    expect(body.storageNodes).toEqual([]);
    expect(mocks.prisma.server.findMany).not.toHaveBeenCalled();
  });

  it("PATCH changes the account type through the account service", async () => {
    const res = await patch({ userId: "user1", account: { type: "customer", teamId: "team-b", identityTemplateId: "identity:files" } });
    expect(res.status).toBe(200);
    expect(mocks.setAccountType).toHaveBeenCalledWith("user1", { type: "customer", teamId: "team-b", identityTemplateId: "identity:files" }, admin);
  });

  it("PATCH never lets an administrator edit its own account", async () => {
    const res = await patch({ userId: "admin1", account: { type: "customer", teamId: "team-a" } });
    expect(res.status).toBe(403);
    expect(mocks.setAccountType).not.toHaveBeenCalled();
  });

  it("PATCH narrows servers only within the account's customer", async () => {
    mocks.prisma.server.findMany.mockResolvedValueOnce([{ id: "srv-1" }]);
    const grant = { serverId: "srv-1", canRead: true, canConnect: false, canManage: false, canFileRead: true, canFileWrite: false, canFileDelete: false };
    const res = await patch({ userId: "user1", serverAccess: [grant], serverAccessScopeIds: ["srv-1"] });
    expect(res.status).toBe(200);
    expect(mocks.prisma.server.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: { in: ["srv-1"] }, teamId: "team-a" } }));
    expect(mocks.prisma.userServerAccess.createMany).toHaveBeenCalledWith({ data: [{ userId: "user1", ...grant }] });
  });

  it("PATCH keeps a storage grant with every flag cleared, which blocks that node", async () => {
    mocks.prisma.storageNode.findMany.mockResolvedValueOnce([{ id: "node-a" }]);
    const res = await patch({
      userId: "user1",
      storageAccess: [{ storageNodeId: "node-a", pathPrefix: "", canRead: false, canWrite: false, canDelete: false }],
      storageAccessScopeIds: ["node-a"],
    });
    expect(res.status).toBe(200);
    expect(mocks.prisma.userStorageAccess.createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining({ userId: "user1", storageNodeId: "node-a", canRead: false, canWrite: false, canDelete: false })],
      skipDuplicates: true,
    });
  });

  it("PATCH refuses resource narrowing for an account without a customer", async () => {
    mocks.prisma.teamMember.findUnique.mockResolvedValueOnce(null);
    const res = await patch({ userId: "user1", serverAccess: [], serverAccessScopeIds: [] });
    expect(res.status).toBe(400);
  });

  it("rejects malformed quotas before replacing any storage grants", async () => {
    const res = await patch({
      userId: "user1",
      storageAccess: [{ storageNodeId: "node-a", pathPrefix: "docs", canRead: true, quotaBytes: "unlimited-ish" }],
      storageAccessScopeIds: ["node-a"],
    });
    expect(res.status).toBe(400);
    expect(mocks.prisma.userStorageAccess.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects duplicate normalized storage paths instead of silently dropping one", async () => {
    const res = await patch({
      userId: "user1",
      storageAccess: [
        { storageNodeId: "node-a", pathPrefix: "docs/", canRead: true },
        { storageNodeId: "node-a", pathPrefix: "/docs", canRead: true },
      ],
      storageAccessScopeIds: ["node-a"],
    });
    expect(res.status).toBe(400);
    expect(mocks.prisma.userStorageAccess.deleteMany).not.toHaveBeenCalled();
  });

  it("rejects unsafe storage paths before replacing existing grants", async () => {
    const res = await patch({
      userId: "user1",
      storageAccess: [{ storageNodeId: "node-a", pathPrefix: "../secret", canRead: true }],
      storageAccessScopeIds: ["node-a"],
    });
    expect(res.status).toBe(400);
    expect(mocks.prisma.userStorageAccess.deleteMany).not.toHaveBeenCalled();
  });
});
