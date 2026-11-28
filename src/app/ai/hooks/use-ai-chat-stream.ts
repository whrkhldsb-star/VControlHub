"use client";

/**
 * `useAiChatStream` — owns send/stop/streaming state and SSE parsing
 * for the AI chat surface.
 *
 * Extracted from ai-client.tsx in R31. Lifts the inline SSE loop + abort
 * plumbing into a hook so the main client component is a thin orchestrator.
 *
 * R19: one stream runner serves both POST /api/ai/chat (a new user turn) and
 * POST /api/ai/conversations/[id]/continue (the assistant resuming after its
 * actions settled, with no made-up user message). Both speak the same SSE
 * frames: `content`, `reasoning`, `tool_call`, `tool_result`,
 * `tool_approval_needed`, `tool_execution`, `done`, `error`, plus keep-alive
 * comments (`: keepalive`) or `heartbeat` frames, which change nothing.
 *
 * Public surface:
 *   - state: `streaming`, `streamContent`, `streamReasoning`, `streamSteps`,
 *            `pendingApprovals`, `approvalBusyById`, `decidedActionIds`
 *   - actions: `sendMessage(params)`, `continueConversation()`, `stopGeneration()`,
 *              `decideApproval(approval, action, options?)`, `refreshActiveMessages()`
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
import { parseRiskReasons, summarizeToolData } from "../ai-hosted-action-utils";
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

/** An Auto / Full auto step, as a `tool_execution` frame reports it. */
export type ToolExecutionEvent = {
  conversationId: string;
  toolCallId: string;
  actionId: string;
  commandRequestId: string | null;
  phase: NonNullable<StreamStep["phase"]>;
  effectiveRisk?: string;
  decisionSource?: string;
  exitCode?: number | null;
};

/** How a stream ended, for whoever follows the actions it started. */
export type StreamEndEvent = {
  conversationId: string;
  kind: "chat" | "continue";
  outcome: "done" | "error" | "aborted";
};

type Args = {
  activeConv: ConvItem | null;
  activeConvId: string | null;
  setMessages: Dispatch<SetStateAction<Message[]>>;
  refreshConversations: () => Promise<void> | void;
  addToast: ToastFn;
  /** Every `tool_execution` frame of the conversation that is open. */
  onToolExecution?: (event: ToolExecutionEvent) => void;
  /** After a stream of the conversation that is open ends, however it ended. */
  onStreamEnd?: (event: StreamEndEvent) => void;
};

export type SendArgs = {
  content: string;
  imageUrls: string[];
  imageBase64: { mimeType: string; data: string }[];
  fileAttachments: { name: string; content: string }[];
};

export type ApprovalDecisionOptions = {
  /** execute_command only: the command as the requester edited it. Sent only when it differs. */
  editedCommand?: string;
  /** The requester ticked "I understand" on a critical / denylisted command. */
  acknowledgeCritical?: boolean;
};

/** What a decision led to, so the page can follow it: a run to watch, a review receipt, or a settled card. */
export type ApprovalOutcome =
  | { kind: "executing"; actionId: string; conversationId: string; commandRequestId: string | null }
  | { kind: "review"; actionId: string; conversationId: string; commandRequestId: string | null }
  | { kind: "settled"; actionId: string; conversationId: string; status: string | null }
  | { kind: "failed"; actionId: string; conversationId: string };

const EXECUTION_PHASES = new Set<NonNullable<StreamStep["phase"]>>(["running", "completed", "failed", "timeout", "awaiting_review"]);

