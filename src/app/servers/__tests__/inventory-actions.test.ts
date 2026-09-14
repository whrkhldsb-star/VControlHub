import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ permission: vi.fn(), targets: vi.fn() }));
vi.mock("@/lib/auth/authorization", () => ({ requirePermission: mocks.permission }));
vi.mock("@/lib/server/inventory", () => ({ getServerOperationTargets: mocks.targets }));
import { loadServerOperationTargets } from "../inventory-actions";
beforeEach(() => vi.resetAllMocks());
it.each(["command", "batch"] as const)("checks read and operation permission before loading %s targets", async (kind) => {
  const session = { userId: "u1", roles: ["viewer"], currentTeamId: "t1" };
  mocks.permission.mockResolvedValue(session);
  mocks.targets.mockResolvedValue([]);
  await loadServerOperationTargets(kind);
  expect(mocks.permission).toHaveBeenNthCalledWith(1, "server:read");
  expect(mocks.permission).toHaveBeenNthCalledWith(2, kind === "command" ? "command:create" : "server:write");
  expect(mocks.targets).toHaveBeenCalledWith(session, kind, {});
});
it("never queries targets after revoked permission", async () => {
  mocks.permission.mockRejectedValue(new Error("Forbidden"));
  await expect(loadServerOperationTargets("batch")).rejects.toThrow("Forbidden");
  expect(mocks.targets).not.toHaveBeenCalled();
});
