/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WebDAV is reachable without a session cookie, so this module is the whole
 * authentication boundary: it must derive the acting session from the token
 * owner (never from the Basic username) and it must gate on BOTH the token's
 * scopes and the owner's RBAC permission — a token cannot grant its owner more
 * than the owner has.
 */

const mocks = vi.hoisted(() => ({
  verifyApiToken: vi.fn(),
  loadApiTokenOwnerSession: vi.fn(),
  sessionHasPermission: vi.fn(),
}));

vi.mock("@/lib/api-token/service", () => ({ verifyApiToken: mocks.verifyApiToken }));
vi.mock("@/lib/api-token/authorization", () => ({
  loadApiTokenOwnerSession: mocks.loadApiTokenOwnerSession,
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: mocks.sessionHasPermission,
}));

const {
  authenticateWebDavRequest,
  webDavScopeForMethod,
  webDavTokenAllows,
  webDavUnauthorizedResponse,
} = await import("../auth");

function request(headers: Record<string, string> = {}) {
  return new Request("https://hub.example/api/webdav/node1/a.txt", { headers });
}

const OWNER = { userId: "u1", username: "alice", roles: ["operator"], currentTeamId: "team_a" };

describe("webDavScopeForMethod", () => {
  it("maps every mutating verb to write and DELETE to delete", () => {
    expect(webDavScopeForMethod("GET")).toBe("read");
    expect(webDavScopeForMethod("propfind")).toBe("read");
    expect(webDavScopeForMethod("HEAD")).toBe("read");
    expect(webDavScopeForMethod("PUT")).toBe("write");
    expect(webDavScopeForMethod("MKCOL")).toBe("write");
    expect(webDavScopeForMethod("MOVE")).toBe("write");
    expect(webDavScopeForMethod("COPY")).toBe("write");
    expect(webDavScopeForMethod("PROPPATCH")).toBe("write");
    expect(webDavScopeForMethod("DELETE")).toBe("delete");
  });

  it("treats an unknown verb as read rather than as a mutation", () => {
    // Fail-closed direction: an unrecognised verb must not be handed write scope.
    expect(webDavScopeForMethod("LOCK")).toBe("read");
  });
});

describe("webDavTokenAllows", () => {
  it("lets a write or delete scope imply read", () => {
    expect(webDavTokenAllows(["storage:write"], "read")).toBe(true);
    expect(webDavTokenAllows(["storage:delete"], "read")).toBe(true);
    expect(webDavTokenAllows(["read"], "read")).toBe(true);
  });

  it("never lets read imply write, nor write imply delete", () => {
    expect(webDavTokenAllows(["storage:read"], "write")).toBe(false);
    expect(webDavTokenAllows(["read"], "write")).toBe(false);
    expect(webDavTokenAllows(["storage:write"], "delete")).toBe(false);
  });

  it("ignores unrelated scopes", () => {
    expect(webDavTokenAllows(["servers:read", "ai:ops:manage"], "read")).toBe(false);
  });

  it("treats no scope name as a wildcard", () => {
    // "admin" and "*" read like blanket grants but must carry no storage rights.
    expect(webDavTokenAllows(["admin"], "delete")).toBe(false);
    expect(webDavTokenAllows(["admin"], "read")).toBe(false);
    expect(webDavTokenAllows(["*"], "read")).toBe(false);
    expect(webDavTokenAllows([], "read")).toBe(false);
  });
});

