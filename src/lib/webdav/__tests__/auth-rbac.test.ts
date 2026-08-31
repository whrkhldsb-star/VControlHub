/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The same boundary as auth.test.ts, but with the REAL role→permission mapping
 * instead of a mocked `sessionHasPermission`. auth.test.ts can only prove the
 * permission check is reached; this file proves the mapping behind it actually
 * separates a storage manager from a viewer, so a scope-carrying token cannot
 * grant its owner more than the owner's roles do.
 */

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  loadApiTokenOwnerSession: vi.fn(),
}));

vi.mock("@/lib/api-token/service", () => ({ verifyApiToken: mocks.verifyApiToken }));
vi.mock("@/lib/api-token/authorization", () => ({
  loadApiTokenOwnerSession: mocks.loadApiTokenOwnerSession,
}));

const { authenticateWebDavRequest } = await import("../auth");

function request() {
  return new Request("https://hub.example/api/webdav/node1/a.txt", {
    headers: { authorization: "Bearer vca_tok_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  });
}

function ownerWithRoles(roles: string[]) {
  return {
    userId: "user-1",
    username: "someone",
    roles,
    mustChangePassword: false,
    currentTeamId: null,
  };
}

describe("WebDAV authentication against real RBAC", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyApiToken.mockResolvedValue({
      userId: "user-1",
      tokenId: "token-1",
      scopes: ["storage:write"],
    });
  });

  it("accepts a write token whose owner still holds storage write access", async () => {
    mocks.loadApiTokenOwnerSession.mockResolvedValue(ownerWithRoles(["storage_manager"]));

    await expect(authenticateWebDavRequest(request(), "PUT")).resolves.toMatchObject({
      tokenId: "token-1",
    });
  });

  it("rejects the same token once the owner is demoted to viewer", async () => {
    // The token is unchanged and still scoped storage:write — revoking the role
    // has to be enough to stop it, or role changes would not take effect until
    // every issued token was rotated.
    mocks.loadApiTokenOwnerSession.mockResolvedValue(ownerWithRoles(["viewer"]));

    await expect(authenticateWebDavRequest(request(), "PUT")).rejects.toThrow(
      /Invalid or insufficient|WebDAV/,
    );
  });

  it("still allows that viewer to read", async () => {
    mocks.loadApiTokenOwnerSession.mockResolvedValue(ownerWithRoles(["viewer"]));

    await expect(authenticateWebDavRequest(request(), "PROPFIND")).resolves.toMatchObject({
      tokenId: "token-1",
    });
  });

  it("rejects an owner whose roles list is empty", async () => {
    mocks.loadApiTokenOwnerSession.mockResolvedValue(ownerWithRoles([]));

    await expect(authenticateWebDavRequest(request(), "GET")).rejects.toThrow(
      /Invalid or insufficient|WebDAV/,
    );
  });
});
