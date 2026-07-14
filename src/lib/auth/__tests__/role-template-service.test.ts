import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  roleFindMany: vi.fn(), storageFindMany: vi.fn(), templateCreate: vi.fn(), templateFindMany: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: {
  role: { findMany: mocks.roleFindMany },
  storageNode: { findMany: mocks.storageFindMany },
  roleTemplate: { create: mocks.templateCreate, findMany: mocks.templateFindMany },
} }));

import { createRoleTemplate, listRoleTemplates } from "../role-template-service";

describe("role template service", () => {
  it("persists roles, permissions and storage data scope", async () => {
    mocks.roleFindMany.mockResolvedValue([{ key: "operator" }]);
    mocks.storageFindMany.mockResolvedValue([{ id: "node-1" }]);
    mocks.templateCreate.mockImplementation(async ({ data }) => ({ id: "tpl-1", ...data, dataScope: data.dataScope, isBuiltin: false, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") }));
    const result = await createRoleTemplate({
      name: "Ops", roleKeys: ["operator"], permissions: ["server:read"],
      storageAccess: [{ storageNodeId: "node-1", pathPrefix: "team-a", canRead: true, canWrite: true, canDelete: false }],
    }, "user-1");
    expect(result.storageAccess).toHaveLength(1);
    expect(mocks.templateCreate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ roleKeys: ["operator"], permissions: ["server:read"] }) }));
  });

  it("serializes stored data scope", async () => {
    mocks.templateFindMany.mockResolvedValue([{ id: "tpl-1", name: "Viewer", description: null, roleKeys: ["viewer"], permissions: [], dataScope: { storageAccess: [] }, isBuiltin: false, createdBy: null, createdAt: new Date("2026-01-01"), updatedAt: new Date("2026-01-01") }]);
    const result = await listRoleTemplates();
    expect(result[0]?.storageAccess).toEqual([]);
  });
});
