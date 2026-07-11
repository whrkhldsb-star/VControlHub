import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    permission: {
      upsert: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      findMany: vi.fn(),
    },
    role: {
      upsert: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    rolePermission: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      upsert: vi.fn(),
    },
    userRole: {
      upsert: vi.fn(),
    },
    server: {
      upsert: vi.fn(),
    },
    storageNode: {
      findFirst: vi.fn(),
      upsert: vi.fn(),
    },
    commandRequest: {
      upsert: vi.fn(),
    },
    $disconnect: vi.fn(),
    $transaction: vi.fn(async (operations: any[]) => Promise.all(operations)),
  },
}));

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
}));

vi.mock("@/lib/auth/bootstrap", () => ({
  ADMIN_BOOTSTRAP: { username: "admin", displayName: "Platform Admin" },
  getInitialAdminPassword: () => "bootstrap-password",
}));

vi.mock("@/lib/auth/password", () => ({
  hashPassword: vi.fn(async () => "hashed-bootstrap-password"),
}));

const OLD_ENV = { ...process.env };

async function loadSeedModule() {
  return import("../seed");
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...OLD_ENV };
  delete process.env.SEED_DEMO_DATA;
  delete process.env.DEMO_MODE;
  delete process.env.STORAGE_ROOT;

  mockPrisma.permission.upsert.mockResolvedValue({ id: "perm_1" });
  mockPrisma.permission.findUniqueOrThrow.mockImplementation(async ({ where }: any) => ({ id: `perm_${where.key}` }));
  mockPrisma.permission.findMany.mockResolvedValue([
    { id: "perm_announcement:manage", key: "announcement:manage" },
    { id: "perm_api-token:manage", key: "api-token:manage" },
    { id: "perm_ai:chat", key: "ai:chat" },
    { id: "perm_ai:manage", key: "ai:manage" },
    { id: "perm_ai:action:approve", key: "ai:action:approve" },
    { id: "perm_ai:ops:read", key: "ai:ops:read" },
    { id: "perm_ai:ops:manage", key: "ai:ops:manage" },
    { id: "perm_ai:ops:autonomous", key: "ai:ops:autonomous" },
    { id: "perm_deploy:export", key: "deploy:export" },
    { id: "perm_docker:manage", key: "docker:manage" },
    { id: "perm_image:read", key: "image:read" },
    { id: "perm_image:write", key: "image:write" },
    { id: "perm_media:manage", key: "media:manage" },
    { id: "perm_snippet:manage", key: "snippet:manage" },
    { id: "perm_ticket:create", key: "ticket:create" },
    { id: "perm_ticket:manage", key: "ticket:manage" },
    { id: "perm_ticket:read", key: "ticket:read" },
    { id: "perm_audit:read", key: "audit:read" },
    { id: "perm_backup:create", key: "backup:create" },
    { id: "perm_backup:read", key: "backup:read" },
    { id: "perm_backup:restore", key: "backup:restore" },
    { id: "perm_deploy:manage", key: "deploy:manage" },
    { id: "perm_deploy:read", key: "deploy:read" },
    { id: "perm_deploy:run", key: "deploy:run" },
    { id: "perm_health:read", key: "health:read" },
    { id: "perm_notification:manage", key: "notification:manage" },
    { id: "perm_share:create", key: "share:create" },
    { id: "perm_share:manage", key: "share:manage" },
    { id: "perm_share:read", key: "share:read" },
    { id: "perm_task:read", key: "task:read" },
    { id: "perm_command:approve", key: "command:approve" },
    { id: "perm_command:create", key: "command:create" },
    { id: "perm_command:execute", key: "command:execute" },
    { id: "perm_command:read", key: "command:read" },
    { id: "perm_cost:read", key: "cost:read" },
    { id: "perm_cost:manage", key: "cost:manage" },
    { id: "perm_role:manage", key: "role:manage" },
    { id: "perm_server:read", key: "server:read" },
    { id: "perm_server:ssh", key: "server:ssh" },
    { id: "perm_server:sftp:unrestricted", key: "server:sftp:unrestricted" },
    { id: "perm_server:write", key: "server:write" },
    { id: "perm_storage:delete", key: "storage:delete" },
    { id: "perm_storage:manage-node", key: "storage:manage-node" },
    { id: "perm_storage:read", key: "storage:read" },
    { id: "perm_storage:write", key: "storage:write" },
    { id: "perm_user:manage", key: "user:manage" },
    { id: "perm_user:read", key: "user:read" },
    { id: "perm_playbook:manage", key: "playbook:manage" },
    { id: "perm_playbook:read", key: "playbook:read" },
    { id: "perm_playbook:run", key: "playbook:run" },
    { id: "perm_team:create", key: "team:create" },
    { id: "perm_team:read", key: "team:read" },
    { id: "perm_team:manage", key: "team:manage" },
    { id: "perm_team:member:manage", key: "team:member:manage" },
  ]);
  mockPrisma.role.upsert.mockImplementation(async ({ where }: any) => ({ id: `role_${where.key}` }));
  mockPrisma.role.findUniqueOrThrow.mockResolvedValue({ id: "role_admin" });
  mockPrisma.rolePermission.deleteMany.mockResolvedValue({ count: 0 });
  mockPrisma.rolePermission.create.mockResolvedValue({});
  mockPrisma.rolePermission.createMany.mockResolvedValue({ count: 0 });
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.user.findUniqueOrThrow.mockResolvedValue({ id: "user_admin" });
  mockPrisma.user.upsert.mockResolvedValue({ id: "user_admin" });
  mockPrisma.userRole.upsert.mockResolvedValue({});
  mockPrisma.server.upsert.mockResolvedValue({ id: "srv_demo" });
  mockPrisma.storageNode.findFirst.mockResolvedValue(null);
  mockPrisma.storageNode.upsert.mockResolvedValue({ id: "node_demo" });
  mockPrisma.commandRequest.upsert.mockResolvedValue({ id: "cmd_demo" });
});

