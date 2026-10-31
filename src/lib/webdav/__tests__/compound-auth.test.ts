import { expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ prisma: { storageNode: { findFirst: async () => ({ id: "n" }) }, userStorageAccess: { findMany: async () => [] } } }));
vi.mock("@/lib/api-token/service", () => ({ verifyApiToken: async () => ({ userId: "u", teamId: "t", tokenId: "token", scopes: ["storage:read", "storage:write", "storage:delete"] }) }));
vi.mock("@/lib/api-token/authorization", () => ({ loadApiTokenOwnerSession: async () => ({ userId: "u", username: "u", roles: [], currentTeamId: "t", mustChangePassword: false, permissions: ["storage:read", "storage:write", "storage:delete"] }) }));
const { authenticateWebDavRequest } = await import("../auth");
const { assertStorageAccess } = await import("@/lib/storage/access-control");
it("preserves compound COPY and MOVE permissions without platform roles", async () => {
  const auth = await authenticateWebDavRequest(new Request("http://local/api/webdav/n/source.txt", { headers: { authorization: "Bearer audit" } }), "COPY");
  expect(auth.session.roles).toEqual([]);
  expect(auth.session.permissions).toEqual(["storage:read", "storage:write", "storage:delete"]);
  const source = await assertStorageAccess({ session: auth.session, storageNodeId: "n", relativePath: "source.txt", operation: "read" });
  expect(source.allowed).toBe(true);
  const overwrite = await assertStorageAccess({ session: auth.session, storageNodeId: "n", relativePath: "dest", operation: "delete" });
  expect(overwrite.allowed).toBe(true);
});
