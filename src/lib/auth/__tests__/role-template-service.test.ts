import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roleFindMany: vi.fn(), storageFindMany: vi.fn(), templateCreate: vi.fn(), templateFindMany: vi.fn(),
  templateFindFirst: vi.fn(), templateUpdate: vi.fn(), templateDelete: vi.fn(), assignedMemberCount: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  role: { findMany: mocks.roleFindMany },
  storageNode: { findMany: mocks.storageFindMany },
  roleTemplate: { create: mocks.templateCreate, findMany: mocks.templateFindMany, findFirst: mocks.templateFindFirst, update: mocks.templateUpdate, delete: mocks.templateDelete },
  teamMember: { count: mocks.assignedMemberCount },
} }));

import { createRoleTemplate, deleteRoleTemplate, listRoleTemplates, updateRoleTemplate } from "../role-template-service";

describe("role template service", () => {
  it("persists roles, permissions and storage data scope", async () => {
    mocks.roleFindMany.mockResolvedValue([{ key: "operator" }]);
    mocks.storageFindMany.mockResolvedValue([{ id: "node-1" }]);
    mocks.templateCreate.mockImplementation(async ({ data }) => ({ id: "tpl-1", ...data, dataScope: data.dataScope, isBuiltin: false, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") }));
    const result = await createRoleTemplate({
      name: "Ops", roleKeys: ["operator"], permissions: ["server:read"],
      storageAccess: [{ storageNodeId: "node-1", pathPrefix: "team-a", canRead: true, canWrite: true, canDelete: false }],
    }, "user-1", "team-1", true);
    expect(result.storageAccess).toHaveLength(1);
    expect(mocks.templateCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roleKeys: ["operator"], permissions: ["server:read"] }) }));
  });

  it("serializes stored data scope", async () => {
    mocks.templateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Viewer", description: null, kind: "ACCOUNT_TEMPLATE", roleKeys: ["viewer"], permissions: [], dataScope: { storageAccess: [] }, isBuiltin: false, createdBy: null, teamId: "team-1", createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") }]);
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
    }, "user-1", "team-1", true);
    expect(mocks.storageFindMany).toHaveBeenCalledWith({
      where: { id: { in: ["node-1"] }, teamId: "team-1" },
      select: { id: true },
      take: 1,
    });
  });

  it("does not delete an assigned group and silently restore broader inherited permissions", async () => {
    mocks.templateFindFirst.mockResolvedValue({ isBuiltin: false, kind: "POLICY_GROUP" });
    mocks.assignedMemberCount.mockResolvedValue(1);

    await expect(deleteRoleTemplate("tpl-1", "team-1")).rejects.toThrow(/重新分配|Reassign/);
    expect(mocks.templateDelete).not.toHaveBeenCalled();
  });

  it("creates and updates an editable workspace policy group", async () => {
    mocks.roleFindMany.mockResolvedValue([{ key: "viewer" }]);
    mocks.templateCreate.mockImplementation(async ({ data }) => ({
      id: "policy-1", ...data, dataScope: data.dataScope, isBuiltin: false,
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01"),
    }));
    const created = await createRoleTemplate({
      kind: "POLICY_GROUP", name: "Night shift", roleKeys: ["viewer"], permissions: ["server:read"],
    }, "user-1", "team-1");
    expect(created.kind).toBe("POLICY_GROUP");

    mocks.templateFindFirst.mockResolvedValue({ isBuiltin: false, kind: "POLICY_GROUP" });
    mocks.templateUpdate.mockImplementation(async ({ data }) => ({
      id: "policy-1", ...data, kind: "POLICY_GROUP", dataScope: data.dataScope,
      isBuiltin: false, createdBy: "user-1", teamId: "team-1",
      createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-02"),
    }));
    const updated = await updateRoleTemplate("policy-1", {
      kind: "POLICY_GROUP", name: "Night shift 2", roleKeys: ["viewer"], permissions: ["server:read"],
    }, "team-1");
    expect(updated.name).toBe("Night shift 2");
  });

  it("rejects platform roles and resource snapshots in workspace policy groups", async () => {
    mocks.roleFindMany.mockResolvedValue([{ key: "admin" }]);
    await expect(createRoleTemplate({
      kind: "POLICY_GROUP", name: "Too broad", roleKeys: ["admin"], permissions: ["team:manage"],
    }, "user-1", "team-1")).rejects.toThrow();

    mocks.roleFindMany.mockResolvedValue([{ key: "viewer" }]);
    await expect(createRoleTemplate({
      kind: "POLICY_GROUP", name: "Snapshot", roleKeys: ["viewer"],
      serverAccess: [{ serverId: "server-1", canRead: true, canConnect: false, canManage: false, canFileRead: false, canFileWrite: false, canFileDelete: false }],
    }, "user-1", "team-1")).rejects.toThrow();
  });

  it("normalizes template storage paths and rejects duplicate or unsafe grants", async () => {
    mocks.templateCreate.mockClear();
    mocks.roleFindMany.mockResolvedValue([{ key: "operator" }]);
    mocks.storageFindMany.mockResolvedValue([{ id: "node-1" }]);
    await expect(createRoleTemplate({
      kind: "ACCOUNT_TEMPLATE", name: "Duplicate paths", roleKeys: ["operator"],
      storageAccess: [
        { storageNodeId: "node-1", pathPrefix: "docs/", canRead: true },
        { storageNodeId: "node-1", pathPrefix: "/docs", canRead: true },
      ],
    }, "user-1", "team-1", true)).rejects.toThrow();
    await expect(createRoleTemplate({
      kind: "ACCOUNT_TEMPLATE", name: "Unsafe path", roleKeys: ["operator"],
      storageAccess: [{ storageNodeId: "node-1", pathPrefix: "../secret", canRead: true }],
    }, "user-1", "team-1", true)).rejects.toThrow();
    expect(mocks.templateCreate).not.toHaveBeenCalled();
  });
});
