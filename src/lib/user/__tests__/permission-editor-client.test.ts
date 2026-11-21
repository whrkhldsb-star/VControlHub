import { expect, it, vi } from "vitest";
import { permissionChanges } from "../permission-editor-client";
import { csrfFetch } from "@/lib/auth/csrf-client";

const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http/api-client", () => ({ apiRequest: request }));

it("submits the edited storage node and the version loaded by this editor", () => {
  const original = { storageNodeId: "node", canRead: true };
  const server = { serverId: "server", canRead: false };
  const baseline = { version: "read-version", user: { id: "u", storageAccess: [original], serverAccess: [server] } };
  expect(permissionChanges(baseline, {
    userId: "u", storageAccess: [], storageAccessScopeIds: ["node", "unchanged"],
    serverAccess: [server], serverAccessScopeIds: ["server", "inherits"],
  })).toEqual({ userId: "u", version: "read-version", storageAccess: [], storageAccessScopeIds: ["node"] });
});

it("keeps the document's edit version across a separate search and advances it only after a successful save", async () => {
  const url = "/api/users/permissions";
  const server = { serverId: "one", canRead: true };
  const initial = { version: "original", user: { id: "u", storageAccess: [], serverAccess: [server] } };
  const write = (rows: typeof server[]) => csrfFetch(url, {
    method: "PATCH", body: JSON.stringify({ userId: "u", serverAccessScopeIds: ["one"], serverAccess: rows }),
  });
  request.mockResolvedValueOnce(initial).mockResolvedValueOnce({ ...initial, version: "search-result" });
  await csrfFetch(url + "?userId=u");
  await csrfFetch(url + "?userId=u&pageSize=1");
  request.mockRejectedValueOnce(new Error("conflict"));
  await expect(write([])).rejects.toThrow("conflict");
  const lastPatch = () => JSON.parse(request.mock.lastCall![1].body);
  expect(lastPatch()).toEqual({ userId: "u", version: "original", serverAccess: [], serverAccessScopeIds: ["one"] });
  request.mockResolvedValueOnce({ success: true, version: "committed" });
  await write([]);
  expect(lastPatch().version).toBe("original");
  request.mockResolvedValueOnce({ success: true, version: "next" });
  await write([]);
  expect(lastPatch()).toEqual({ userId: "u", version: "committed" });
});
