import { expect, it, vi } from "vitest";
const sessions = vi.hoisted(() => ({ account: vi.fn(), team: vi.fn() }));
vi.mock("@/lib/api-token/authorization", () => ({ loadApiTokenOwnerSession: sessions.account, loadJobOwnerSession: sessions.team }));
import { assertRequesterMayExecuteCommand } from "@/lib/auth/command-execution-authz";

it("requires current create permission in the schedule's team even when approval is required", async () => {
  const account = { userId: "creator", roles: [], permissions: ["command:create"] };
  sessions.account.mockResolvedValue(account);
  sessions.team.mockResolvedValueOnce({ ...account, permissions: ["command:read"] }).mockResolvedValueOnce(account);
  const submit = () => assertRequesterMayExecuteCommand("creator", "owner-team", undefined, { requireExecutePermission: false });
  expect(await submit()).toMatchObject({ ok: false, reason: expect.stringContaining("command:create") });
  expect(await submit()).toEqual({ ok: true });
  expect(sessions.team).toHaveBeenCalledWith("creator", "owner-team", expect.anything());
});
