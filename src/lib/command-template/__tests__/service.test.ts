import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    commandTemplate: {
      count: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const service = await import("../service");

describe("command template service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.commandTemplate.count.mockResolvedValue(1);
  });

  it("bounds command template list hydration while preserving built-in ordering", async () => {
    mockPrisma.commandTemplate.findMany.mockResolvedValue([]);

    await service.listTemplates();

    expect(mockPrisma.commandTemplate.findMany).toHaveBeenCalledWith({
      orderBy: [{ isBuiltin: "desc" }, { name: "asc" }],
      take: 200,
      include: { creator: { select: { username: true, displayName: true } } },
    });
  });

  it("seeds built-in templates via a single createMany call (TR-040)", async () => {
    mockPrisma.commandTemplate.count.mockResolvedValueOnce(0);
    mockPrisma.commandTemplate.createMany.mockResolvedValueOnce({ count: 12 });

    await service.seedBuiltinTemplates();

    expect(mockPrisma.commandTemplate.count).toHaveBeenCalledWith({
      where: { isBuiltin: true },
    });
    expect(mockPrisma.commandTemplate.createMany).toHaveBeenCalledTimes(1);
    // Ensure none of the 12 built-ins are still routed through `create`,
    // which would re-introduce the O(N) sequential round-trip pattern.
    expect(mockPrisma.commandTemplate.create).not.toHaveBeenCalled();
    const args = mockPrisma.commandTemplate.createMany.mock.calls[0]?.[0] as {
      data: Array<{ isBuiltin: boolean; name: string }>;
    } | undefined;
    expect(args).toBeDefined();
    expect(Array.isArray(args?.data)).toBe(true);
    expect(args?.data.length ?? 0).toBeGreaterThanOrEqual(12);
    expect(args?.data.every((row) => row.isBuiltin === true) ?? false).toBe(true);
  });

  it("skips seeding when built-in templates already exist", async () => {
    mockPrisma.commandTemplate.count.mockResolvedValueOnce(12);

    await service.seedBuiltinTemplates();

    expect(mockPrisma.commandTemplate.createMany).not.toHaveBeenCalled();
    expect(mockPrisma.commandTemplate.create).not.toHaveBeenCalled();
  });

  it("refuses to update or delete built-in templates", async () => {
    mockPrisma.commandTemplate.findUnique.mockResolvedValue({
      id: "builtin_1",
      isBuiltin: true,
      command: "systemctl restart nginx",
      rollbackCommand: null,
      name: "Nginx Restart",
      tags: ["web"],
      variables: [],
      createdById: null,
    });

    await expect(
      service.updateTemplate("builtin_1", { name: "Hijacked" }, { userId: "u1" }),
    ).rejects.toThrow("Built-in command templates cannot be modified");
    expect(mockPrisma.commandTemplate.update).not.toHaveBeenCalled();

    await expect(service.deleteTemplate("builtin_1", { userId: "u1" })).rejects.toThrow(
      "Built-in command templates cannot be deleted",
    );
    expect(mockPrisma.commandTemplate.delete).not.toHaveBeenCalled();
  });

  it("updates and deletes non-builtin templates owned by the actor", async () => {
    mockPrisma.commandTemplate.findUnique
      .mockResolvedValueOnce({
        id: "user_1",
        isBuiltin: false,
        command: "echo hi",
        rollbackCommand: null,
        createdById: "u1",
      })
      .mockResolvedValueOnce({
        id: "user_1",
        name: "User tmpl",
        isBuiltin: false,
        tags: [],
        variables: [],
        createdById: "u1",
      });
    mockPrisma.commandTemplate.update.mockResolvedValue({ id: "user_1", name: "Renamed" });
    mockPrisma.commandTemplate.delete.mockResolvedValue({ id: "user_1" });

    await service.updateTemplate("user_1", { name: "Renamed" }, { userId: "u1" });
    expect(mockPrisma.commandTemplate.update).toHaveBeenCalledWith({
      where: { id: "user_1" },
      data: { name: "Renamed" },
    });

    await service.deleteTemplate("user_1", { userId: "u1" });
    expect(mockPrisma.commandTemplate.delete).toHaveBeenCalledWith({ where: { id: "user_1" } });
  });

  it("rejects update/delete of another user's template without canManageAll", async () => {
    mockPrisma.commandTemplate.findUnique.mockResolvedValue({
      id: "user_2",
      isBuiltin: false,
      command: "echo secret",
      rollbackCommand: null,
      createdById: "owner-other",
      name: "Other",
      tags: [],
      variables: [],
    });

    await expect(
      service.updateTemplate("user_2", { name: "Hijack" }, { userId: "u1" }),
    ).rejects.toThrow(/No permission/);
    expect(mockPrisma.commandTemplate.update).not.toHaveBeenCalled();

    await expect(service.deleteTemplate("user_2", { userId: "u1" })).rejects.toThrow(/No permission/);
    expect(mockPrisma.commandTemplate.delete).not.toHaveBeenCalled();
  });

  it("allows managers to mutate another user's template", async () => {
    mockPrisma.commandTemplate.findUnique.mockResolvedValue({
      id: "user_2",
      isBuiltin: false,
      command: "echo secret",
      rollbackCommand: null,
      createdById: "owner-other",
    });
    mockPrisma.commandTemplate.update.mockResolvedValue({ id: "user_2", name: "Managed" });

    await service.updateTemplate(
      "user_2",
      { name: "Managed" },
      { userId: "admin", canManageAll: true },
    );
    expect(mockPrisma.commandTemplate.update).toHaveBeenCalled();
  });

  it("blocks mutation of legacy null-owner templates for non-managers", async () => {
    mockPrisma.commandTemplate.findUnique.mockResolvedValue({
      id: "legacy_1",
      isBuiltin: false,
      command: "echo legacy",
      rollbackCommand: null,
      createdById: null,
    });
    await expect(
      service.updateTemplate("legacy_1", { name: "x" }, { userId: "u1" }),
    ).rejects.toThrow(/No permission/);
  });
});
