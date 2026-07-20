import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    requireApiSession: vi.fn(),
    getConversationById: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    clearConversationMessages: vi.fn(),
    serializeConversation: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: mocks.requireApiSession,

  isSessionPayload: (value: unknown) => Boolean(value),
}));
vi.mock("@/lib/ai/service", () => ({
  getConversationById: mocks.getConversationById,
  updateConversation: mocks.updateConversation,
  deleteConversation: mocks.deleteConversation,
  clearConversationMessages: mocks.clearConversationMessages,
  serializeConversation: mocks.serializeConversation,
}));

const route = await import("../route");

const session = { userId: "user-a", username: "alice" };

const fakeConv = {
  id: "c1", title: "Plan", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("/api/ai/conversations/[id] - ownership enforcement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.requireApiSession.mockResolvedValue(session);
    mocks.getConversationById.mockResolvedValue(fakeConv);
    mocks.updateConversation.mockResolvedValue(fakeConv);
    mocks.deleteConversation.mockResolvedValue(undefined);
    mocks.clearConversationMessages.mockResolvedValue(undefined);
    mocks.serializeConversation.mockImplementation((c) => c);
  });

  it("GET calls getConversationById with session.userId (owner-scoped)", async () => {
    const req = new Request("http://local/api/ai/conversations/c1", { method: "GET" });
    const res = await route.GET(req, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(mocks.getConversationById).toHaveBeenCalledWith("c1", "user-a");
  });

  it("PATCH calls updateConversation with session.userId (owner-scoped)", async () => {
    const req = new Request("http://local/api/ai/conversations/c1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "New title" }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(mocks.updateConversation).toHaveBeenCalledWith("c1", "user-a", expect.objectContaining({ title: "New title" }));
  });

  it("PATCH clearMessages calls clearConversationMessages with session.userId", async () => {
    const req = new Request("http://local/api/ai/conversations/c1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clearMessages: true }),
    });
    const res = await route.PATCH(req, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(mocks.clearConversationMessages).toHaveBeenCalledWith("c1", "user-a");
  });

  it("DELETE calls deleteConversation with session.userId (owner-scoped)", async () => {
    const req = new Request("http://local/api/ai/conversations/c1", { method: "DELETE" });
    const res = await route.DELETE(req, { params: Promise.resolve({ id: "c1" }) });
    expect(res.status).toBe(200);
    expect(mocks.deleteConversation).toHaveBeenCalledWith("c1", "user-a");
  });
});