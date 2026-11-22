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
 *   - state: `streaming`, `streamContent`, `streamReasoning`, `streamSteps`,
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
import { ApiError } from "@/lib/http/api-client-error";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import { streamErrorMessage } from "../ai-stream-error";
import type {
  ConvItem,
  Message,
  StreamStep,
  ToolApprovalNeeded,
  ToolCallEvent,
} from "../ai-types";
import type { ToastFn } from "@/components/toast-provider";
import { CHAT_REQUEST_MAX_BODY_BYTES, chatRequestSchema } from "@/lib/ai/schema";
import { randomId } from "@/lib/ui/random-id";


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

/**
 * Adds a step, or updates the one with the same call id: a call is reported, then answered. A pure function for
 * state updaters (React runs those twice in development).
 */
export function upsertStreamStep(steps: StreamStep[], next: Partial<StreamStep> & { toolCallId: string }): StreamStep[] {
  const index = steps.findIndex((step) => step.toolCallId === next.toolCallId);
  if (index === -1) return [...steps, { name: null, state: "running", ...next }];
  return steps.map((step, i) => (i === index ? { ...step, ...next, name: next.name ?? step.name } : step));
}

export function useAiChatStream({
  activeConv,
  activeConvId,
  setMessages,
  refreshConversations,
  addToast,
}: Args) {
  const { t, locale } = useI18n();
  const activeConvIdRef = useRef(activeConvId);
  const [streaming, setStreaming] = useState(false);
  const [streamContent, setStreamContent] = useState("");
  const [streamReasoning, setStreamReasoning] = useState("");
  // The answer's tool calls, apart from its text: appended to the text, they were glued to it ("…⚡ 执行：x…✅ 操作执行成功")
  // and wiped by the next chunk, which set the text again.
  const [streamSteps, setStreamSteps] = useState<StreamStep[]>([]);
  const [pendingApprovals, setPendingApprovals] = useState<
    ToolApprovalNeeded[]
  >([]);
  const [approvalBusyById, setApprovalBusyById] = useState<
    Record<string, boolean>
  >({});
  const generation = useRef(0);
  const failedRequest = useRef<{
    conversationId: string; errorMessageId: string; args: SendArgs; onAccepted?: (messageId: string | null) => void;
  } | null>(null);
  const lastRequest = useRef<{ conversationId: string; messageId: string | null; args: SendArgs } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const approvalBusyRef = useRef<Set<string>>(new Set());

  const invalidateGeneration = useCallback(() => {
    generation.current++;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
  }, []);

  useEffect(() => {
    activeConvIdRef.current = activeConvId;
    failedRequest.current = null;
    lastRequest.current = null;
    return invalidateGeneration;
  }, [activeConvId, invalidateGeneration]);

  // Abort in-flight SSE and clear ephemeral stream/approval UI when the
  // user switches conversations (prevents cross-chat content flash).
  useEffect(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setStreaming(false);
    setStreamContent("");
    setStreamReasoning("");
    setStreamSteps([]);
    setPendingApprovals([]);
    setApprovalBusyById({});
    approvalBusyRef.current.clear();
  }, [activeConvId]);

  const resetStream = useCallback(() => {
    invalidateGeneration();
    setStreaming(false);
    setStreamContent("");
    setStreamReasoning("");
    setStreamSteps([]);
  }, [invalidateGeneration]);

  const clearConversationStream = useCallback(() => {
    resetStream();
    failedRequest.current = null;
    lastRequest.current = null;
    setPendingApprovals([]);
  }, [resetStream]);

  const stopGeneration = useCallback(() => {
    resetStream();
    const version = generation.current;
    if (activeConvId) {
      const convId = activeConvId;
      csrfFetch(`/api/ai/conversations/${convId}`)
        .then((data) => {
          // The user may have opened another chat while this was in flight:
          // its transcript would then replace that chat's messages.
          if (convId !== activeConvIdRef.current || version !== generation.current) return;
          if (data.conversation?.messages)
            setMessages(data.conversation.messages);
        })
        .catch(() => { if (version === generation.current) addToast("error", t("aiPage.stopRefreshFailed")); });
    }
  }, [activeConvId, addToast, resetStream, setMessages, t]);

  const refreshActiveMessages = useCallback(async () => {
    if (!activeConvId) return;
    const convId = activeConvId;
    const version = generation.current;
    const data = await csrfFetch(`/api/ai/conversations/${convId}`);
    if (convId !== activeConvIdRef.current || version !== generation.current) return;
    if (data.conversation?.messages) setMessages(data.conversation.messages);
  }, [activeConvId, setMessages]);

  const decideApproval = useCallback(
    async (approval: ToolApprovalNeeded, action: "confirm" | "reject") => {
      if (approvalBusyRef.current.has(approval.actionId)) return;
      approvalBusyRef.current.add(approval.actionId);
      setApprovalBusyById((prev) => ({ ...prev, [approval.actionId]: true }));
      try {
        const decision = await csrfFetch(`/api/ai/hosted-actions/${approval.actionId}`, {
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
        const status = decision?.action?.status;
        if (decision?.success === false || status === "FAILED") {
          addToast("error", decision?.action?.errorMessage || t("aiPage.opFailed"));
        } else if (action === "reject") {
          addToast("success", t("aiPage.rejected"));
        } else if (status === "EXECUTING" || status === "PENDING_APPROVAL") {
          addToast("info", t(`aiPage.actionStatus.${status}`));
        } else {
          addToast("success", t(status === "APPROVED" ? "aiPage.actionStatus.APPROVED" : "aiPage.confirmed"));
        }
        await refreshActiveMessages().catch(() => addToast("error", t("aiPage.historyLoadFailed")));
      } catch (error) {
        addToast("error", getErrorMessage(error, t("aiPage.opFailed")));
        if (error instanceof ApiError && error.body.accepted === true) {
          setPendingApprovals((prev) => prev.filter((item) => item.actionId !== approval.actionId));
        }
        // "Not found" / "no longer pending" (decided in another tab, or by the time limit): the card of a streamed
        // approval stayed for good. The transcript says what became of the action, and the card follows it.
        if (error instanceof ApiError && (error.status === 404 || error.status === 409 || error.status === 422)) {
          await refreshActiveMessages().catch(() => undefined);
        }
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
    async (args: SendArgs, onAccepted?: (messageId: string | null) => void) => {
      // `streaming` is state, so it is stale for the whole tick in which the
      // first send was issued — two calls in one tick both pass that check and
      // the second overwrites `abortControllerRef`, orphaning the first stream
      // (it keeps reading and writing into the transcript with nothing able to
      // abort it). `abortControllerRef` is a ref and is therefore already
      // correct synchronously, so it is the reliable in-flight signal.
      //
      // The current UI cannot produce that interleaving — the textarea and both
      // buttons are disabled on `streaming`, and real keypresses land in separate
      // ticks — so this is hardening the hook's own contract rather than fixing a
      // reachable bug. It matters for any programmatic caller (retry, macro).
      if (!activeConvId || streaming || abortControllerRef.current) return;
      // Pin conversation for this generation so switch-away cannot write into another chat.
      const convIdAtSend = activeConvId;
      const body = { conversationId: convIdAtSend, ...args };
      const serialized = JSON.stringify(body);
      const validated = chatRequestSchema.safeParse(body);
      if (!validated.success) {
        const issue = validated.error.issues[0];
        const categoryLimit = issue?.code === "too_big" && issue.origin === "array";
        addToast("error", categoryLimit
          ? (locale === "zh" ? "每类附件每条消息最多可发送 8 个。" : "Each message can include up to 8 attachments of each type.")
          : issue?.message || t("aiPage.requestFailed"));
        return;
      }
      if (new TextEncoder().encode(serialized).byteLength > CHAT_REQUEST_MAX_BODY_BYTES) {
        addToast("error", t("aiPage.attachmentTooLarge", { name: t("aiPage.attachmentHint"), limit: 32 }));
        return;
      }
      const version = ++generation.current;
      const current = () => generation.current === version && activeConvIdRef.current === convIdAtSend;
      const abortController = new AbortController();
      abortControllerRef.current = abortController;
      setStreaming(true);
      setStreamContent("");
      setStreamReasoning("");
      setStreamSteps([]);
      // Track terminal outcome. `finally` used to wipe `streamContent` while
      // `AiMessageList` only renders stream bubbles while `streaming===true`,
      // so HTTP/SSE/network errors were invisible and the optimistic user
      // bubble could vanish after a silent server refresh.
      let terminalError: string | null = null;
      let accepted = false;
      let completedSuccessfully = false;
      let aborted = false;
      // What arrived before a response that ended without "done" or "error".
      let incomplete: { content: string; reasoning: string } | null = null;
      try {
        const response = await csrfFetch<Response>("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serialized,
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
        if (!current()) return;
        const messageId = response.headers?.get("X-AI-User-Message-Id") ?? null;
        accepted = true;
        failedRequest.current = null;
        lastRequest.current = { conversationId: convIdAtSend, messageId, args };
        onAccepted?.(messageId);
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
          if (!current()) { await reader.cancel(); break; }
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
                  id: `stream-${randomId()}`,
                  conversationId: convIdAtSend,
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
                if (convIdAtSend === activeConvIdRef.current) {
                  setMessages((prev) => [...prev, assistantMsg]);
                }
              } else if (parsed.type === "error") {
                incomplete = { content: finalContent, reasoning: finalReasoning };
                terminalError =
                  typeof parsed.error === "string" && parsed.error
                    ? parsed.error
                    : t("aiPage.requestFailed");
              } else if (parsed.type === "tool_call") {
                const tc = parsed.toolCall as ToolCallEvent;
                setStreamSteps((prev) => upsertStreamStep(prev, {
                  toolCallId: tc.id,
                  actionType: tc.actionType,
                  name: tc.actionName,
                  state: tc.autoApproved ? "running" : "awaiting",
                  riskLevel: tc.riskLevel,
                }));
              } else if (parsed.type === "tool_result") {
                const toolCallId = typeof parsed.toolCallId === "string" ? parsed.toolCallId : "";
                setStreamSteps((prev) => upsertStreamStep(prev, { toolCallId, state: parsed.success === true ? "succeeded" : "failed" }));
              } else if (parsed.type === "tool_approval_needed") {
                const approval = parsed as ToolApprovalNeeded;
                setPendingApprovals((prev) => [...prev, approval]);
                setStreamSteps((prev) => upsertStreamStep(prev, {
                  toolCallId: approval.toolCallId,
                  actionType: approval.actionType,
                  name: approval.actionName,
                  state: "awaiting",
                  riskLevel: approval.riskLevel,
                }));
              }
            } catch {
              // Skip malformed SSE chunk
            }
          }
        }
        // The response ended without its "done" or "error": the answer is not
        // complete. Ending quietly cleared the text already on screen.
        if (!completedSuccessfully && !terminalError) {
          incomplete = { content: finalContent, reasoning: finalReasoning };
          terminalError = t("aiPage.streamIncomplete");
        }
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === "AbortError") {
          aborted = true;
        } else {
          terminalError = t("aiPage.networkError");
        }
      } finally {
        if (current()) {
          setStreaming(false);
          setStreamContent("");
          setStreamReasoning("");
          setStreamSteps([]);
          abortControllerRef.current = null;
          // Drop all transcript writes if the user switched conversations mid-stream.
          if (terminalError) {
            if (incomplete && (incomplete.content || incomplete.reasoning)) {
              const partial: Message = {
                id: `stream-partial-${randomId()}`,
                conversationId: convIdAtSend,
                role: "assistant",
                content: incomplete.content,
                reasoningContent: incomplete.reasoning || null,
                imageUrls: "[]",
                model: activeConv?.model || null,
                inputTokens: null,
                outputTokens: null,
                latencyMs: null,
                createdAt: new Date().toISOString(),
              };
              setMessages((prev) => [...prev, partial]);
            }
            const errorMsg = streamErrorMessage({ conversationId: convIdAtSend, text: terminalError, model: activeConv?.model || null });
            failedRequest.current = { conversationId: convIdAtSend, errorMessageId: errorMsg.id, args, onAccepted: accepted ? undefined : onAccepted };
            setMessages((prev) => [...prev, errorMsg]);
            addToast("error", terminalError);
          } else if (completedSuccessfully || aborted) {
            try {
              const data = await csrfFetch(
                `/api/ai/conversations/${convIdAtSend}`,
              );
              // Checked again after the read: a switch during it must not
              // put this chat's transcript under the one now open.
              if (current() && data.conversation?.messages)
                setMessages(data.conversation.messages);
            } catch {
              // Keep the local transcript, but tell the user the server copy may lag.
              if (current()) addToast("error", t("aiPage.refreshMessagesFailed"));
            }
          }
          if (current()) await refreshConversations();
        }
      }
    },
    [
      activeConvId,
      activeConv?.model,
      addToast,
      refreshConversations,
      setMessages,
      t,
      streaming,
      locale,
    ],
  );

  const retryFailedMessage = useCallback((id: string) => {
    const failed = failedRequest.current;
    if (failed?.conversationId === activeConvId && failed.errorMessageId === id) return sendMessage(failed.args, failed.onAccepted);
  }, [activeConvId, sendMessage]);

  return {
    retryFailedMessage,
    streaming,
    streamContent,
    streamReasoning,
    streamSteps,
    pendingApprovals,
    setPendingApprovals,
    approvalBusyById,
    sendMessage,
    lastRequest,
    clearConversationStream,
    stopGeneration,
    decideApproval,
  };
}
