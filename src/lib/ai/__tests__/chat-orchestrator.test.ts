import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    createMessage: vi.fn(),
    getConversationById: vi.fn(),
    sendChatRequest: vi.fn(),
    buildKnowledgeContextForPrompt: vi.fn(),
    getOpenAIToolsFormat: vi.fn(),
    createHostedAction: vi.fn(),
    executeSafeAction: vi.fn(),
    parseToolCall: vi.fn(),
    prisma: {
      aiMessage: { create: vi.fn(), deleteMany: vi.fn() },
      aiHostedAction: { update: vi.fn() },
      $transaction: vi.fn(),
    },
  },
}));

vi.mock("@/lib/ai/service", () => ({
  createMessage: mocks.createMessage,
  getConversationById: mocks.getConversationById,
  sendChatRequest: mocks.sendChatRequest,
}));
vi.mock("@/lib/ai/knowledge", () => ({
  buildKnowledgeContextForPrompt: mocks.buildKnowledgeContextForPrompt,
}));
vi.mock("@/lib/ai/hosted-tools", () => ({
  getOpenAIToolsFormat: mocks.getOpenAIToolsFormat,
}));
vi.mock("@/lib/ai/hosted-service", () => ({
  createHostedAction: mocks.createHostedAction,
  executeSafeAction: mocks.executeSafeAction,
  parseToolCall: mocks.parseToolCall,
}));
vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));

const { createAiChatResponse } = await import("../chat-orchestrator");

const session = {
  userId: "user-1",
  username: "admin",
  roles: ["admin" as const],
  mustChangePassword: false,
  currentTeamId: null,
};
const conversation = {
  id: "conversation-1",
  systemPrompt: null,
  messages: [],
  enableVision: false,
  hostingEnabled: false,
  provider: { id: "provider-1" },
  model: "gpt-test",
  temperature: 0.7,
  maxTokens: 4096,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
};

function upstreamResponse(content: string): Response {
  return new Response(
    `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n` +
      `data: ${JSON.stringify({ usage: { prompt_tokens: 2, completion_tokens: 1 } })}\n\n`,
  );
}

