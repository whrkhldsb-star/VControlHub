"use client";

/**
 * Chat transcript renderer for the AI page.
 *
 * Owns the scrollable message viewport: history messages, streaming
 * preview bubble, "thinking…" placeholder, hosted-action approval
 * panel, drag-drop wiring, and the bottom-anchor ref used for
 * auto-scroll.
 *
 * Extracted from ai-client.tsx in R31. Pure presentation — the parent
 * still drives streaming/approval state.
 *
 * R19: approval cards are AiToolApprovalCard (risk and reasons, inline edit,
 * critical acknowledgement); an action the page follows shows its live run or
 * review receipt under its transcript entry; the streaming timeline shows what
 * each call returned; and a settled turn offers to continue the answer.
 */
import Image from "next/image";
import { type DragEvent, type RefObject, useMemo } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { renderContent } from "./ai-markdown-renderer";
import type { Message, ModelCapabilities, StreamStep, ToolApprovalNeeded } from "./ai-types";
import { type AiCapabilities, DEFAULT_AI_CAPABILITIES } from "./ai-automation-mode";
import { formatAllowedTypes } from "./ai-file-helpers";
import { hostedActionCommandRequestId } from "./ai-hosted-action-utils";
import { isStreamErrorMessage } from "./ai-stream-error";
import { AlertTriangle, ArrowDown, ArrowUp } from "@/components/icons";
import { Badge, Notice } from "@/components/ui-primitives";
import { CountBadge } from "@/components/page-shell";
import { AiCopyButton, type AiCopyLabels } from "./ai-copy-button";
import { AiContinueBanner } from "./ai-continue-banner";
import { AiLiveActionPanel } from "./ai-live-action-panel";
import { AiStreamSteps } from "./ai-stream-steps";
import { AiToolApprovalCard, useLabel } from "./ai-tool-approval-card";
import type { ApprovalDecisionOptions } from "./hooks/use-ai-chat-stream";
import type { ContinuationView } from "./hooks/use-ai-continuation";
import type { TrackedAction } from "./hooks/use-hosted-action-tracker";

const EMPTY_TOOL_CONTENT = new Set([
  "(无响应内容)",
  "(no response content)",
  "(无响应)",
  "(no response)",
]);

function formatActionResult(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2).slice(0, 1200);
  } catch {
    return raw.slice(0, 1200);
  }
}

function actionStatusClass(status: string): string {
  if (status === "COMPLETED") return "text-[var(--success)]";
  if (status === "FAILED" || status === "REJECTED" || status === "CANCELLED") {
    return "text-[var(--danger)]";
  }
  if (status === "EXECUTING") return "text-[var(--accent)]";
  return "text-[var(--warning)]";
}

type Props = {
  messages: Message[];
  streaming: boolean;
  streamContent: string;
  streamReasoning: string;
  /** The answer's tool calls so far, shown under its text. */
  streamSteps?: StreamStep[];
  pendingApprovals: ToolApprovalNeeded[];
  approvalBusyById: Record<string, boolean>;
  onApproval: (
    approval: ToolApprovalNeeded,
    action: "confirm" | "reject",
    options?: ApprovalDecisionOptions,
  ) => void;
  currentModelCaps: ModelCapabilities;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  /** Re-send the latest accepted turn. An error bubble retries its own request. */
  onRegenerate?: () => void;
  onRetry?: (messageId: string) => void;
  /** Why the conversation's history could not be loaded; shown instead of "nothing said yet". */
  loadError?: string | null;
  onRetryLoad?: () => void;
  /** What the account may do: predicts whether a confirmation runs now or goes to review. */
  capabilities?: AiCapabilities;
  /** Actions the page follows (running, waiting for review, just settled), by action id. */
  trackedActions?: Record<string, TrackedAction>;
  onCancelAction?: (actionId: string) => void;
  /** Continue the answer after its actions settled. */
  continuation?: ContinuationView;
  /** `/ai?c=…&action=<id>`: the card to bring into view. */
  highlightActionId?: string | null;
};

