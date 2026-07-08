import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useConversations } from "../hooks/use-conversations";
import { csrfFetch } from "@/lib/auth/csrf-client";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const fixture = (id: string) => ({
  id,
  title: `Conv ${id}`,
  providerId: "p_1",
  model: "gpt-4o",
  systemPrompt: null,
  temperature: 0.7,
  maxTokens: 2048,
  topP: 1,
  frequencyPenalty: 0,
  presencePenalty: 0,
  enableVision: true,
  hostingEnabled: false,
  createdBy: "u_1",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  provider: { id: "p_1", name: "OpenAI", type: "openai" },
});

const messageFixture = (id: string, role: string, content: string) => ({
  id,
  conversationId: "c1",
  role,
  content,
  reasoningContent: null,
  imageUrls: "[]",
  model: "gpt-4o",
  inputTokens: 1,
  outputTokens: 1,
  latencyMs: 100,
  createdAt: "2026-01-01T00:00:00.000Z",
});

describe("useConversations", () => {
  beforeEach(() => {
    vi.mocked(csrfFetch).mockReset();
  });

  it("starts with the initial conversations and an empty active id", () => {
    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1"), fixture("c2")] }),
    );
    expect(result.current.conversations).toHaveLength(2);
    expect(result.current.activeConvId).toBeNull();
    expect(result.current.activeConv).toBeNull();
    expect(result.current.messages).toEqual([]);
  });

  it("setActiveConvId updates the active id and triggers a messages fetch", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({
      conversation: { messages: [messageFixture("m1", "user", "hi")] },
    });
    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1")] }),
    );
    act(() => {
      result.current.setActiveConvId("c1");
    });
    await waitFor(() =>
      expect(csrfFetch).toHaveBeenCalledWith("/api/ai/conversations/c1"),
    );
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    expect(result.current.messages[0]!.content).toBe("hi");
    expect(result.current.activeConv?.id).toBe("c1");
  });

  it("setting activeConvId to null clears the messages", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({
      conversation: { messages: [messageFixture("m1", "user", "hi")] },
    });
    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1")] }),
    );
    act(() => {
      result.current.setActiveConvId("c1");
    });
    await waitFor(() => expect(result.current.messages).toHaveLength(1));
    act(() => {
      result.current.setActiveConvId(null);
    });
    expect(result.current.messages).toEqual([]);
    expect(result.current.activeConv).toBeNull();
  });

  it("ignores late responses for a stale activeConvId (cleanup)", async () => {
    let resolveFirst: (value: unknown) => void = () => {};
    vi.mocked(csrfFetch).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    );
    vi.mocked(csrfFetch).mockResolvedValueOnce({
      conversation: { messages: [messageFixture("m2", "assistant", "yo")] },
    });

    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1"), fixture("c2")] }),
    );
    act(() => {
      result.current.setActiveConvId("c1");
    });
    // Switch to a different conv before the first fetch resolves.
    act(() => {
      result.current.setActiveConvId("c2");
    });
    // Resolve the FIRST (stale) fetch — should be ignored.
    await act(async () => {
      resolveFirst({ conversation: { messages: [messageFixture("m_stale", "user", "stale")] } });
    });
    // Wait for c2 to populate.
    await waitFor(() => expect(result.current.messages[0]?.id).toBe("m2"));
    expect(result.current.messages.find((m) => m.id === "m_stale")).toBeUndefined();
  });

  it("refreshConversations pulls the latest list", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({
      conversations: [fixture("c1"), fixture("c2"), fixture("c3")],
    });
    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1")] }),
    );
    await act(async () => {
      await result.current.refreshConversations();
    });
    expect(result.current.conversations).toHaveLength(3);
  });

  it("refreshConversations propagates API failures (callers can decide)", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("network"));
    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1")] }),
    );
    await act(async () => {
      await expect(result.current.refreshConversations()).rejects.toThrow("network");
    });
    // The previous list is preserved.
    expect(result.current.conversations).toHaveLength(1);
  });

  it("autoTitle shortens, strips newlines, and PATCHes the conversation", async () => {
    vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });
    vi.mocked(csrfFetch).mockResolvedValueOnce({ conversations: [fixture("c1")] });
    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1")] }),
    );
    await act(async () => {
      await result.current.autoTitle("c1", "hello world this is a long first message");
    });
    expect(csrfFetch).toHaveBeenCalledWith(
      "/api/ai/conversations/c1",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ title: "hello world this is a long fir..." }),
      }),
    );
    expect(csrfFetch).toHaveBeenCalledTimes(2); // PATCH + refresh
  });

  it("autoTitle skips the call for empty or placeholder text", async () => {
    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1")] }),
    );
    await act(async () => {
      await result.current.autoTitle("c1", "");
    });
    await act(async () => {
      await result.current.autoTitle("c1", "(attachment)");
    });
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("autoTitle swallows the PATCH error and does not refresh", async () => {
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("patch failed"));
    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1")] }),
    );
    await act(async () => {
      await result.current.autoTitle("c1", "hello world");
    });
    // Only the PATCH call, no refresh after failure.
    expect(csrfFetch).toHaveBeenCalledTimes(1);
  });

  it("setMessages stays open for the streaming layer to write optimistically", () => {
    const { result } = renderHook(() =>
      useConversations({ initialConversations: [fixture("c1")] }),
    );
    act(() => {
      result.current.setMessages([messageFixture("m1", "user", "draft")]);
    });
    expect(result.current.messages[0]!.content).toBe("draft");
  });
});