describe("createAiChatResponse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getConversationById.mockResolvedValue(conversation);
    mocks.createMessage.mockResolvedValue({ id: "user-message-1" });
    mocks.buildKnowledgeContextForPrompt.mockResolvedValue({ context: "" });
    mocks.getOpenAIToolsFormat.mockReturnValue([]);
    mocks.parseToolCall.mockReturnValue(null);
    mocks.sendChatRequest.mockResolvedValue({
      response: upstreamResponse("hello"),
      providerType: "OPENAI",
      startTime: Date.now(),
    });
    mocks.prisma.aiMessage.create.mockResolvedValue({ id: "assistant-message-1" });
    mocks.prisma.aiMessage.deleteMany.mockResolvedValue({ count: 1 });
    mocks.prisma.aiHostedAction.update.mockResolvedValue({ id: "action-1" });
    mocks.prisma.$transaction.mockResolvedValue([]);
  });

  it("persists both sides and emits a complete SSE response", async () => {
    const response = await createAiChatResponse({
      body: { conversationId: conversation.id, content: "question" },
      session,
      locale: "en",
    });
    const body = await response.text();

    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(body).toContain('"type":"content","content":"hello"');
    expect(body).toContain('"type":"done","inputTokens":2,"outputTokens":1');
    expect(mocks.createMessage).toHaveBeenCalledWith({
      conversationId: conversation.id,
      role: "user",
      content: "question",
      imageUrls: [],
    });
    expect(mocks.prisma.aiMessage.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        conversationId: conversation.id,
        role: "assistant",
        content: "hello",
        inputTokens: 2,
        outputTokens: 1,
      }),
    });
  });

  it("emits an error and closes the stream when final persistence fails", async () => {
    mocks.prisma.aiMessage.create.mockRejectedValueOnce(new Error("database unavailable"));

    const response = await createAiChatResponse({
      body: { conversationId: conversation.id, content: "question" },
      session,
      locale: "en",
    });
    const body = await response.text();

    expect(body).toContain('"type":"content","content":"hello"');
    expect(body).toContain('"type":"error","error":"database unavailable"');
    expect(body).not.toContain('"type":"done"');
    expect(mocks.prisma.aiMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "user-message-1",
        conversationId: conversation.id,
        role: "user",
  },
    });
  });

  it("removes the user message when the provider request fails before streaming", async () => {
    mocks.sendChatRequest.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );

    await expect(
      createAiChatResponse({
        body: { conversationId: conversation.id, content: "question" },
        session,
        locale: "en",
      }),
    ).rejects.toMatchObject({ message: "provider unavailable" });

    expect(mocks.prisma.aiMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "user-message-1",
        conversationId: conversation.id,
        role: "user",
      },
    });
  });

  it("returns a typed stream error when the provider has no response body", async () => {
    mocks.sendChatRequest.mockResolvedValueOnce({
      response: new Response(null),
      providerType: "OPENAI",
      startTime: Date.now(),
    });

    const response = await createAiChatResponse({
      body: { conversationId: conversation.id, content: "question" },
      session,
      locale: "en",
    });

    expect(await response.text()).toContain(
      '"type":"error","error":"Cannot read response stream"',
    );
    expect(mocks.prisma.aiMessage.create).not.toHaveBeenCalled();
    expect(mocks.prisma.aiMessage.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "user-message-1",
        conversationId: conversation.id,
        role: "user",
  },
    });
  });

  it("cancels the provider stream and skips side effects when the client disconnects", async () => {
    let upstreamCancelled = false;
    let sent = false;
    const upstream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (!sent) {
          sent = true;
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"choices":[{"delta":{"content":"partial"}}]}\n',
            ),
          );
        }
      },
      cancel() {
        upstreamCancelled = true;
      },
    });
    mocks.sendChatRequest.mockResolvedValueOnce({
      response: new Response(upstream),
      providerType: "OPENAI",
      startTime: Date.now(),
    });

    const response = await createAiChatResponse({
      body: { conversationId: conversation.id, content: "question" },
      session,
      locale: "en",
    });
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("partial");
    await reader.cancel();

    await vi.waitFor(() => expect(upstreamCancelled).toBe(true));
    // The user message is already persisted; an interrupted marker is written
    // so the conversation does not end on a permanent orphan user message.
    expect(mocks.prisma.aiMessage.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          conversationId: conversation.id,
          role: "assistant",
          content: "(generation interrupted)",
          model: conversation.model,
        }),
      }),
    );
    expect(mocks.createHostedAction).not.toHaveBeenCalled();
  });

  it("executes safe hosted tools and persists the result atomically", async () => {
    mocks.getConversationById.mockResolvedValueOnce({
      ...conversation,
      hostingEnabled: true,
    });
    mocks.sendChatRequest.mockResolvedValueOnce({
      response: new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tool-1","function":{"name":"list_servers","arguments":"{}"}}]}}]}\n',
      ),
      providerType: "OPENAI",
      startTime: Date.now(),
    });
    mocks.parseToolCall.mockReturnValueOnce({
      toolCallId: "tool-1",
      args: {},
      tool: {
        name: "list_servers",
        actionName: "List servers",
        actionType: "list_servers",
        riskLevel: "low",
        autoApproved: true,
      },
    });
    mocks.createHostedAction.mockResolvedValueOnce({
      id: "action-1",
      serverId: null,
      params: "{}",
    });
    mocks.executeSafeAction.mockResolvedValueOnce({
      success: true,
      data: { servers: [] },
    });

    const response = await createAiChatResponse({
      body: { conversationId: conversation.id, content: "list servers" },
      session,
      locale: "en",
    });
    const body = await response.text();

    expect(body).toContain('"type":"tool_call"');
    expect(body).toContain('"type":"tool_result","toolCallId":"tool-1","success":true');
    expect(body).toContain('"type":"done"');
    expect(mocks.executeSafeAction).toHaveBeenCalledWith(
      { actionType: "list_servers", serverId: null, params: {} },
      { session, locale: "en" },
    );
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.prisma.aiHostedAction.update).toHaveBeenCalledWith({
      where: { id: "action-1" },
      data: expect.objectContaining({
        status: "COMPLETED",
        result: JSON.stringify({ servers: [] }),
        executedAt: expect.any(Date),
        completedAt: expect.any(Date),
      }),
    });
  });

  it("creates an approval request without executing dangerous hosted tools", async () => {
    mocks.getConversationById.mockResolvedValueOnce({
      ...conversation,
      hostingEnabled: true,
    });
    mocks.sendChatRequest.mockResolvedValueOnce({
      response: new Response(
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"tool-2","function":{"name":"restart_server","arguments":"{\\"serverId\\":\\"srv-1\\"}"}}]}}]}\n',
      ),
      providerType: "OPENAI",
      startTime: Date.now(),
    });
    mocks.parseToolCall.mockReturnValueOnce({
      toolCallId: "tool-2",
      args: { serverId: "srv-1" },
      tool: {
        name: "restart_server",
        actionName: "Restart server",
        actionType: "restart_server",
        riskLevel: "high",
        autoApproved: false,
      },
    });
    mocks.createHostedAction.mockResolvedValueOnce({
      id: "action-2",
      serverId: "srv-1",
      params: '{"serverId":"srv-1"}',
    });

    const response = await createAiChatResponse({
      body: { conversationId: conversation.id, content: "restart it" },
      session,
      locale: "en",
    });
    const body = await response.text();

    expect(body).toContain('"type":"tool_approval_needed"');
    expect(body).toContain('"actionId":"action-2"');
    expect(body).toContain('"needsApproval":true');
    expect(mocks.prisma.aiMessage.create).toHaveBeenCalledWith({
      data: {
        conversationId: conversation.id,
        role: "tool",
        content: JSON.stringify({
          actionId: "action-2",
          status: "PENDING_APPROVAL",
          pendingApproval: true,
        }),
        toolCallId: "tool-2",
      },
    });
    expect(mocks.executeSafeAction).not.toHaveBeenCalled();
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});
