"use client";

/**
 * `useAiChatStream` — owns send/stop/streaming state and SSE parsing
 * for the AI chat surface.
 *
 * Extracted from ai-client.tsx in R31. Lifts ~180 lines of inline SSE
 * loop + abort plumbing into a hook so the main client component is a
 * thin orchestrator.
 *
 * Public surface:
 *   - state: `streaming`, `streamContent`, `streamReasoning`,
 *            `pendingApprovals`, `approvalBusyById`
 *   - actions: `sendMessage(params)`, `stopGeneration()`,
 *              `decideApproval(approval, action)`
 *   - setters retained for parent push (assistant message join,
 *     manual clear): `setPendingApprovals`.
 */
import {
  type Dispatch,
  type SetStateAction,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import type {
  ConvItem,
  Message,
  ToolApprovalNeeded,
  ToolCallEvent,
} from "../ai-types";

type ToastFn = (kind: "success" | "error" | "info", message: string) => void;

type Args = {
  activeConv: ConvItem | null;
  activeConvId: string | null;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  refreshConversations: () => Promise<void> | void;
  addToast: ToastFn;
};

export type SendArgs = {
  content: string;
  imageUrls: string[];
  imageBase64: { mimeType: string; data: string }[];
  fileAttachments: { name: string; content: string }[];
};

export function useAiChatStream({
  activeConv,
  activeConvId,
  setMessages,
  refreshConversations,
  addToast,
}: Args) {
  const { t } = useI18n();
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  const [pendingApprovals, setPendingApprovals] = useState<
    ToolApprovalNeeded[]
  >([]);
  const [approvalBusyById, setApprovalBusyById] = useState<
    Record<string, boolean>
  >({});
  const abortControllerRef = useRef<AbortController | null>(null);
  const approvalBusyRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  // Abort in-flight SSE and clear ephemeral stream/approval UI when the
  // user switches conversations (prevents cross-chat content flash).
  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreaming(false);
    setStreamContent("");
    setStreamReasoning("");
    setPendingApprovals([]);
    setApprovalBusyById({});
    approvalBusyRef.current.clear();
  }, [activeConvId]);

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setStreaming(false);
    if (activeConvId) {
      csrfFetch(`/api/ai/conversations/${activeConvId}`)
        .then((data) => {
          if (data.conversation?.messages)
            setMessages(data.conversation.messages);
        })
        .catch(() => {});
    }
  }, [activeConvId, setMessages]);

  const refreshActiveMessages = useCallback(async () => {
    if (!activeConvId) return;
    const data = await csrfFetch(`/api/ai/conversations/${activeConvId}`);
    if (data.conversation?.messages) setMessages(data.conversation.messages);
  }, [activeConvId, setMessages]);

  const decideApproval = useCallback(
    async (approval: ToolApprovalNeeded, action: "confirm" | "reject") => {
      if (approvalBusyRef.current.has(approval.actionId)) return;
      approvalBusyRef.current.add(approval.actionId);
      setApprovalBusyById((prev) => ({ ...prev, [approval.actionId]: true }));
      try {
        await csrfFetch(`/api/ai/hosted-actions/${approval.actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            action === "reject"
              ? { action, reason: t("aiPage.userDenied") }
              : { action },
          ),
        });
        setPendingApprovals((prev) =>
          prev.filter((item) => item.actionId !== approval.actionId),
        );
        await refreshActiveMessages();
        addToast(
          "success",
          action === "reject" ? t("aiPage.rejected") : t("aiPage.approved"),
        );
      } catch {
        // Approval/rejection request failed — notify the user via toast.
        addToast("error", t("aiPage.opFailed"));
      } finally {
        approvalBusyRef.current.delete(approval.actionId);
        setApprovalBusyById((prev) => {
          const { [approval.actionId]: _removed, ...rest } = prev;
          void _removed;
          return rest;
        });
      }
    },
    [addToast, refreshActiveMessages, t],
  );

  const sendMessage = useCallback(
    async (args: SendArgs) => {
      if (!activeConvId || streaming) return;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setStreaming(true);
      setStreamContent("");
      setStreamReasoning("");
      // Track terminal outcome. `finally` used to wipe `streamContent` while
      // `AiMessageList` only renders stream bubbles while `streaming===true`,
      // so HTTP/SSE/network errors were invisible and the optimistic user
      // bubble could vanish after a silent server refresh.
      let terminalError: string | null = null;
      let completedSuccessfully = false;
      let aborted = false;
      try {
        const response = await csrfFetch<Response>("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            conversationId: activeConvId,
            content: args.content,
            imageUrls: args.imageUrls,
            imageBase64: args.imageBase64,
            fileAttachments: args.fileAttachments,
          }),
          signal: abortController.signal,
          raw: true,
        });
        if (!response.ok) {
          const err = await response
            .json()
            .catch(() => ({ error: t("aiPage.requestFailed") }));
          terminalError =
            (typeof err.error === "string" && err.error) ||
            t("aiPage.requestFailed");
          return;
        }
        const reader = response.body?.getReader();
        if (!reader) {
          terminalError = t("aiPage.requestFailed");
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        let finalContent = "";
        let finalReasoning = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith("data: ")) continue;
            const data = trimmed.slice(6);
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content") {
                finalContent += parsed.content;
                setStreamContent(finalContent);
              } else if (parsed.type === "reasoning") {
                finalReasoning += parsed.content;
                setStreamReasoning(finalReasoning);
              } else if (parsed.type === "done") {
                completedSuccessfully = true;
                const assistantMsg: Message = {
                  id: `stream-${crypto.randomUUID()}`,
                  conversationId: activeConvId,
                  role: "assistant",
                  content: finalContent || t("aiPage.noResponse"),
                  reasoningContent: finalReasoning || null,
                  imageUrls: "[]",
                  model: activeConv?.model || null,
                  inputTokens: parsed.inputTokens ?? null,
                  outputTokens: parsed.outputTokens ?? null,
                  latencyMs: parsed.latencyMs ?? null,
                  createdAt: new Date().toISOString(),
                };
                setMessages((prev) => [...prev, assistantMsg]);
              } else if (parsed.type === "error") {
                terminalError =
                  typeof parsed.error === "string" && parsed.error
                    ? parsed.error
                    : t("aiPage.requestFailed");
              } else if (parsed.type === "tool_call") {
                const tc = parsed.toolCall as ToolCallEvent;
                if (tc.autoApproved) {
                  setStreamContent(
                    (prev) =>
                      prev +
                      t("aiPage.toolCallStart").replace(
                        "{name}",
                        tc.actionName,
                      ),
                  );
                } else {
                  setStreamContent(
                    (prev) =>
                      prev +
                      t("aiPage.toolCallApproval").replace(
                        "{name}",
                        tc.actionName,
                      ),
                  );
                }
              } else if (parsed.type === "tool_result") {
                const success = parsed.success as boolean;
                if (success) {
                  setStreamContent(
                    (prev) => prev + t("aiPage.toolCallSuccess"),
                  );
                } else {
                  setStreamContent(
                    (prev) =>
                      prev +
                      t("aiPage.toolCallFailed").replace(
                        "{detail}",
                        JSON.stringify(parsed.data).slice(0, 200),
                      ),
                  );
                }
              } else if (parsed.type === "tool_approval_needed") {
                const approval = parsed as ToolApprovalNeeded;
                setPendingApprovals((prev) => [...prev, approval]);
                setStreamContent(
                  (prev) =>
                    prev +
                    t("aiPage.waitingApproval")
                      .replace("{name}", approval.actionName)
                      .replace("{risk}", approval.riskLevel),
                );
              }
            } catch {
              // Skip malformed SSE chunk
            }
          }
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          aborted = true;
        } else {
          terminalError = t("aiPage.networkError");
        }
      } finally {
        setStreaming(false);
        setStreamContent("");
        setStreamReasoning("");
        abortControllerRef.current = null;
        if (terminalError) {
          const errorText = terminalError.startsWith("❌")
            ? terminalError
            : `❌ ${terminalError}`;
          const errorMsg: Message = {
            id: `stream-error-${crypto.randomUUID()}`,
            conversationId: activeConvId,
            role: "assistant",
            content: errorText,
            reasoningContent: null,
            imageUrls: "[]",
            model: activeConv?.model || null,
            inputTokens: null,
            outputTokens: null,
            latencyMs: null,
            createdAt: new Date().toISOString(),
          };
          setMessages((prev) => [...prev, errorMsg]);
          addToast("error", terminalError.replace(/^❌\s*/, ""));
          // Do not replace local transcript with a server refresh on failure:
          // the request may never have been persisted, and a silent overwrite
          // would drop the optimistic user bubble + the error we just added.
        } else if (activeConvId && (completedSuccessfully || aborted)) {
          try {
            const data = await csrfFetch(
              `/api/ai/conversations/${activeConvId}`,
            );
            if (data.conversation?.messages)
              setMessages(data.conversation.messages);
          } catch {
            // Keep local transcript if post-stream refresh fails.
          }
        }
        await refreshConversations();
      }
    },
    [
      activeConvId,
      activeConv?.model,
      addToast,
      refreshConversations,
      setMessages,
      streaming,
      t,
    ],
  );

  return {
    streaming,
    streamContent,
    streamReasoning,
    pendingApprovals,
    setPendingApprovals,
    approvalBusyById,
    sendMessage,
    stopGeneration,
    decideApproval,
  };
}
