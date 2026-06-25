import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    hashPassword: vi.fn(),
    auditUserAction: vi.fn(),
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
vi.mock("@/lib/db", () => ({
  prisma: mocks.prisma,
}));

const route = await import("../route");

const session = { userId: "admin1", username: "root", user: { id: "admin1" } };

describe("/api/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.hashPassword.mockResolvedValue("hashed-password");
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    mocks.prisma.setting.findUnique.mockResolvedValue(null);
    mocks.prisma.user.create.mockResolvedValue({ id: "user1", username: "alice" });
    mocks.prisma.role.findMany.mockResolvedValue([
      { id: "role-viewer", key: "viewer" },
      { id: "role-operator", key: "operator" },
    ]);
    mocks.prisma.userRole.createMany.mockResolvedValue({ count: 2 });
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
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("角色不存在") });
    expect(mocks.prisma.user.create).not.toHaveBeenCalled();
    expect(mocks.prisma.userRole.createMany).not.toHaveBeenCalled();
  });
});
