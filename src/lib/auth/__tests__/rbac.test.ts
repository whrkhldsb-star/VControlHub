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
      "audit:read",
      "command:read",
      "server:read",
      "storage:read",
      "user:read",
    ]);
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