describe("authenticateWebDavRequest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.verifyApiToken.mockResolvedValue({
      userId: "u1",
      tokenId: "tok_1",
      scopes: ["storage:write"],
    });
    mocks.loadApiTokenOwnerSession.mockResolvedValue(OWNER);
    mocks.sessionHasPermission.mockReturnValue(true);
  });

  it("accepts a Bearer token and returns the owner's session, not the caller's claim", async () => {
    const auth = await authenticateWebDavRequest(
      request({ authorization: "Bearer vch_secret_token" }),
      "PUT",
    );

    expect(mocks.verifyApiToken).toHaveBeenCalledWith("vch_secret_token");
    expect(auth.session).toBe(OWNER);
    expect(auth.tokenId).toBe("tok_1");
  });

  it("takes the token from the Basic password and ignores the username entirely", async () => {
    const encoded = Buffer.from("anything-at-all:vch_secret_token").toString("base64");

    const auth = await authenticateWebDavRequest(
      request({ authorization: `Basic ${encoded}` }),
      "GET",
    );

    // The username is a display field for WebDAV clients; only the password is a
    // credential, so a caller cannot select whose session they act as.
    expect(mocks.verifyApiToken).toHaveBeenCalledWith("vch_secret_token");
    expect(auth.session).toBe(OWNER);
  });

  it("keeps a colon inside the token when splitting Basic credentials", async () => {
    const encoded = Buffer.from("user:vch:with:colons").toString("base64");

    await authenticateWebDavRequest(request({ authorization: `Basic ${encoded}` }), "GET");

    expect(mocks.verifyApiToken).toHaveBeenCalledWith("vch:with:colons");
  });

  it("rejects a token whose scopes do not cover the verb, before loading any session", async () => {
    mocks.verifyApiToken.mockResolvedValue({
      userId: "u1",
      tokenId: "tok_1",
      scopes: ["storage:read"],
    });

    await expect(
      authenticateWebDavRequest(request({ authorization: "Bearer t" }), "DELETE"),
    ).rejects.toThrow(/Invalid or insufficient/);
    expect(mocks.loadApiTokenOwnerSession).not.toHaveBeenCalled();
  });

  it("rejects when the owner lacks the RBAC permission even though the token has the scope", async () => {
    mocks.sessionHasPermission.mockReturnValue(false);

    await expect(
      authenticateWebDavRequest(request({ authorization: "Bearer t" }), "PUT"),
    ).rejects.toThrow(/Invalid or insufficient/);
    // A token must not out-rank its owner: the scope said write, RBAC said no.
    expect(mocks.sessionHasPermission).toHaveBeenCalledWith(OWNER, "storage:write");
  });

  it("rejects when the token is valid but its owner has no usable session", async () => {
    mocks.loadApiTokenOwnerSession.mockResolvedValue(null);

    await expect(
      authenticateWebDavRequest(request({ authorization: "Bearer t" }), "GET"),
    ).rejects.toThrow(/Invalid or insufficient/);
  });

  it("rejects an empty Basic password without consulting the token store", async () => {
    await expect(
      authenticateWebDavRequest(
        request({ authorization: `Basic ${Buffer.from("user:").toString("base64")}` }),
        "GET",
      ),
    ).rejects.toThrow(/Invalid or insufficient/);
    expect(mocks.verifyApiToken).not.toHaveBeenCalled();
  });

  it("rejects undecodable Basic material as an auth failure, not a crash", async () => {
    await expect(
      authenticateWebDavRequest(request({ authorization: "Basic ****" }), "GET"),
    ).rejects.toThrow(/Invalid/);
  });

  it("rejects a missing or unsupported scheme", async () => {
    // "Bearer" with no token lands here too: header normalisation strips the
    // trailing space, so it never matches the "Bearer " prefix.
    await expect(authenticateWebDavRequest(request(), "GET")).rejects.toThrow(
      /requires Bearer or Basic/,
    );
    await expect(
      authenticateWebDavRequest(request({ authorization: "Bearer" }), "GET"),
    ).rejects.toThrow(/requires Bearer or Basic/);
    await expect(
      authenticateWebDavRequest(request({ authorization: "Digest abc" }), "GET"),
    ).rejects.toThrow(/requires Bearer or Basic/);
  });
});

describe("webDavUnauthorizedResponse", () => {
  it("advertises Basic so a mounted drive prompts for credentials", () => {
    const response = webDavUnauthorizedResponse();

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain('Basic realm="VControlHub WebDAV"');
    expect(response.headers.get("DAV")).toBe("1");
  });
});
