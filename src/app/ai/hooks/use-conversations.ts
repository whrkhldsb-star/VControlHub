"use client";

import { useCallback, useEffect, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type { ConvItem, Message } from "../ai-types";

export type UseConversationsInput = {
  initialConversations: ConvItem[];
};

export type UseConversationsResult = {
  conversations: ConvItem[];
  activeConvId: string | null;
  setActiveConvId: (id: string | null) => void;
  activeConv: ConvItem | null;
  messages: Message[];
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>;
  refreshConversations: () => Promise<void>;
  autoTitle: (convId: string, firstMsg: string) => Promise<void>;
};

/**
 * Centralises the conversation/message state and the data fetches that
 * go with it: the initial conversation list, the active conversation id,
 * the per-conversation message list, the auto-derived `activeConv`, the
 * refresh callback, and the auto-title helper that names a fresh
 * conversation after its first user message.
 *
 * The owning component is still responsible for `setMessages` writes
 * during streaming / optimistic updates — those need direct access to
 * the local list — but the source-of-truth fetch (refreshing the
 * conversation list, fetching messages for the active conversation)
 * lives here so the chat client does not have to know the API paths.
 */
export function useConversations({
  initialConversations,
}: UseConversationsInput): UseConversationsResult {
  const [conversations, setConversations] = useState<ConvItem[]>(
    initialConversations,
  );
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);

  const activeConv =
    conversations.find((c) => c.id === activeConvId) ?? null;

  // Fetch the conversation (with its messages) whenever the active id
  // changes.  An empty active id clears the message list.
  useEffect(() => {
    if (!activeConvId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- activeConvId 切到 null 时同步清空消息列表,避免旧会话残留闪烁
      setMessages([]);
      return;
    }
    let cancelled = false;
    csrfFetch<{ conversation?: { messages?: Message[] } }>(
      `/api/ai/conversations/${activeConvId}`,
    )
      .then((data) => {
        if (cancelled) return;
        if (data.conversation?.messages) setMessages(data.conversation.messages);
      })
      .catch(() => {
        // silent — stale messages are fine, the next refresh will retry
      });
    return () => {
      cancelled = true;
    };
  }, [activeConvId]);

  const refreshConversations = useCallback(async () => {
    const data = await csrfFetch<{ conversations?: ConvItem[] }>(
      "/api/ai/conversations",
    );
    if (data.conversations) setConversations(data.conversations);
  }, []);

  const autoTitle = useCallback(
    async (convId: string, firstMsg: string) => {
      const title = firstMsg.slice(0, 30).replace(/\n/g, " ").trim();
      if (!title || title === "\u0028\u9644\u4ef6\u0029") return;
      try {
        await csrfFetch(`/api/ai/conversations/${convId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title + (firstMsg.length > 30 ? "..." : ""),
          }),
        });
        await refreshConversations();
      } catch {
        // ignore — auto-title is best-effort
      }
    },
    [refreshConversations],
  );

  return {
    conversations,
    activeConvId,
    setActiveConvId,
    activeConv,
    messages,
    setMessages,
    refreshConversations,
    autoTitle,
  };
}
