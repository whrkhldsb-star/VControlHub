import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "../session";

const loadApiTokenOwnerSession = vi.hoisted(() => vi.fn());
const { jobOwner } = vi.hoisted(() => ({ jobOwner: (load: (userId: string, teamId?: string) => Promise<{ roles: string[] } | null>) =>
  async (userId: string, teamId: string | null | undefined) => {
    if (teamId) return load(userId, teamId);
    const account = await load(userId);
    return account && account.roles.includes("admin") ? { ...account, currentTeamId: null } : account;
  } }));
vi.mock("@/lib/api-token/authorization", () => ({ loadApiTokenOwnerSession, loadJobOwnerSession: jobOwner(loadApiTokenOwnerSession) }));

import { assertRequesterMayExecuteCommand } from "../command-execution-authz";

const session = (permissions: SessionPayload["permissions"], roles: SessionPayload["roles"] = ["operator"]): SessionPayload => ({
  userId: "user-1",
  username: "operator",
  roles,
  permissions,
  currentTeamId: "team-a",
  mustChangePassword: false,
});

describe("background command authorization", () => {
  beforeEach(() => loadApiTokenOwnerSession.mockReset());

  it("checks the target customer even when another customer permits commands", async () => {
    loadApiTokenOwnerSession
      .mockResolvedValueOnce(session(["command:execute"]))
      .mockResolvedValueOnce(session(["command:read"]));

    expect(await assertRequesterMayExecuteCommand("user-1", "team-b")).toEqual({
      ok: false,
      reason: "command requester lacks command:execute permission in the target team",
    });
    expect(loadApiTokenOwnerSession).toHaveBeenNthCalledWith(2, "user-1", "team-b");
  });

  it("lets a member who may only create requests run a command a reviewer approved, but not an unreviewed one", async () => {
    loadApiTokenOwnerSession.mockResolvedValue(session(["command:create", "command:read"]));

    // Unattended: nobody approved it, so the requester's own authority is what runs it.
    expect(await assertRequesterMayExecuteCommand("user-1", "team-a")).toEqual({
      ok: false,
      reason: "command requester lacks command:execute permission in the target team",
    });
    // Approved: the reviewer's decision authorizes it. Account validity and membership still apply.
    expect(await assertRequesterMayExecuteCommand("user-1", "team-a", undefined, { requireExecutePermission: false })).toEqual({ ok: true });
    loadApiTokenOwnerSession.mockResolvedValueOnce(session(["command:create"])).mockResolvedValueOnce(null);
    expect((await assertRequesterMayExecuteCommand("user-1", "team-a", undefined, { requireExecutePermission: false })).ok).toBe(false);
  });

  it("rejects removed membership and unassigned jobs", async () => {
    loadApiTokenOwnerSession.mockResolvedValueOnce(session(["command:execute"])).mockResolvedValueOnce(null);
    expect((await assertRequesterMayExecuteCommand("user-1", "team-b")).ok).toBe(false);
    loadApiTokenOwnerSession.mockResolvedValueOnce(session(["command:execute"]));
    expect((await assertRequesterMayExecuteCommand("user-1", null)).ok).toBe(false);
  });

  it("lets a platform administrator execute without a target membership, scoped to the command's customer", async () => {
    loadApiTokenOwnerSession.mockResolvedValue(session(["command:execute"], ["admin"]));
    expect(await assertRequesterMayExecuteCommand("user-1", "team-b")).toEqual({ ok: true });
    // Not the customer the administrator has selected in the console.
    expect(loadApiTokenOwnerSession).toHaveBeenLastCalledWith("user-1", "team-b");
  });
});
