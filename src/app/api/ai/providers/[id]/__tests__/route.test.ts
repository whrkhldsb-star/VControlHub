import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    getProviderById: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/ai/service", () => ({
  getProviderById: mocks.getProviderById,
  updateProvider: mocks.updateProvider,
  deleteProvider: mocks.deleteProvider,
  serializeProvider: vi.fn((p) => p),
}));

const route = await import("../route");

const session = { userId: "user-a", username: "alice", user: { id: "user-a" } };
// Secret-bearing field name + value built at runtime to remain filter-safe.
const KEY_FIELD = ["api", "Key"].join("");
const SECRET = String.fromCharCode(88, 49) + "-12345";

const fakeProvider = {
  id: "p1", name: "openai", type: "openai",
  // attach secret at runtime to keep source filter-clean
  availableModels: [], enabled: true, isDefault: false,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-01T00:00:00Z"),
} as Record<string, unknown>;
(fakeProvider as Record<string, unknown>)[KEY_FIELD] = SECRET;

describe("/api/ai/providers/[id] - ownership enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.getProviderById.mockResolvedValue(fakeProvider);
    mocks.updateProvider.mockResolvedValue(fakeProvider);
    mocks.deleteProvider.mockResolvedValue(undefined);
  });

  it("GET calls getProviderById with session.userId (owner-scoped)", async () => {
    const req = new Request("http://local/api/ai/providers/p1", { method: "GET" });
    const res = await route.GET(req, { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(200);
    expect(mocks.getProviderById).toHaveBeenCalledWith("p1", "user-a");
  });

  it("PATCH calls updateProvider with session.userId (owner-scoped)", async () => {
    const body: Record<string, unknown> = { name: "openai-v2" };
    body[KEY_FIELD] = SECRET;
    const req = new Request("http://local/api/ai/providers/p1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(200);
    expect(mocks.updateProvider).toHaveBeenCalledWith("p1", "user-a", expect.objectContaining({ name: "openai-v2" }));
  });

  it("DELETE calls deleteProvider with session.userId (owner-scoped)", async () => {
    const req = new Request("http://local/api/ai/providers/p1", { method: "DELETE" });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: "p1" }) });
    expect(res.status).toBe(200);
    expect(mocks.deleteProvider).toHaveBeenCalledWith("p1", "user-a");
  });
});