import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Permission } from "@/lib/auth/rbac";

const mocks = vi.hoisted(() => ({
  requireSession: vi.fn(),
  listServerProfiles: vi.fn(),
  listStorageNodes: vi.fn(),
}));
vi.mock("@/lib/auth/require-session", () => ({ requireSession: mocks.requireSession }));
vi.mock("@/lib/server/service", () => ({ listServerProfiles: mocks.listServerProfiles }));
vi.mock("@/lib/storage/service", () => ({ listStorageNodes: mocks.listStorageNodes }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { getStorageFormOptions } from "../actions-nodes";

function setPermissions(permissions: Permission[]) {
  mocks.requireSession.mockResolvedValue({
    userId: "customer", roles: [], currentTeamId: "team_1", permissions,
  });
}

describe("storage form options authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listServerProfiles.mockResolvedValue([]);
    mocks.listStorageNodes.mockResolvedValue([{ id: "node_1", name: "Files", driver: "LOCAL" }]);
  });

  it("rejects a direct action call from a read-only account", async () => {
    setPermissions(["storage:read"]);
    await expect(getStorageFormOptions()).rejects.toThrow();
    expect(mocks.listStorageNodes).not.toHaveBeenCalled();
    expect(mocks.listServerProfiles).not.toHaveBeenCalled();
  });

  it.each(["storage:write", "storage:manage-node"] as const)("allows %s without exposing server profiles", async (permission) => {
    setPermissions([permission]);
    await expect(getStorageFormOptions()).resolves.toEqual({
      servers: [], nodes: [{ id: "node_1", name: "Files", driver: "LOCAL" }],
    });
    expect(mocks.listServerProfiles).not.toHaveBeenCalled();
    expect(mocks.listStorageNodes).toHaveBeenCalledWith(expect.objectContaining({ currentTeamId: "team_1" }));
  });

  it("includes server options only with the server read grant", async () => {
    setPermissions(["storage:manage-node", "server:read"]);
    await getStorageFormOptions();
    expect(mocks.listServerProfiles).toHaveBeenCalledWith(expect.objectContaining({ currentTeamId: "team_1" }));
  });
});