function text(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * Adds a step, or updates the one with the same call id: a call is reported, then answered. A pure function for
 * state updaters (React runs those twice in development).
 */
export function upsertStreamStep(steps: StreamStep[], next: Partial<StreamStep> & { toolCallId: string }): StreamStep[] {
  const index = steps.findIndex((step) => step.toolCallId === next.toolCallId);
  if (index === -1) return [...steps, { name: null, state: "running", ...next }];
  return steps.map((step, i) => (i === index ? { ...step, ...next, name: next.name ?? step.name } : step));
}

/** A `tool_result` frame as a step update: its state, and what the answer says (no key is set to undefined). */
export function toolResultStepUpdate(frame: Record<string, unknown>): Partial<StreamStep> & { toolCallId: string } {
  const toolCallId = typeof frame.toolCallId === "string" ? frame.toolCallId : "";
  const summary = summarizeToolData(frame.data);
  return {
    toolCallId,
    state: frame.success === true ? "succeeded" : "failed",
    ...(text(frame.actionId) ? { actionId: text(frame.actionId) } : {}),
    ...(summary.count !== undefined ? { resultCount: summary.count } : {}),
    ...(summary.exitCode !== undefined ? { exitCode: summary.exitCode } : {}),
    ...(summary.error ? { error: summary.error } : {}),
    ...(summary.output ? { output: summary.output } : {}),
  };
}

/** A `tool_execution` frame as a step update, or null when the frame is not one the page understands. */
export function toolExecutionStepUpdate(frame: Record<string, unknown>): (Partial<StreamStep> & { toolCallId: string }) | null {
  const toolCallId = text(frame.toolCallId);
  const phase = frame.phase as StreamStep["phase"];
  if (!toolCallId || !phase || !EXECUTION_PHASES.has(phase)) return null;
  return {
    toolCallId,
    auto: true,
    phase,
    state: phase === "completed" ? "succeeded" : phase === "failed" ? "failed" : phase === "awaiting_review" ? "awaiting" : "running",
    ...(text(frame.actionId) ? { actionId: text(frame.actionId) } : {}),
    ...(text(frame.commandRequestId) ? { commandRequestId: text(frame.commandRequestId) } : {}),
    ...(text(frame.effectiveRisk) ? { riskLevel: text(frame.effectiveRisk) } : {}),
    ...(text(frame.decisionSource) ? { decisionSource: text(frame.decisionSource) } : {}),
    ...(typeof frame.exitCode === "number" ? { exitCode: frame.exitCode } : {}),
  };
}

/** A `tool_approval_needed` frame as the card it asks for. */
export function approvalFromFrame(frame: Record<string, unknown>): ToolApprovalNeeded {
  const approval = frame as unknown as ToolApprovalNeeded;
  const riskReasons = parseRiskReasons(frame.riskReasons);
  const effectiveRisk = text(frame.effectiveRisk);
  return {
    toolCallId: approval.toolCallId,
    actionId: approval.actionId,
    actionName: approval.actionName,
    actionType: approval.actionType,
    riskLevel: effectiveRisk ?? approval.riskLevel,
    params: approval.params && typeof approval.params === "object" ? approval.params : {},
    server: approval.server ?? null,
    ...(effectiveRisk ? { effectiveRisk } : {}),
    ...(riskReasons.length > 0 ? { riskReasons } : {}),
    ...(frame.denylisted === true ? { denylisted: true } : {}),
    ...(typeof frame.willExecuteInline === "boolean" ? { willExecuteInline: frame.willExecuteInline } : {}),
  };
}

/** One `data:` line's JSON, or null for comments, other fields and blank keep-alive lines. */
function sseData(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  return trimmed.slice(5).trimStart();
}

export function useAiChatStream({
  activeConv,
  activeConvId,
  setMessages,
  refreshConversations,
  addToast,
  onToolExecution,
  onStreamEnd,
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
  // Cards whose decision the server accepted. The transcript still shows them pending until it is read again;
  // without this the card came back, its buttons enabled, between the answer and the refresh.
  const [decidedActionIds, setDecidedActionIds] = useState<ReadonlySet<string>>(() => new Set());
  const generation = useRef(0);
  const failedRequest = useRef<{
    kind: "chat" | "continue"; conversationId: string; errorMessageId: string; args?: SendArgs; onAccepted?: (messageId: string | null) => void;
  } | null>(null);
  const lastRequest = useRef<{ conversationId: string; messageId: string | null; args: SendArgs } | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const approvalBusyRef = useRef<Set<string>>(new Set());
  const callbacksRef = useRef({ onToolExecution, onStreamEnd });

  useEffect(() => {
    callbacksRef.current = { onToolExecution, onStreamEnd };
  }, [onToolExecution, onStreamEnd]);

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
    setDecidedActionIds(new Set());
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
    async (
      approval: ToolApprovalNeeded,
      action: "confirm" | "reject",
      options?: ApprovalDecisionOptions,
    ): Promise<ApprovalOutcome | null> => {
      if (approvalBusyRef.current.has(approval.actionId)) return null;
      const conversationId = activeConvId ?? "";
      approvalBusyRef.current.add(approval.actionId);
      setApprovalBusyById((prev) => ({ ...prev, [approval.actionId]: true }));
      const accept = () => {
        setPendingApprovals((prev) => prev.filter((item) => item.actionId !== approval.actionId));
        setDecidedActionIds((prev) => new Set(prev).add(approval.actionId));
      };
      try {
        const body: Record<string, unknown> = action === "reject"
          ? { action, reason: t("aiPage.userDenied") }
          : { action };
        if (action === "confirm" && options?.editedCommand !== undefined) body.editedCommand = options.editedCommand;
        if (action === "confirm" && options?.acknowledgeCritical === true) body.acknowledgeCritical = true;
        const decision = await csrfFetch(`/api/ai/hosted-actions/${approval.actionId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        accept();
        const status: string | undefined = decision?.action?.status;
        const commandRequestId: string | null =
          (typeof decision?.commandRequestId === "string" && decision.commandRequestId) ||
          (typeof decision?.action?.commandRequestId === "string" && decision.action.commandRequestId) ||
          null;
        let outcome: ApprovalOutcome;
        if (decision?.success === false || status === "FAILED") {
          addToast("error", decision?.action?.errorMessage || decision?.error || t("aiPage.opFailed"));
          outcome = { kind: "failed", actionId: approval.actionId, conversationId };
        } else if (action === "reject") {
          addToast("success", t("aiPage.rejected"));
          outcome = { kind: "settled", actionId: approval.actionId, conversationId, status: status ?? "REJECTED" };
        } else if (decision?.executedInline === true || status === "EXECUTING") {
          // Runs now: the page stays here and follows it (never a bounce to /requests).
          addToast("info", t("aiPage.actionStatus.EXECUTING"));
          outcome = { kind: "executing", actionId: approval.actionId, conversationId, commandRequestId };
        } else if (decision?.requiresApproval === true) {
          // Filed for another reviewer: it has not run, and the receipt says so.
          addToast("success", t("aiPage.live.sentForReviewToast"));
          outcome = { kind: "review", actionId: approval.actionId, conversationId, commandRequestId };
        } else if (status === "PENDING_APPROVAL") {
          addToast("info", t("aiPage.actionStatus.PENDING_APPROVAL"));
          outcome = { kind: "settled", actionId: approval.actionId, conversationId, status };
        } else {
          addToast("success", t(status === "APPROVED" ? "aiPage.actionStatus.APPROVED" : "aiPage.confirmed"));
          outcome = status === "APPROVED" && commandRequestId
            ? { kind: "review", actionId: approval.actionId, conversationId, commandRequestId }
            : { kind: "settled", actionId: approval.actionId, conversationId, status: status ?? null };
        }
        await refreshActiveMessages().catch(() => addToast("error", t("aiPage.historyLoadFailed")));
        return outcome;
      } catch (error) {
        addToast("error", getErrorMessage(error, t("aiPage.opFailed")));
        if (error instanceof ApiError && error.body.accepted === true) accept();
        // "Not found" / "no longer pending" (decided in another tab, or by the time limit): the card of a streamed
        // approval stayed for good. The transcript says what became of the action, and the card follows it.
        if (error instanceof ApiError && (error.status === 404 || error.status === 409 || error.status === 422)) {
          await refreshActiveMessages().catch(() => undefined);
        }
        return { kind: "failed", actionId: approval.actionId, conversationId };
      } finally {
        approvalBusyRef.current.delete(approval.actionId);
        setApprovalBusyById((prev) => {
          const { [approval.actionId]: _removed, ...rest } = prev;
          void _removed;
          return rest;
        });
      }
    },
    [activeConvId, addToast, refreshActiveMessages, t],
  );

  /**
   * Reads one SSE response into the stream bubble, then into the transcript. Shared by a new turn and by a
   * continuation: the frames are the same, and so are the failure rules (always visible, never in another chat).
   */
  const runStream = useCallback(
    async (input: {
      kind: "chat" | "continue";
      convIdAtSend: string;
      request: (signal: AbortSignal) => Promise<Response>;
      args?: SendArgs;
      onAccepted?: (messageId: string | null) => void;
    }) => {
      const { kind, convIdAtSend, args, onAccepted } = input;
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
      // A continuation refused because an action is still open: said once, not written into the transcript.
      let busyNotice = false;
      let accepted = false;
      let completedSuccessfully = false;
      let aborted = false;
      // What arrived before a response that ended without "done" or "error".
      let incomplete: { content: string; reasoning: string } | null = null;
      let finalContent = "";
      let finalReasoning = "";

      const applyFrame = (parsed: Record<string, unknown>) => {
        switch (parsed.type) {
          case "content":
          case "delta": {
            const chunk = typeof parsed.content === "string" ? parsed.content : typeof parsed.delta === "string" ? parsed.delta : "";
            if (!chunk) return;
            finalContent += chunk;
            setStreamContent(finalContent);
            return;
          }
          case "reasoning": {
            if (typeof parsed.content !== "string") return;
            finalReasoning += parsed.content;
            setStreamReasoning(finalReasoning);
            return;
          }
          case "heartbeat":
            // Keep-alive while a command runs inline: nothing to show, nothing to reset.
            return;
          case "done": {
            completedSuccessfully = true;
            const assistantMsg: Message = {
              id: `stream-${randomId()}`,
              conversationId: convIdAtSend,
              role: "assistant",
              content: finalContent || t("aiPage.noResponse"),
              reasoningContent: finalReasoning || null,
              imageUrls: "[]",
              model: activeConv?.model || null,
              inputTokens: typeof parsed.inputTokens === "number" ? parsed.inputTokens : null,
              outputTokens: typeof parsed.outputTokens === "number" ? parsed.outputTokens : null,
              latencyMs: typeof parsed.latencyMs === "number" ? parsed.latencyMs : null,
              createdAt: new Date().toISOString(),
            };
            if (convIdAtSend === activeConvIdRef.current) {
              setMessages((prev) => [...prev, assistantMsg]);
            }
            return;
          }
          case "error": {
            incomplete = { content: finalContent, reasoning: finalReasoning };
            terminalError =
              typeof parsed.error === "string" && parsed.error
                ? parsed.error
                : t("aiPage.requestFailed");
            return;
          }
          case "tool_call": {
            const tc = parsed.toolCall as ToolCallEvent | undefined;
            if (!tc?.id) return;
            setStreamSteps((prev) => upsertStreamStep(prev, {
              toolCallId: tc.id,
              actionType: tc.actionType,
              name: tc.actionName,
              state: tc.autoApproved ? "running" : "awaiting",
              riskLevel: tc.riskLevel,
            }));
            return;
          }
          case "tool_result": {
            const update = toolResultStepUpdate(parsed);
            setStreamSteps((prev) => upsertStreamStep(prev, update));
            return;
          }
          case "tool_execution": {
            const update = toolExecutionStepUpdate(parsed);
            if (!update) return;
            setStreamSteps((prev) => upsertStreamStep(prev, update));
            const actionId = text(parsed.actionId);
            if (actionId && current()) {
              callbacksRef.current.onToolExecution?.({
                conversationId: convIdAtSend,
                toolCallId: update.toolCallId,
                actionId,
                commandRequestId: text(parsed.commandRequestId) ?? null,
                phase: update.phase!,
                ...(text(parsed.effectiveRisk) ? { effectiveRisk: text(parsed.effectiveRisk) } : {}),
                ...(text(parsed.decisionSource) ? { decisionSource: text(parsed.decisionSource) } : {}),
                ...(typeof parsed.exitCode === "number" ? { exitCode: parsed.exitCode } : {}),
              });
            }
            return;
          }
          case "tool_approval_needed": {
            const approval = approvalFromFrame(parsed);
            if (!approval.actionId) return;
            setPendingApprovals((prev) => [...prev.filter((item) => item.actionId !== approval.actionId), approval]);
            setStreamSteps((prev) => upsertStreamStep(prev, {
              toolCallId: approval.toolCallId,
              actionType: approval.actionType,
              name: approval.actionName,
              state: "awaiting",
              riskLevel: approval.riskLevel,
              actionId: approval.actionId,
            }));
            return;
          }
          default:
            return;
        }
      };
      const applyLine = (line: string) => {
        const data = sseData(line);
        if (data === null || data === "") return;
        try {
          const parsed: unknown = JSON.parse(data);
          if (parsed && typeof parsed === "object") applyFrame(parsed as Record<string, unknown>);
        } catch {
          // Skip malformed SSE chunk
        }
      };

      try {
        const response = await input.request(abortController.signal);
        if (!response.ok) {
          const err = await response
            .json()
            .catch(() => ({ error: t("aiPage.requestFailed") }));
          if (kind === "continue" && response.status === 409) {
            busyNotice = true;
            return;
          }
          terminalError =
            (typeof err.error === "string" && err.error) ||
            (typeof err.message === "string" && err.message) ||
            t(kind === "continue" ? "aiPage.continue.failed" : "aiPage.requestFailed");
          return;
        }
        if (!current()) return;
        accepted = true;
        failedRequest.current = null;
        if (kind === "chat" && args) {
          const messageId = response.headers?.get("X-AI-User-Message-Id") ?? null;
          lastRequest.current = { conversationId: convIdAtSend, messageId, args };
          onAccepted?.(messageId);
        }
        const reader = response.body?.getReader();
        if (!reader) {
          terminalError = t("aiPage.requestFailed");
          return;
        }
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (!current()) { await reader.cancel(); break; }
          if (done) {
            // A last frame without its blank line still counts.
            buffer += decoder.decode();
            if (buffer.trim()) applyLine(buffer);
            break;
          }
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";
          for (const line of lines) applyLine(line);
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
          if (busyNotice) {
            addToast("info", t("aiPage.continue.busy"));
          } else if (terminalError) {
            const failure = incomplete as { content: string; reasoning: string } | null;
            if (failure && (failure.content || failure.reasoning)) {
              const partial: Message = {
                id: `stream-partial-${randomId()}`,
                conversationId: convIdAtSend,
                role: "assistant",
                content: failure.content,
                reasoningContent: failure.reasoning || null,
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
            failedRequest.current = kind === "chat"
              ? { kind, conversationId: convIdAtSend, errorMessageId: errorMsg.id, args, onAccepted: accepted ? undefined : onAccepted }
              : { kind, conversationId: convIdAtSend, errorMessageId: errorMsg.id };
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
          if (current()) {
            callbacksRef.current.onStreamEnd?.({
              conversationId: convIdAtSend,
              kind,
              outcome: completedSuccessfully ? "done" : aborted ? "aborted" : "error",
            });
            await refreshConversations();
          }
        }
      }
    },
    [activeConv?.model, addToast, refreshConversations, setMessages, t],
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
      await runStream({
        kind: "chat",
        convIdAtSend,
        args,
        onAccepted,
        request: (signal) => csrfFetch<Response>("/api/ai/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: serialized,
          signal,
          raw: true,
        }),
      });
    },
    [activeConvId, addToast, runStream, streaming, locale, t],
  );

  /**
   * Resume the assistant after the actions of its last turn settled (POST …/continue): it reads their real
   * outcome and finishes the answer. No user message is written. Returns false when a stream is already open.
   */
  const continueConversation = useCallback(async (): Promise<boolean> => {
    if (!activeConvId || streaming || abortControllerRef.current) return false;
    const convIdAtSend = activeConvId;
    await runStream({
      kind: "continue",
      convIdAtSend,
      request: (signal) => csrfFetch<Response>(`/api/ai/conversations/${convIdAtSend}/continue`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal,
        raw: true,
      }),
    });
    return true;
  }, [activeConvId, runStream, streaming]);

  const retryFailedMessage = useCallback((id: string) => {
    const failed = failedRequest.current;
    if (failed?.conversationId !== activeConvId || failed.errorMessageId !== id) return;
    if (failed.kind === "continue") return continueConversation().then(() => undefined);
    if (failed.args) return sendMessage(failed.args, failed.onAccepted);
  }, [activeConvId, continueConversation, sendMessage]);

  return {
    retryFailedMessage,
    streaming,
    streamContent,
    streamReasoning,
    streamSteps,
    pendingApprovals,
    setPendingApprovals,
    approvalBusyById,
    decidedActionIds,
    sendMessage,
    continueConversation,
    lastRequest,
    clearConversationStream,
    stopGeneration,
    decideApproval,
    refreshActiveMessages,
  };
}
