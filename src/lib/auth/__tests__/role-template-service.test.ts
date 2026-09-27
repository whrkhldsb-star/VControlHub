import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roleFindMany: vi.fn(), storageFindMany: vi.fn(), templateCreate: vi.fn(), templateFindMany: vi.fn(),
  templateFindFirst: vi.fn(), templateDelete: vi.fn(), assignedMemberCount: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  role: { findMany: mocks.roleFindMany },
  storageNode: { findMany: mocks.storageFindMany },
  roleTemplate: { create: mocks.templateCreate, findMany: mocks.templateFindMany, findFirst: mocks.templateFindFirst, delete: mocks.templateDelete },
  teamMember: { count: mocks.assignedMemberCount },
} }));

import { createRoleTemplate, deleteRoleTemplate, listRoleTemplates } from "../role-template-service";

describe("role template service", () => {
  it("persists roles, permissions and storage data scope", async () => {
    mocks.roleFindMany.mockResolvedValue([{ key: "operator" }]);
    mocks.storageFindMany.mockResolvedValue([{ id: "node-1" }]);
    mocks.templateCreate.mockImplementation(async ({ data }) => ({ id: "tpl-1", ...data, dataScope: data.dataScope, isBuiltin: false, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") }));
    const result = await createRoleTemplate({
      name: "Ops", roleKeys: ["operator"], permissions: ["server:read"],
      storageAccess: [{ storageNodeId: "node-1", pathPrefix: "team-a", canRead: true, canWrite: true, canDelete: false }],
    }, "user-1", "team-1");
    expect(result.storageAccess).toHaveLength(1);
    expect(mocks.templateCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roleKeys: ["operator"], permissions: ["server:read"] }) }));
  });

  it("serializes stored data scope", async () => {
    mocks.templateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Viewer", description: null, roleKeys: ["viewer"], permissions: [], dataScope: { storageAccess: [] }, isBuiltin: false, createdBy: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") }]);
    const result = await listRoleTemplates("team-1");
    expect(result.find((template) => template.id === "tpl-1")?.storageAccess).toEqual([]);
  });

  it("validates only requested storage node ids (not a global take:500 whitelist)", async () => {
    mocks.roleFindMany.mockResolvedValue([{ key: "operator" }]);
    mocks.storageFindMany.mockResolvedValue([{ id: "node-1" }]);
    mocks.templateCreate.mockImplementation(async ({ data }) => ({
      id: "tpl-2",
      ...data,
      dataScope: data.dataScope,
      isBuiltin: false,
      createdAt: new Date("2026-01-01"),
      updatedAt: new Date("2026-01-01"),
    }));
    await createRoleTemplate({
      name: "Ops2",
      roleKeys: ["operator"],
      permissions: ["server:read"],
      storageAccess: [{ storageNodeId: "node-1", pathPrefix: "/", canRead: true, canWrite: false, canDelete: false }],
    }, "user-1", "team-1");
    expect(mocks.storageFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["node-1"] }, teamId: "team-1" },
      select: { id: true },
      take: 1,
    });
  });

  it("does not delete an assigned group and silently restore broader inherited permissions", async () => {
    mocks.templateFindFirst.mockResolvedValue({ isBuiltin: false });
    mocks.assignedMemberCount.mockResolvedValue(1);

    await expect(deleteRoleTemplate("tpl-1", "team-1")).rejects.toThrow(/重新分配|Reassign/);
    expect(mocks.templateDelete).not.toHaveBeenCalled();
  });
});
