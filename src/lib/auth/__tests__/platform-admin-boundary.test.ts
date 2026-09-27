import { describe, expect, it } from "vitest";

import { sessionHasPermission } from "../authorization";
import { isGlobalTeamManager, teamWhere } from "../team-scope";
import type { Permission, RoleKey } from "../rbac";

describe("platform admin boundary", () => {
  it("does not turn a direct team:manage grant into cross-workspace access", () => {
    const delegated = {
      userId: "user_1",
      roles: ["viewer"] as RoleKey[],
      permissions: ["team:manage", "server:read"] as Permission[],
      currentTeamId: "team_1",
    };
    expect(sessionHasPermission(delegated, "team:manage")).toBe(false);
    expect(isGlobalTeamManager(delegated)).toBe(false);
    expect(teamWhere(delegated)).toEqual({ teamId: "team_1" });
  });

  it("keeps a scoped bearer token from inheriting the creator's platform role", () => {
    expect(sessionHasPermission({ roles: [], permissions: ["team:manage"] }, "team:manage")).toBe(false);
  });

  it("reserves shared account and backup operations for platform administrators", () => {
    const delegated = { roles: ["operator"] as RoleKey[], permissions: ["user:manage", "role:manage", "announcement:manage", "backup:create", "backup:read", "backup:restore"] as Permission[] };
    for (const permission of delegated.permissions) {
      expect(sessionHasPermission(delegated, permission)).toBe(false);
      expect(sessionHasPermission({ ...delegated, roles: ["admin"] }, permission)).toBe(true);
    }
  });
});
