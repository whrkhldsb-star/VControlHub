import { describe, expect, it } from "vitest";

import {
  DEFAULT_ROLE_PERMISSIONS,
  ALL_PERMISSIONS,
  isProtectedByApproval,
} from "@/lib/auth/rbac";

describe("RBAC defaults", () => {
  it("grants admin every permission by default", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.admin).toEqual(ALL_PERMISSIONS);
  });

  it("keeps viewer read-only", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.viewer).toEqual([
      "ai:chat",
      "audit:read",
      "backup:read",
      "command:read",
      "deploy:read",
      "health:read",
      "server:read",
      "share:read",
      "storage:read",
      "task:read",
      "ticket:create",
      "ticket:read",
      "user:read",
    ]);
  });

  it("lets operators manage Quick Services via docker:manage without broad user management", () => {
    expect(DEFAULT_ROLE_PERMISSIONS.operator).toContain("docker:manage");
    expect(DEFAULT_ROLE_PERMISSIONS.operator).not.toContain("user:manage");
    expect(DEFAULT_ROLE_PERMISSIONS.viewer).not.toContain("docker:manage");
  });

  it("requires approval for assistant initiated destructive or command actions", () => {
    expect(
      isProtectedByApproval({
        actorType: "assistant",
        actionType: "command.execute",
      }),
    ).toBe(true);

    expect(
      isProtectedByApproval({
        actorType: "assistant",
        actionType: "storage.delete",
      }),
    ).toBe(true);
  });

  it("does not require approval for direct user initiated in-app operations", () => {
    expect(
      isProtectedByApproval({
        actorType: "user",
        actionType: "command.execute",
      }),
    ).toBe(false);

    expect(
      isProtectedByApproval({
        actorType: "user",
        actionType: "storage.delete",
      }),
    ).toBe(false);
  });
});
