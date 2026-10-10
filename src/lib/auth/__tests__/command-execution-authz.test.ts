import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionPayload } from "../session";

const loadApiTokenOwnerSession = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-token/authorization", () => ({ loadApiTokenOwnerSession }));

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

  it("rejects removed membership and unassigned jobs", async () => {
    loadApiTokenOwnerSession.mockResolvedValueOnce(session(["command:execute"])).mockResolvedValueOnce(null);
    expect((await assertRequesterMayExecuteCommand("user-1", "team-b")).ok).toBe(false);
    loadApiTokenOwnerSession.mockResolvedValueOnce(session(["command:execute"]));
    expect((await assertRequesterMayExecuteCommand("user-1", null)).ok).toBe(false);
  });

  it("lets a platform administrator execute without a target membership", async () => {
    loadApiTokenOwnerSession.mockResolvedValueOnce(session(["command:execute"], ["admin"]));
    expect(await assertRequesterMayExecuteCommand("user-1", "team-b")).toEqual({ ok: true });
    expect(loadApiTokenOwnerSession).toHaveBeenCalledTimes(1);
  });
});
