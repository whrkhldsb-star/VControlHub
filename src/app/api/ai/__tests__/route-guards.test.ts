import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    requireApiSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    listProviders: vi.fn(),
    createProvider: vi.fn(),
    getProviderById: vi.fn(),
    updateProvider: vi.fn(),
    deleteProvider: vi.fn(),
    fetchModelsFromCredentials: vi.fn(),
    fetchModelsFromProvider: vi.fn(),
    listConversations: vi.fn(),
    createConversation: vi.fn(),
    getConversationById: vi.fn(),
    updateConversation: vi.fn(),
    deleteConversation: vi.fn(),
    clearConversationMessages: vi.fn(),
    getPendingActions: vi.fn(),
    approveHostedAction: vi.fn(),
    confirmHostedAction: vi.fn(),
    rejectHostedAction: vi.fn(),
    prisma: {
      aiHostedAction: {
        findUnique: vi.fn(),
      },
    },
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: mocks.requireApiSession,
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: mocks.sessionHasPermission,
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/ai/service", () => ({
  listProviders: mocks.listProviders,
  createProvider: mocks.createProvider,
  getProviderById: mocks.getProviderById,
  updateProvider: mocks.updateProvider,
  deleteProvider: mocks.deleteProvider,
  fetchModelsFromCredentials: mocks.fetchModelsFromCredentials,
  fetchModelsFromProvider: mocks.fetchModelsFromProvider,
  listConversations: mocks.listConversations,
  createConversation: mocks.createConversation,
  getConversationById: mocks.getConversationById,
  updateConversation: mocks.updateConversation,
  deleteConversation: mocks.deleteConversation,
  clearConversationMessages: mocks.clearConversationMessages,
  serializeConversationListItem: (conversation: Record<string, unknown>) =>
    conversation,
  serializeConversation: (conversation: Record<string, unknown>) =>
    conversation,
  serializeProvider: (provider: Record<string, unknown>) => ({
    ...provider,
    apiKey: undefined,
  }),
}));
vi.mock("@/lib/ai/hosted-service", () => ({
  getPendingActions: mocks.getPendingActions,
  approveHostedAction: mocks.approveHostedAction,
  confirmHostedAction: mocks.confirmHostedAction,
  rejectHostedAction: mocks.rejectHostedAction,
}));

const providersRoute = await import("../providers/route");
const providerDetailRoute = await import("../providers/[id]/route");
const modelsRoute = await import("../models/route");
const modelsProbeRoute = await import("../models/probe/route");
const hostedActionsRoute = await import("../hosted-actions/route");
const hostedActionDetailRoute = await import("../hosted-actions/[id]/route");
const conversationsRoute = await import("../conversations/route");
const conversationDetailRoute = await import("../conversations/[id]/route");
const chatRoute = await import("../chat/route");

const session = { userId: "u1", username: "alice", roles: ["admin"] };
const params = { params: Promise.resolve({ id: "p1" }) };
const provider = {
  id: "p1",
  name: "OpenAI",
  apiKey: "sk-1234567890abcdef",
  createdAt: new Date("2026-01-01T00:00:00Z"),
  updatedAt: new Date("2026-01-02T00:00:00Z"),
};
const conversation = {
  id: "c1",
  title: "Test conversation",
  createdAt: new Date("2026-01-03T00:00:00Z"),
  updatedAt: new Date("2026-01-04T00:00:00Z"),
  provider: null,
};

