import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@/lib/db";
import {
  customRoleKey,
  resolveEffectivePermissions,
} from "@/lib/auth/effective-permissions";

vi.mock("@/lib/db", () => ({
  prisma: { rolePermission: { findMany: vi.fn() } },
}));

describe("resolveEffectivePermissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns role permissions without querying when the user has no custom role", async () => {
    const permissions = await resolveEffectivePermissions({
      userId: "u_1",
      roles: ["viewer"],
      assignedRoleKeys: ["viewer"],
    });

    expect(permissions).toContain("storage:read");
    expect(permissions).not.toContain("docker:manage");
    // The common case must not add a round trip to every authenticated request.
    expect(vi.mocked(prisma.rolePermission.findMany)).not.toHaveBeenCalled();
  });

  it("adds the direct grants stored on the per-user custom role", async () => {
    vi.mocked(prisma.rolePermission.findMany).mockResolvedValue([
      { permission: { key: "docker:manage" } },
    ] as never);

    const permissions = await resolveEffectivePermissions({
      userId: "u_1",
      roles: ["viewer"],
      assignedRoleKeys: ["viewer", customRoleKey("u_1")],
    });

    expect(permissions).toContain("docker:manage");
    // Base role permissions survive: direct grants are additive, never a replacement.
    expect(permissions).toContain("storage:read");
    expect(vi.mocked(prisma.rolePermission.findMany)).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: { key: "user:u_1:custom" } } }),
    );
  });

  it("ignores a stored key that is no longer a shipped permission", async () => {
    vi.mocked(prisma.rolePermission.findMany).mockResolvedValue([
      { permission: { key: "docker:manage" } },
      { permission: { key: "legacy:superpower" } },
    ] as never);

    const permissions = await resolveEffectivePermissions({
      userId: "u_1",
      roles: [],
      assignedRoleKeys: [customRoleKey("u_1")],
    });

    expect(permissions).toEqual(["docker:manage"]);
  });

  it("de-duplicates a grant the base role already provides", async () => {
    vi.mocked(prisma.rolePermission.findMany).mockResolvedValue([
      { permission: { key: "storage:read" } },
    ] as never);

    const permissions = await resolveEffectivePermissions({
      userId: "u_1",
      roles: ["viewer"],
      assignedRoleKeys: ["viewer", customRoleKey("u_1")],
    });

    expect(permissions.filter((key) => key === "storage:read")).toHaveLength(1);
  });
});
