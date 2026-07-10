import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    listApiTokens: vi.fn(),
    createApiToken: vi.fn(),
    revokeApiToken: vi.fn(),
    auditUserAction: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/api-token/service", () => ({
  listApiTokens: mocks.listApiTokens,
  createApiToken: mocks.createApiToken,
  revokeApiToken: mocks.revokeApiToken,
  ALLOWED_API_TOKEN_SCOPES: [
    "read",
    "server:read",
    "storage:read",
    "health:read",
    "status:read",
  ],
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));

const route = await import("../route");

const session = { userId: "u1", username: "alice", user: { id: "u1" } };

describe("/api/api-tokens", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.listApiTokens.mockResolvedValue([
      {
        id: "tok1",
        name: "cli",
        tokenPrefix: "whr_1234",
        tokenSuffix: "abcdef",
        scopes: ["read"],
        expiresAt: null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    ]);
    mocks.createApiToken.mockImplementation(async (input) => ({
      token: "whr_plain_once",
      apiToken: {
        id: "tok1",
        name: input.name,
        tokenPrefix: "whr_plai",
        tokenSuffix: "n_once",
        scopes: input.scopes,
        expiresAt: input.expiresAt ?? null,
        lastUsedAt: null,
        revokedAt: null,
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    }));
    mocks.revokeApiToken.mockResolvedValue({
      id: "tok1",
      tokenPrefix: "whr_plai",
      tokenSuffix: "n_once",
    });
  });

  it("lists safe token metadata without hashes or plaintext tokens", async () => {
    const res = await route.GET(new Request("http://local/api/api-tokens"));
    expect(res.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("api-token:manage");
    expect(mocks.listApiTokens).toHaveBeenCalledWith("u1");
    const body = await res.json();
    expect(body.tokens).toHaveLength(1);
    expect(JSON.stringify(body)).not.toContain("tokenHash");
    expect(JSON.stringify(body)).not.toContain("whr_plain_once");
  });

  it("rejects unknown scopes before creating a token", async () => {
    const req = new Request("http://local/api/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "cli",
        scopes: ["read", "admin:everything"],
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining("scope"),
    });
    expect(mocks.createApiToken).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON token creation with the shared bodySchema error envelope", async () => {
    const req = new Request("http://local/api/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    });

    const res = await route.POST(req);

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "Request body is not valid JSON" });
    expect(mocks.createApiToken).not.toHaveBeenCalled();
    expect(mocks.auditUserAction).not.toHaveBeenCalled();
  });

  it("creates a token, returns plaintext once, and writes audit metadata without the token", async () => {
    const expiresAt = new Date(Date.now() + 86_400_000).toISOString();
    const req = new Request("http://local/api/api-tokens", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: " cli ",
        scopes: ["read", "health:read"],
        expiresAt,
      }),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toBe("whr_plain_once");
    expect(body.apiToken).not.toHaveProperty("tokenHash");
    expect(mocks.createApiToken).toHaveBeenCalledWith({
      userId: "u1",
      name: "cli",
      scopes: ["read", "health:read"],
      expiresAt: new Date(expiresAt),
    });
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "api_token.create",
      expect.objectContaining({
        tokenId: "tok1",
        scopes: ["read", "health:read"],
      }),
    );
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain(
      "whr_plain_once",
    );
  });

  it("accepts browser form token creation and redirects back to the token page", async () => {
    const req = new Request("http://local/api/api-tokens", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "text/html",
      },
      body: new URLSearchParams([
        ["name", "mobile cli"],
        ["scopes", "read"],
        ["scopes", "status:read"],
      ]),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(
      "http://local/api-tokens?created=1",
    );
    expect(mocks.createApiToken).toHaveBeenCalledWith({
      userId: "u1",
      name: "mobile cli",
      scopes: ["read", "status:read"],
      expiresAt: null,
    });
  });

  it("revokes a token and records an audit event", async () => {
    const req = new Request("http://local/api/api-tokens?id=tok1", {
      method: "DELETE",
    });
    const res = await route.DELETE(req);
    expect(res.status).toBe(200);
    expect(mocks.revokeApiToken).toHaveBeenCalledWith({
      userId: "u1",
      id: "tok1",
    });
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "api_token.revoke",
      expect.objectContaining({ tokenId: "tok1" }),
    );
  });
});