describe("AI API shared guard migration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.requireApiSession.mockResolvedValue(session);
    mocks.sessionHasPermission.mockReturnValue(true);
    mocks.listProviders.mockResolvedValue([provider]);
    mocks.createProvider.mockResolvedValue(provider);
    mocks.getProviderById.mockResolvedValue(provider);
    mocks.updateProvider.mockResolvedValue(provider);
    mocks.deleteProvider.mockResolvedValue(undefined);
    mocks.fetchModelsFromCredentials.mockResolvedValue(["gpt-test"]);
    mocks.fetchModelsFromProvider.mockResolvedValue(["gpt-provider"]);
    mocks.listConversations.mockResolvedValue([conversation]);
    mocks.createConversation.mockResolvedValue(conversation);
    mocks.getConversationById.mockResolvedValue(conversation);
    mocks.updateConversation.mockResolvedValue(conversation);
    mocks.deleteConversation.mockResolvedValue(undefined);
    mocks.clearConversationMessages.mockResolvedValue(undefined);
    mocks.getPendingActions.mockResolvedValue([{ id: "a1" }]);
    mocks.approveHostedAction.mockResolvedValue(undefined);
    mocks.confirmHostedAction.mockResolvedValue(undefined);
    mocks.rejectHostedAction.mockResolvedValue({
      id: "a1",
      status: "REJECTED",
    });
    mocks.prisma.aiHostedAction.findUnique.mockResolvedValue({
      id: "a1",
      status: "APPROVED",
    });
  });

  it("requires ai:manage for provider reads and masks provider secrets", async () => {
    const response = await providersRoute.GET(
      new Request("http://local/api/ai/providers"),
    );
    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:manage");
    const body = await response.json();
    expect(body.providers[0].apiKey).toBeUndefined();
  });

  it("requires ai:manage for provider writes and normalizes model lists", async () => {
    const response = await providersRoute.POST(
      new Request("http://local/api/ai/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "OpenAI",
          apiKey: "sk",
          baseUrl: "https://api.example.com",
          models: "gpt-4, gpt-4o",
        }),
      }),
    );
    expect(response.status).toBe(201);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:manage");
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        availableModels: ["gpt-4", "gpt-4o"],
        createdBy: "u1",
      }),
    );
  });

  it("allows provider creation to use the service default Base URL and normalizes duplicate model lists", async () => {
    const response = await providersRoute.POST(
      new Request("http://local/api/ai/providers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "OpenAI Compatible",
          apiKey: "sk",
          models: " gpt-4o, gpt-4o, , gpt-4.1 ",
        }),
      }),
    );

    expect(response.status).toBe(201);
    expect(mocks.createProvider).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "OpenAI Compatible",
        apiKey: "sk",
        availableModels: ["gpt-4o", "gpt-4.1"],
        createdBy: "u1",
      }),
    );
  });

  it("masks provider API keys in detail responses", async () => {
    const response = await providerDetailRoute.GET(
      new Request("http://local/api/ai/providers/p1"),
      params,
    );
    const body = await response.json();
    expect(body.provider.apiKey).toBe("sk-12345...cdef");
    expect(body.provider.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("uses shared guard for model provider fetch and credential probe", async () => {
    const fetchResponse = await modelsRoute.GET(
      new Request("http://local/api/ai/models?providerId=p1"),
    );
    expect(fetchResponse.status).toBe(200);
    expect(mocks.fetchModelsFromProvider).toHaveBeenCalledWith("p1", "u1");

    const probeResponse = await modelsProbeRoute.POST(
      new Request("http://local/api/ai/models/probe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          apiKey: "sk",
          baseUrl: "https://api.example.com",
        }),
      }),
    );
    expect(probeResponse.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:manage");
    expect(mocks.fetchModelsFromCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: "sk" }),
    );
  });

  it("uses auth-only hosted action confirmation so requester can create assistant command requests", async () => {
    const listResponse = await hostedActionsRoute.GET(
      new Request("http://local/api/ai/hosted-actions"),
    );
    expect(listResponse.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:chat")
    expect(mocks.getPendingActions).toHaveBeenCalledWith("u1");

    const confirmResponse = await hostedActionDetailRoute.PATCH(
      new Request("http://local/api/ai/hosted-actions/a1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(confirmResponse.status).toBe(200);
    expect(mocks.requireApiSession).toHaveBeenCalled();
    expect(mocks.requireApiPermission).not.toHaveBeenCalledWith("ai:action:approve");
    expect(mocks.confirmHostedAction).toHaveBeenCalledWith("a1", session);
  });

  it("keeps admin approval/rejection protected by ai:action:approve in the service layer", async () => {
    const approveResponse = await hostedActionDetailRoute.PATCH(
      new Request("http://local/api/ai/hosted-actions/a1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "approve" }),
      }),
      { params: Promise.resolve({ id: "a1" }) },
    );
    expect(approveResponse.status).toBe(200);
    expect(mocks.approveHostedAction).toHaveBeenCalledWith("a1", session);
  });

  it("uses shared guard for AI conversation list/create/update/delete routes", async () => {
    const listResponse = await conversationsRoute.GET(
      new Request("http://local/api/ai/conversations"),
    );
    expect(listResponse.status).toBe(200);
    expect(mocks.requireApiSession).toHaveBeenCalled();
    expect(mocks.listConversations).toHaveBeenCalledWith("u1");

    const createResponse = await conversationsRoute.POST(
      new Request("http://local/api/ai/conversations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: "New chat",
          providerId: "p1",
          model: "gpt-test",
        }),
      }),
    );
    expect(createResponse.status).toBe(201);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:chat");
    expect(mocks.createConversation).toHaveBeenCalledWith({
      title: "New chat",
      providerId: "p1",
      model: "gpt-test",
      createdBy: "u1",
    });

    const detailParams = { params: Promise.resolve({ id: "c1" }) };
    const patchResponse = await conversationDetailRoute.PATCH(
      new Request("http://local/api/ai/conversations/c1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Renamed chat" }),
      }),
      detailParams,
    );
    expect(patchResponse.status).toBe(200);
    expect(mocks.updateConversation).toHaveBeenCalledWith("c1", "u1", {
      title: "Renamed chat",
    });

    const deleteResponse = await conversationDetailRoute.DELETE(
      new Request("http://local/api/ai/conversations/c1", { method: "DELETE" }),
      detailParams,
    );
    expect(deleteResponse.status).toBe(200);
    expect(mocks.deleteConversation).toHaveBeenCalledWith("c1", "u1");
  });

  it("checks ai:chat permission before validating chat request bodies", async () => {
    const response = await chatRoute.POST(
      new Request("http://local/api/ai/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: "missing conversation id" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:chat");
  });
});
