import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ load: vi.fn(), server: vi.fn() }));
const { jobOwner } = vi.hoisted(() => ({ jobOwner: (load: (userId: string, teamId?: string) => Promise<{ roles: string[] } | null>) =>
  async (userId: string, teamId: string | null | undefined) => {
    if (teamId) return load(userId, teamId);
    const account = await load(userId);
    return account && account.roles.includes("admin") ? { ...account, currentTeamId: null } : account;
  } }));
vi.mock("@/lib/api-token/authorization", () => ({ loadApiTokenOwnerSession: state.load, loadJobOwnerSession: jobOwner(state.load) }));
vi.mock("@/lib/db", () => ({ prisma: { server: { findFirst: state.server } } }));
import { assertQuickServiceExecutionAuthorized } from "../execution-authorization";
import { t } from "@/lib/i18n/service-translations";

import { quickServiceEndpointFingerprint } from "../target-identity";
const endpoint = { host: "node.test", port: 22, username: "root", managementMode: "DIRECT", hostKeySha256: "pin", agentTokenHash: null } as const;
const actor = { userId: "requester", username: "requester", roles: ["operator"], permissions: ["docker:manage"], currentTeamId: "team" };
beforeEach(() => { state.load.mockReset(); state.server.mockReset(); state.load.mockResolvedValue(actor); state.server.mockResolvedValue({ ...endpoint, teamId: "team" }); });
it("checks live account, workspace permission and node access before execution", async () => {
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, { action: "install", instanceKey: "node", serverId: "node", endpointFingerprint: quickServiceEndpointFingerprint(endpoint) })).resolves.toEqual({ kind: "remote", serverId: "node", expectedTeamId: "team", endpoint });
  expect(state.load).toHaveBeenNthCalledWith(2, "requester", "team");
  expect(state.server).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [expect.objectContaining({ enabled: true }), expect.any(Object)] } }));
});
it("requires a fresh submission for a remote legacy job without an endpoint", async () => {
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: actor.userId, teamId: "team" }, { action: "update", instanceKey: "node", serverId: "node" })).rejects.toThrow(t("backend.command.connectionChanged"));
});
it.each(["disabled", "removed", "demoted", "node-disabled"])("rejects a queued Docker operation after %s", async (reason) => {
  if (reason === "disabled") state.load.mockResolvedValueOnce(null);
  if (reason === "removed") state.load.mockResolvedValueOnce(actor).mockResolvedValueOnce(null);
  if (reason === "demoted") state.load.mockResolvedValueOnce(actor).mockResolvedValueOnce({ ...actor, permissions: [] });
  if (reason === "node-disabled") state.server.mockResolvedValue(null);
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, { action: "install", instanceKey: "node", serverId: "node" })).rejects.toThrow();
});
it("requires a current platform administrator for hub Docker work", async () => {
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, { action: "update" })).rejects.toThrow(t("backend.quickService.platformRequired"));
  state.load.mockResolvedValue({ ...actor, roles: ["admin"] });
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, { action: "update" })).resolves.toEqual({ kind: "local" });
});
it("refuses an anonymous requester or conflicting target identifiers", async () => {
  await expect(assertQuickServiceExecutionAuthorized({}, { action: "install", instanceKey: "node", serverId: "node" })).rejects.toThrow(t("backend.quickService.requesterMissing"));
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, { action: "install", instanceKey: "node", serverId: "different-node" })).rejects.toThrow(t("backend.quickService.targetMismatch"));
});

it.each([
  { instanceKey: "hub-host", serverId: "node" },
  { instanceKey: "node", serverId: null },
])("rejects inconsistent target identifiers before checking permissions: %j", async (identity) => {
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, { ...identity, action: "update" }))
    .rejects.toThrow(t("backend.quickService.targetMismatch"));
  expect(state.server).not.toHaveBeenCalled();
});

it.each(["install", "update", "uninstall", "start", "stop", "sync"] as const)("requires live manage capability for %s", async action => {
  // The account can still connect, but its per-node manage permission has been revoked.
  state.server.mockImplementation(async ({ where }) => JSON.stringify(where).includes('"canManage":true') ? null : { teamId: "team" });
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: actor.userId, teamId: "team" }, { action, instanceKey: "node", serverId: "node" }))
    .rejects.toThrow(t("backend.quickService.targetInaccessible"));
});

it("rejects an endpoint changed after enqueue even with manage access to the same customer", async () => {
  const { quickServiceEndpointFingerprint } = await import("../target-identity");
  const endpoint = { host: "old.example", port: 22, username: "admin", hostKeySha256: "pin", managementMode: "DIRECT", agentTokenHash: null } as const;
  state.server.mockResolvedValue({ teamId: "team", ...endpoint, host: "new.example" });
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: actor.userId, teamId: "team" }, {
    action: "install", instanceKey: "node", serverId: "node", endpointFingerprint: quickServiceEndpointFingerprint(endpoint),
  })).rejects.toThrow(t("backend.command.connectionChanged"));
});
