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
 */
import Image from "next/image";
import { type DragEvent, type RefObject } from "react";

import { useI18n } from "@/lib/i18n/use-locale";
import { copyToClipboard, renderContent } from "./ai-markdown-renderer";
import type { Message, ModelCapabilities, ToolApprovalNeeded } from "./ai-types";
import { formatAllowedTypes } from "./ai-file-helpers";

type Props = {
  messages: Message[];
  streaming: boolean;
  streamContent: string;
  streamReasoning: string;
  pendingApprovals: ToolApprovalNeeded[];
  approvalBusyById: Record<string, boolean>;
  onApproval: (
    approval: ToolApprovalNeeded,
    action: "confirm" | "reject",
  ) => void;
  copyFeedback: string | null;
  setCopyFeedback: (id: string | null) => void;
  currentModelCaps: ModelCapabilities;
  messagesEndRef: RefObject<HTMLDivElement | null>;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
};

export function AiMessageList({
  messages,
  streaming,
  streamContent,
  streamReasoning,
  pendingApprovals,
  approvalBusyById,
  onApproval,
  copyFeedback,
  setCopyFeedback,
  currentModelCaps,
  messagesEndRef,
  onDrop,
  onDragOver,
}: Props) {
  const { t } = useI18n();
  return (
    <div
      className="flex-1 overflow-y-auto px-3 py-3 sm:px-4 sm:py-4 space-y-4"
      onDrop={onDrop}
      onDragOver={onDragOver}
    >
      {messages.length === 0 && !streaming && (
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
          <p className="text-xs mt-1 text-[var(--text-disabled)]">
            {t("aiPage.dragPasteHint").replace(
              "{types}",
              formatAllowedTypes(currentModelCaps),
            )}
          </p>
        </div>
      )}

      {messages.map((msg) => (
        <div
          key={msg.id}
          className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
        >
          {msg.role !== "user" && (
            <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--color-action)] to-[var(--info)] flex items-center justify-center">
              <svg
                className="w-4 h-4 text-[var(--text-primary)]"
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
            className={`max-w-[88%] sm:max-w-[80%] rounded-2xl px-3 py-2 sm:px-4 sm:py-2.5 text-sm leading-relaxed ${
              msg.role === "user"
                ? "bg-[var(--color-action)]/15 text-[var(--text-primary)]"
                : "bg-[var(--surface)]/[0.04] text-[var(--text-secondary)]"
            }`}
          >
            {msg.reasoningContent && (
              <details className="mb-2">
                <summary className="text-[10px] text-[var(--text-muted)] cursor-pointer hover:text-[var(--text-muted)]">
                  {t("aiPage.thinkingProcess")}
                </summary>
                <div className="mt-1 p-2 bg-[var(--input-bg)] rounded-lg text-xs text-[var(--text-muted)] whitespace-pre-wrap">
                  {msg.reasoningContent}
                </div>
              </details>
            )}
            <div className="break-words">{renderContent(msg.content)}</div>
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
                        alt={t("aiPage.attachment").replace(
                          "{index}",
                          String(i + 1),
                        )}
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
                <div className="mt-2 flex gap-3 text-[10px] text-[var(--text-muted)]">
                  {msg.model && <span>{msg.model}</span>}
                  {msg.inputTokens != null && <span>↑{msg.inputTokens}</span>}
                  {msg.outputTokens != null && <span>↓{msg.outputTokens}</span>}
                  {msg.latencyMs != null && (
                    <span>{(msg.latencyMs / 1000).toFixed(1)}s</span>
                  )}
                </div>
              )}
            <button
              onClick={async () => {
                const ok = await copyToClipboard(msg.content);
                if (ok) {
                  setCopyFeedback(msg.id);
                  setTimeout(() => setCopyFeedback(null), 2000);
                }
              }}
              className="mt-1.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--color-action)] transition flex items-center gap-1"
            >
              <svg
                className="w-3 h-3"
                fill="none"
                stroke="currentColor"
                width="24" height="24" viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                />
              </svg>
              {copyFeedback === msg.id
                ? t("aiPage.copyOrCopied")
                : t("aiPage.copy")}
            </button>
          </div>
          {msg.role === "user" && (
            <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-[var(--surface-hover)] flex items-center justify-center text-[11px] font-semibold text-[var(--color-action)] uppercase">
              U
            </div>
          )}
        </div>
      ))}

      {streaming && streamContent && (
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--color-action)] to-[var(--info)] flex items-center justify-center">
            <svg
              className="w-4 h-4 text-[var(--text-primary)] animate-pulse"
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
          <div className="max-w-[88%] sm:max-w-[80%] rounded-2xl px-3 py-2 sm:px-4 sm:py-2.5 bg-[var(--surface)]/[0.04] text-[var(--text-secondary)] text-sm leading-relaxed">
            {streamReasoning && (
              <details open className="mb-2">
                <summary className="text-[10px] text-[var(--color-action)]/60 cursor-pointer">
                  {t("aiPage.thinking")}
                </summary>
                <div className="mt-1 p-2 bg-[var(--input-bg)] rounded-lg text-xs text-[var(--text-muted)] whitespace-pre-wrap">
                  {streamReasoning}
                </div>
              </details>
            )}
            <div className="break-words">{renderContent(streamContent)}</div>
          </div>
        </div>
      )}
      {streaming && !streamContent && !streamReasoning && (
        <div className="flex gap-3">
          <div className="flex-shrink-0 w-7 h-7 rounded-lg bg-gradient-to-br from-[var(--color-action)] to-[var(--info)] flex items-center justify-center">
            <div className="flex gap-0.5">
              <span className="w-1 h-1 bg-[var(--surface)] rounded-full animate-bounce [animation-delay:0ms]" />
              <span className="w-1 h-1 bg-[var(--surface)] rounded-full animate-bounce [animation-delay:150ms]" />
              <span className="w-1 h-1 bg-[var(--surface)] rounded-full animate-bounce [animation-delay:300ms]" />
            </div>
          </div>
          <div className="rounded-2xl px-4 py-2.5 bg-[var(--surface)]/[0.04] text-[var(--text-muted)] text-sm">
            {t("aiPage.thinkingDetail")}
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />

      {pendingApprovals.length > 0 && (
        <div className="px-4 py-2 border-t border-[var(--warning-border)] bg-[var(--warning-bg)]">
          <div className="text-xs text-[var(--warning)] font-medium mb-2">
            {t("aiPage.pendingApprovalsTitle").replace(
              "{count}",
              String(pendingApprovals.length),
            )}
          </div>
          <div className="space-y-2">
            {pendingApprovals.map((approval) => (
              <div
                key={approval.actionId}
                className="flex items-center justify-between bg-[var(--input-bg)] rounded-lg p-2.5"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text-primary)] font-medium">
                    {approval.actionName}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] truncate">
                    {t("aiPage.riskLabel")}
                    <span
                      className={
                        approval.riskLevel === "critical"
                          ? "text-[var(--danger)]"
                          : approval.riskLevel === "high"
                            ? "text-orange-400"
                            : approval.riskLevel === "medium"
                              ? "text-[var(--warning)]"
                              : "text-[var(--success)]"
                      }
                    >
                      {approval.riskLevel}
                    </span>
                    {typeof approval.params.serverId === "string" && (
                      <span className="ml-2">
                        {t("aiPage.serverLabel").replace(
                          "{id}",
                          approval.params.serverId,
                        )}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex gap-2 ml-3">
                  <button
                    className="px-3 py-1 text-xs rounded bg-[var(--danger)] hover:bg-[var(--danger)] disabled:bg-[var(--danger-bg)] disabled:cursor-not-allowed text-[var(--text-primary)] transition"
                    disabled={approvalBusyById[approval.actionId]}
                    aria-busy={
                      approvalBusyById[approval.actionId] ? "true" : undefined
                    }
                    onClick={() => void onApproval(approval, "reject")}
                  >
                    {t("aiPage.reject")}
                  </button>
                  <button
                    className="px-3 py-1 text-xs rounded bg-[var(--success)] hover:bg-[var(--success)] disabled:bg-[var(--success-bg)] disabled:cursor-not-allowed text-[var(--text-primary)] transition"
                    disabled={approvalBusyById[approval.actionId]}
                    aria-busy={
                      approvalBusyById[approval.actionId] ? "true" : undefined
                    }
                    onClick={() => void onApproval(approval, "confirm")}
                  >
                    {t("aiPage.approve")}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
