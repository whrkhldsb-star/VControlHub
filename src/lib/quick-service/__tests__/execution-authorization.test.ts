import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ load: vi.fn(), server: vi.fn() }));
vi.mock("@/lib/api-token/authorization", () => ({ loadApiTokenOwnerSession: state.load }));
vi.mock("@/lib/db", () => ({ prisma: { server: { findFirst: state.server } } }));
vi.mock("../docker-cli", () => ({ HUB_HOST_INSTANCE_KEY: "hub-host" }));
import { assertQuickServiceExecutionAuthorized } from "../execution-authorization";
import { t } from "@/lib/i18n/service-translations";

const actor = { userId: "requester", username: "requester", roles: ["operator"], permissions: ["docker:manage"], currentTeamId: "team" };
beforeEach(() => { state.load.mockReset(); state.server.mockReset(); state.load.mockResolvedValue(actor); state.server.mockResolvedValue({ id: "node" }); });
it("checks live account, workspace permission and node access before execution", async () => {
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, { instanceKey: "node", serverId: "node" })).resolves.toBeUndefined();
  expect(state.load).toHaveBeenNthCalledWith(2, "requester", "team");
  expect(state.server).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [expect.objectContaining({ enabled: true }), expect.any(Object)] } }));
});
it.each(["disabled", "removed", "demoted", "node-disabled"])("rejects a queued Docker operation after %s", async (reason) => {
  if (reason === "disabled") state.load.mockResolvedValueOnce(null);
  if (reason === "removed") state.load.mockResolvedValueOnce(actor).mockResolvedValueOnce(null);
  if (reason === "demoted") state.load.mockResolvedValueOnce(actor).mockResolvedValueOnce({ ...actor, permissions: [] });
  if (reason === "node-disabled") state.server.mockResolvedValue(null);
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, { instanceKey: "node" })).rejects.toThrow();
});
it("requires a current platform administrator for hub Docker work", async () => {
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, {})).rejects.toThrow(t("backend.quickService.platformRequired"));
  state.load.mockResolvedValue({ ...actor, roles: ["admin"] });
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, {})).resolves.toBeUndefined();
});
it("refuses an anonymous requester or conflicting target identifiers", async () => {
  await expect(assertQuickServiceExecutionAuthorized({}, { instanceKey: "node" })).rejects.toThrow(t("backend.quickService.requesterMissing"));
  await expect(assertQuickServiceExecutionAuthorized({ createdBy: "requester", teamId: "team" }, { instanceKey: "node", serverId: "different-node" })).rejects.toThrow(t("backend.quickService.targetMismatch"));
});
