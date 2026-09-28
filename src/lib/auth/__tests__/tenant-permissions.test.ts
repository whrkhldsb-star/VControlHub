import { describe, expect, it } from "vitest";

import { scopePermissionsToWorkspace } from "../tenant-permissions";

describe("workspace permission scope", () => {
  const accountPermissions = [
    "team:create", "team:read", "server:read", "server:write", "storage:read", "storage:write",
  ] as const;

  it("preserves existing memberships until an access role is selected", () => {
    expect(scopePermissionsToWorkspace({
      roles: ["operator"], accountPermissions: [...accountPermissions],
      membership: { role: "member", accessRole: "inherit" },
    })).toContain("server:write");
  });

  it("narrows one workspace to viewer while another can retain operator access", () => {
    const common = { roles: ["operator"] as const, accountPermissions: [...accountPermissions] };
    const viewer = scopePermissionsToWorkspace({ ...common, roles: [...common.roles], membership: { role: "member", accessRole: "viewer" } });
    const operator = scopePermissionsToWorkspace({ ...common, roles: [...common.roles], membership: { role: "member", accessRole: "operator" } });
    expect(viewer).toContain("server:read");
    expect(viewer).not.toContain("server:write");
    expect(operator).toContain("server:write");
  });

  it("never raises account permissions through a workspace role", () => {
    const scoped = scopePermissionsToWorkspace({
      roles: ["viewer"], accountPermissions: ["team:read", "server:read"],
      membership: { role: "member", accessRole: "operator" },
    });
    expect(scoped).not.toContain("server:write");
  });

  it("keeps whole-platform backup operations out of tenant roles", () => {
    const scoped = scopePermissionsToWorkspace({
      roles: ["operator"],
      accountPermissions: ["backup:create", "backup:read", "backup:restore", "team:read"],
      membership: { role: "member", accessRole: "inherit" },
    });
    expect(scoped).toEqual(["team:read"]);
  });

  it("grants owners full workspace access regardless of their account base role", () => {
    const owner = scopePermissionsToWorkspace({
      roles: ["viewer"], accountPermissions: ["team:read", "server:read"],
      membership: { role: "owner", accessRole: "viewer" },
    });
    expect(owner).toContain("team:member:manage");
    expect(owner).toContain("server:write");
    expect(owner).toContain("storage:manage-node");
    expect(owner).toContain("api-token:manage");
    expect(owner).not.toContain("team:manage");
    expect(owner).not.toContain("backup:restore");
    const removed = scopePermissionsToWorkspace({
      roles: ["viewer"], accountPermissions: ["team:read", "server:read"], membership: null,
    });
    expect(removed).not.toContain("server:read");
  });

  it("does not let an assigned group narrow a workspace administrator", () => {
    const scoped = scopePermissionsToWorkspace({
      roles: ["viewer"],
      accountPermissions: ["team:read", "server:read"],
      membership: {
        role: "admin",
        accessRole: "viewer",
        permissionTemplate: { teamId: "team_1", roleKeys: ["viewer"], permissions: [] },
      },
    });
    expect(scoped).toContain("server:ssh");
    expect(scoped).toContain("server:write");
    expect(scoped).toContain("team:member:manage");
  });

  it("does not let an ordinary member manage team membership through an account grant", () => {
    const scoped = scopePermissionsToWorkspace({
      roles: ["operator"], accountPermissions: ["team:member:manage", "team:read"],
      membership: { role: "member", accessRole: "inherit" },
    });
    expect(scoped).toEqual(["team:read"]);
  });

  it("applies an assigned editable group as a live workspace ceiling", () => {
    const scoped = scopePermissionsToWorkspace({
      roles: ["operator"],
      accountPermissions: ["server:read", "server:ssh", "server:write", "storage:read"],
      membership: {
        role: "member", accessRole: "inherit",
        permissionTemplate: { teamId: "team_1", roleKeys: [], permissions: ["server:read", "server:ssh"] },
      },
    });
    expect(scoped).toContain("server:read");
    expect(scoped).toContain("server:ssh");
    expect(scoped).not.toContain("server:write");
    expect(scoped).not.toContain("storage:read");
  });

  it("never lets a group grant permissions the account lacks", () => {
    const scoped = scopePermissionsToWorkspace({
      roles: ["viewer"], accountPermissions: ["server:read"],
      membership: {
        role: "member", accessRole: "inherit",
        permissionTemplate: { teamId: "team_1", roleKeys: ["operator"], permissions: ["server:ssh"] },
      },
    });
    expect(scoped).toEqual(["server:read"]);
  });
});