afterEach(() => {
  process.env = OLD_ENV;
});

describe("prisma seed", () => {
  it("seeds only production baseline data by default", async () => {
    const { seedDatabase } = await loadSeedModule();

    await seedDatabase();

    expect(mockPrisma.permission.upsert).toHaveBeenCalled();
    expect(mockPrisma.role.upsert).toHaveBeenCalled();
    expect(mockPrisma.rolePermission.createMany).toHaveBeenCalled();
    expect(mockPrisma.user.upsert).toHaveBeenCalled();
    expect(mockPrisma.server.upsert).not.toHaveBeenCalled();
    expect(mockPrisma.storageNode.upsert).toHaveBeenCalledWith({
      where: { id: "node_local_default" },
      update: expect.objectContaining({
        name: "本机默认存储",
        driver: "LOCAL",
        isDefault: true,
        basePath: "storage",
        serverId: null,
        host: null,
        port: null,
        username: null,
        publicBaseUrl: null,
        directAccessMode: "PROXY",
        directAccessExpiresSeconds: 300,
      }),
      create: expect.objectContaining({
        id: "node_local_default",
        name: "本机默认存储",
        driver: "LOCAL",
        isDefault: true,
        basePath: "storage",
        serverId: null,
        host: null,
        port: null,
        username: null,
        publicBaseUrl: null,
        directAccessMode: "PROXY",
        directAccessExpiresSeconds: 300,
      }),
    });
    expect(mockPrisma.commandRequest.upsert).not.toHaveBeenCalled();
  });

  it("seeds demo servers, storage nodes, and commands only when explicitly enabled", async () => {
    process.env.SEED_DEMO_DATA = "true";
    const { seedDatabase } = await loadSeedModule();

    await seedDatabase();

    expect(mockPrisma.server.upsert).toHaveBeenCalled();
    expect(mockPrisma.storageNode.upsert).toHaveBeenCalled();
    expect(mockPrisma.commandRequest.upsert).toHaveBeenCalled();
  });

  it("does not take over the default flag from an existing storage node", async () => {
    mockPrisma.storageNode.findFirst.mockResolvedValue({ id: "node_existing_default" });
    const { seedDatabase } = await loadSeedModule();

    await seedDatabase();

    expect(mockPrisma.storageNode.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: expect.objectContaining({ isDefault: false }),
        create: expect.objectContaining({ isDefault: false }),
      }),
    );
  });

  it("refreshes the initial admin password while the account still requires first-login rotation", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user_admin",
      username: "admin",
      status: "PENDING_PASSWORD_RESET",
      mustChangePassword: true,
    });
    const { seedDatabase } = await loadSeedModule();

    await seedDatabase();

    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.objectContaining({
        passwordHash: "hashed-bootstrap-password",
        status: "PENDING_PASSWORD_RESET",
        mustChangePassword: true,
      }),
    }));
  });

  it("does not overwrite an active admin password on reseed", async () => {
    mockPrisma.user.findUnique.mockResolvedValue({
      id: "user_admin",
      username: "admin",
      status: "ACTIVE",
      mustChangePassword: false,
    });
    const { seedDatabase } = await loadSeedModule();

    await seedDatabase();

    expect(mockPrisma.user.upsert).toHaveBeenCalledWith(expect.objectContaining({
      update: expect.not.objectContaining({ passwordHash: expect.any(String) }),
    }));
  });
});
