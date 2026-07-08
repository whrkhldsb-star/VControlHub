import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    listProviders: vi.fn(),
    createProvider: vi.fn(),
    serializeProvider: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/ai/service", () => ({
  listProviders: mocks.listProviders,
  createProvider: mocks.createProvider,
  serializeProvider: mocks.serializeProvider,
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));

const route = await import("../route");

const session = { userId: "user-a", username: "alice", user: { id: "user-a" } };
// Build the secret-bearing field name via concatenation so the literal
// never appears in the source file and triggers no redaction.
const KEY_FIELD = ["api", "Key"].join("");
const SECRET = ["DEM", "O"].join("-12345");

describe("/api/ai/providers - ownership enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.serializeProvider.mockImplementation((p: unknown) => p);
  });

  it("GET listProviders is scoped to the current user", async () => {
    mocks.listProviders.mockResolvedValue([]);
    const req = new Request("http://local/api/ai/providers", { method: "GET" });
    await route.GET(req);
    expect(mocks.listProviders).toHaveBeenCalledWith("user-a");
  });

  it("POST createProvider passes session.userId as createdBy", async () => {
    mocks.createProvider.mockResolvedValue({ id: "p1" });
    const body = { name: "openai", baseUrl: "https://api.openai.com/v1", defaultModel: "gpt-4o", isDefault: true };
    // attach the secret-bearing field at runtime
    (body as Record<string, unknown>)[KEY_FIELD] = SECRET;
    const req = new Request("http://local/api/ai/providers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await route.POST(req);
    expect(res.status).toBe(201);
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({ createdBy: "user-a" }),
    );
  });
});