export function AiMessageList({
  messages,
  streaming,
  streamContent,
  streamReasoning,
  streamSteps = [],
  pendingApprovals,
  approvalBusyById,
  onApproval,
  currentModelCaps,
  messagesEndRef,
  onDrop,
  onDragOver,
  onRegenerate,
  onRetry,
  loadError,
  onRetryLoad,
  capabilities = DEFAULT_AI_CAPABILITIES,
  trackedActions = {},
  onCancelAction,
  continuation,
  highlightActionId = null,
}: Props) {
  const { t } = useI18n();
  const label = useLabel();
  const actionDisplayName = (actionType: string, fallback: string) => label(`aiPage.actionType.${actionType}`, fallback);
  const riskDisplayName = (riskLevel: string) => label(`aiPage.risk.${riskLevel}`, riskLevel);
  // Cancelling needs command:execute (a submitter without it may only withdraw a request still under review).
  const canCancel = capabilities.canExecute;
  const cancel = (actionId: string) => onCancelAction?.(actionId);
  // Tool-role rows are never rendered; filter once per messages change —
  // re-running this on every stream chunk was pure waste, and the index math
  // below needs the filtered array anyway.
  const visibleMsgs = useMemo(
    () => messages.filter((msg) => msg.role !== "tool"),
    [messages],
  );
  const lastIdx = visibleMsgs.length - 1;
  const copyLabels: AiCopyLabels = {
    label: t("aiPage.copyCode"),
    copiedLabel: t("aiPage.copyOrCopied"),
    failedLabel: t("aiPage.copyFailed"),
  };
  return (
    <div
      className="flex-1 min-h-0 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 space-y-4"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {loadError && messages.length === 0 && !streaming ? (
        <Notice tone="danger" action={onRetryLoad ? { label: t("common.retry"), onClick: onRetryLoad } : undefined}>
          {loadError}
        </Notice>
      ) : null}
      {messages.length === 0 && !streaming && !loadError && (
        <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)]">
          <svg
            className="w-12 h-12 mb-3 opacity-30"
            fill="none"
            stroke="currentColor"
            width="24" height="24" viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1}
              d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
            />
          </svg>
          <p className="text-sm">{t("aiPage.placeholder")}</p>
          <p className="text-xs mt-1 text-[var(--text-muted)]">
            {t("aiPage.dragPasteHint", { types: formatAllowedTypes(currentModelCaps, t) })}
          </p>
        </div>
      )}

      {visibleMsgs.map((msg, idx) => {
        const hostedActions = msg.hostedActions ?? [];
        const hasToolOnlyContent =
          hostedActions.length > 0 &&
          (!msg.content.trim() || EMPTY_TOOL_CONTENT.has(msg.content.trim()));
        const isErrorBubble = isStreamErrorMessage(msg);
        const showRegenerate = Boolean(onRegenerate) && idx === lastIdx && msg.role === "assistant" && !streaming && !isErrorBubble;
        const showRetry = Boolean(onRetry) && idx === lastIdx && isErrorBubble && !streaming;
        return (
          <div
          key={msg.id}
          className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
          >
          {msg.role !== "user" && (
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)]">
              <svg
                className="h-4 w-4 text-[var(--accent)]"
                fill="none"
                stroke="currentColor"
                width="24" height="24" viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.09-.75.202-.25.112-.499.268-.75.468M9.75 3.104c.251.023.501.09.75.202.25.112.499.268.75.468M5 14.5l-1.43 1.43a2.25 2.25 0 01-3.182 0l-.03-.03a2.25 2.25 0 010-3.182L5 14.5zm0 0l6.25-6.25"
                />
              </svg>
            </div>
          )}
          <div
          data-error-reply={isErrorBubble ? "" : undefined}
          className={`max-w-[88%] sm:max-w-[80%] rounded-2xl border px-3 py-2 text-sm leading-relaxed sm:px-4 sm:py-2.5 ${
            isErrorBubble
              ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]"
              : msg.role === "user"
                ? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--text-primary)]"
                : "border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]"
          }`}
        >
            {msg.reasoningContent && (
              <details className="mb-2">
                <summary className="text-xs text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-muted)]">
                  {t("aiPage.thinkingProcess")}
                </summary>
                <div className="mt-1 p-2 bg-[var(--input-bg)] rounded-lg text-xs text-[var(--text-muted)] whitespace-pre-wrap">
                  {msg.reasoningContent}
                </div>
              </details>
            )}
            {!hasToolOnlyContent && (isErrorBubble ? (
              // The colours say "failed" only to those who see them: the icon says it too.
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} aria-hidden className="mt-1 shrink-0" />
                <div className="min-w-0 break-words">{renderContent(msg.content, { copy: copyLabels })}</div>
              </div>
            ) : (
              <div className="break-words">{renderContent(msg.content, { copy: copyLabels })}</div>
            ))}
            {hostedActions.length > 0 && (
              <div className="mt-2 space-y-2 border-t border-[var(--border-subtle)] pt-2">
                <div className="text-xs font-medium text-[var(--text-muted)]">
                  {t("aiPage.toolActivity")}
                </div>
                {hostedActions.map((action) => {
                  const risk = action.effectiveRisk || action.riskLevel;
                  const tracked = trackedActions[action.id];
                  const requested = action.status === "APPROVED" && Boolean(hostedActionCommandRequestId(action));
                  return (
                  <div
                    key={action.id}
                    data-hosted-action={action.id}
                    className="border-l-2 border-[var(--border)] pl-2.5"
                  >
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-medium text-[var(--text-primary)]">
                        {actionDisplayName(
                          action.actionType,
                          action.actionName,
                        )}
                      </span>
                      <span
                        className={`text-xs font-semibold ${actionStatusClass(action.status)}`}
                      >
                        {t(
                          requested
                            ? "aiPage.actionStatus.COMMAND_REQUESTED"
                            : `aiPage.actionStatus.${action.status}`,
                        )}
                      </span>
                      {action.decisionSource ? (
                        <Badge tone="neutral">{label(`requestsPage.decisionSource.${action.decisionSource}`, action.decisionSource)}</Badge>
                      ) : null}
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                      <span>{action.actionType}</span>
                      <span className={risk === "critical" ? "text-[var(--danger)]" : risk === "high" ? "text-[var(--warning)]" : undefined}>
                        {t("aiPage.riskLabel")}
                        {riskDisplayName(risk)}
                      </span>
                      {action.server && (
                        <span>
                          {action.server.name} ({action.server.host})
                        </span>
                      )}
                    </div>
                    {action.errorMessage && (
                      <p className="mt-1 break-words text-xs text-[var(--danger)]">
                        {action.errorMessage}
                      </p>
                    )}
                    {tracked && (tracked.phase !== "settled" || tracked.live) ? (
                      <AiLiveActionPanel action={tracked} canCancel={canCancel || tracked.phase === "review"} onCancel={cancel} />
                    ) : null}
                    {action.result && action.result !== "null" && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          {t("aiPage.actionResult")}
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border-l border-[var(--border)] pl-2 text-xs text-[var(--text-secondary)]">
                          {formatActionResult(action.result)}
                        </pre>
                      </details>
                    )}
                  </div>
                  );
                })}
              </div>
            )}
            {(() => {
              try {
                const urls: string[] = JSON.parse(msg.imageUrls || "[]");
                if (urls.length === 0) return null;
                return (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {urls.map((url, i) => (
                      <Image
                        key={i}
                        src={url}
                        alt={t("aiPage.attachment", { index: i + 1 })}
                        width={200}
                        height={200}
                        unoptimized
                        className="max-w-[200px] max-h-[200px] rounded-lg object-cover border border-[var(--border)]"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display =
                            "none";
                        }}
                      />
                    ))}
                  </div>
                );
              } catch {
                return null;
              }
            })()}
            {msg.role === "assistant" &&
              (msg.inputTokens || msg.outputTokens || msg.latencyMs) && (
                <div className="mt-2 flex gap-3 text-xs text-[var(--text-muted)]">
                  {msg.model && <span>{msg.model}</span>}
                  {/* Sent and received tokens: the arrows were characters, and nothing said what they counted. */}
                  {msg.inputTokens != null && (
                    <span className="inline-flex items-center gap-0.5" title={t("aiPage.tokens.input")}>
                      <ArrowUp size={12} aria-hidden />
                      <span className="sr-only">{t("aiPage.tokens.input")}</span>
                      {msg.inputTokens}
                    </span>
                  )}
                  {msg.outputTokens != null && (
                    <span className="inline-flex items-center gap-0.5" title={t("aiPage.tokens.output")}>
                      <ArrowDown size={12} aria-hidden />
                      <span className="sr-only">{t("aiPage.tokens.output")}</span>
                      {msg.outputTokens}
                    </span>
                  )}
                  {msg.latencyMs != null && (
                    <span>{(msg.latencyMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              )}
            {!hasToolOnlyContent && (
              <div className="mt-1.5 flex items-center gap-3">
              <AiCopyButton text={msg.content} ariaLabel={t("aiPage.copyAria")} {...copyLabels} label={t("aiPage.copy")} />
              {(showRegenerate || showRetry) && (
                <button
                  type="button"
                  onClick={showRetry ? () => onRetry?.(msg.id) : onRegenerate}
                  className="flex items-center gap-1 text-xs text-[var(--text-muted)] transition hover:text-[var(--accent)]"
                >
                  <svg className="h-3 w-3" fill="none" stroke="currentColor" width="24" height="24" viewBox="0 0 24 24" aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  {showRetry ? t("aiPage.retry") : t("aiPage.regenerate")}
                </button>
              )}
              </div>
            )}
          </div>
          {msg.role === "user" && (
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-xs font-semibold text-[var(--accent)]">
              U
            </div>
          )}
          </div>
        );
      })}

      {/* Reasoning can stream before any answer text: it is shown on its own. */}
      {streaming && (streamContent || streamReasoning || streamSteps.length > 0) && (
        <div className="flex gap-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)]">
            <svg
              className="h-4 w-4 animate-pulse text-[var(--accent)]"
              fill="none"
              stroke="currentColor"
              width="24" height="24" viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5"
              />
            </svg>
          </div>
          <div data-tile className="max-w-[88%] px-3 py-2 text-sm leading-relaxed text-[var(--text-secondary)] sm:max-w-[80%] sm:px-4 sm:py-2.5">
            {streamReasoning && (
              <details open className="mb-2">
                <summary className="text-xs text-[var(--color-action-text)]/60 cursor-pointer">
                  {t("aiPage.thinking")}
                </summary>
                <div className="mt-1 p-2 bg-[var(--input-bg)] rounded-lg text-xs text-[var(--text-muted)] whitespace-pre-wrap">
                  {streamReasoning}
                </div>
              </details>
            )}
            {streamContent ? <div className="break-words">{renderContent(streamContent, { copy: copyLabels })}</div> : null}
            {streamSteps.length > 0 ? (
              <AiStreamSteps
                steps={streamSteps}
                separated={Boolean(streamContent)}
                trackedActions={trackedActions}
                canCancel={canCancel}
                onCancelAction={cancel}
              />
            ) : null}
          </div>
        </div>
      )}
      {streaming && !streamContent && !streamReasoning && streamSteps.length === 0 && (
        <div className="flex gap-3">
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)]">
            <div className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:300ms]" />
            </div>
          </div>
          <div data-tile className="px-4 py-2.5 text-sm text-[var(--text-muted)]">
            {t("aiPage.thinkingDetail")}
          </div>
        </div>
      )}
      {continuation && !streaming ? <AiContinueBanner view={continuation} /> : null}
      {pendingApprovals.length > 0 && (
        <div className="sticky bottom-0 z-10 border-t border-[var(--warning-border)] bg-[color-mix(in_srgb,var(--warning-bg)_96%,var(--surface))] px-2 py-2 shadow-[0_-8px_20px_rgba(0,0,0,0.16)] backdrop-blur sm:px-4">
          <div className="mb-2 flex items-center gap-2 text-xs font-medium text-[var(--warning)]">
            <span>{t("aiPage.pendingApprovalsTitle")}</span>
            <CountBadge>{pendingApprovals.length}</CountBadge>
          </div>
          <div className="space-y-2">
            {pendingApprovals.map((approval) => (
              <AiToolApprovalCard
                key={approval.actionId}
                approval={approval}
                busy={Boolean(approvalBusyById[approval.actionId])}
                capabilities={capabilities}
                highlighted={approval.actionId === highlightActionId}
                onDecide={(item, action, options) => void onApproval(item, action, options)}
              />
            ))}
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
