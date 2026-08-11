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
import { ActionButton } from "@/components/action-button";

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
  const actionDisplayName = (actionType: string, fallback: string) => {
    const key = `aiPage.actionType.${actionType}`;
    const translated = t(key);
    return translated === key ? fallback : translated;
  };
  const riskDisplayName = (riskLevel: string) => {
    const key = `aiPage.risk.${riskLevel}`;
    const translated = t(key);
    return translated === key ? riskLevel : translated;
  };
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
              formatAllowedTypes(currentModelCaps, t),
            )}
          </p>
        </div>
      )}

      {messages.filter((msg) => msg.role !== "tool").map((msg) => {
        const hostedActions = msg.hostedActions ?? [];
        const hasToolOnlyContent =
          hostedActions.length > 0 &&
          (!msg.content.trim() || EMPTY_TOOL_CONTENT.has(msg.content.trim()));
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
            className={`max-w-[88%] sm:max-w-[80%] rounded-2xl border px-3 py-2 text-sm leading-relaxed sm:px-4 sm:py-2.5 ${
              msg.role === "user"
                ? "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--text-primary)]"
                : "border-[var(--border-subtle)] bg-[var(--surface-elevated)] text-[var(--text-secondary)]"
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
            {!hasToolOnlyContent && (
              <div className="break-words">{renderContent(msg.content)}</div>
            )}
            {hostedActions.length > 0 && (
              <div className="mt-2 space-y-2 border-t border-[var(--border-subtle)] pt-2">
                <div className="text-[10px] font-medium uppercase text-[var(--text-muted)]">
                  {t("aiPage.toolActivity")}
                </div>
                {hostedActions.map((action) => (
                  <div
                    key={action.id}
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
                        className={`text-[10px] font-semibold ${actionStatusClass(action.status)}`}
                      >
                        {t(
                          action.status === "APPROVED" &&
                            action.result?.includes("commandRequestId")
                            ? "aiPage.actionStatus.COMMAND_REQUESTED"
                            : `aiPage.actionStatus.${action.status}`,
                        )}
                      </span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-[var(--text-muted)]">
                      <span>{action.actionType}</span>
                      <span>
                        {t("aiPage.riskLabel")}
                        {riskDisplayName(action.riskLevel)}
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
                    {action.result && action.result !== "null" && (
                      <details className="mt-1 text-xs">
                        <summary className="cursor-pointer text-[var(--text-muted)] hover:text-[var(--text-primary)]">
                          {t("aiPage.actionResult")}
                        </summary>
                        <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all border-l border-[var(--border)] pl-2 text-[10px] text-[var(--text-secondary)]">
                          {formatActionResult(action.result)}
                        </pre>
                      </details>
                    )}
                  </div>
                ))}
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
            {!hasToolOnlyContent && (
              <button
              type="button"
              aria-label={t("aiPage.copyAria")}
              onClick={async () => {
                const ok = await copyToClipboard(msg.content);
                if (ok) {
                  setCopyFeedback(msg.id);
                  setTimeout(() => setCopyFeedback(null), 2000);
                }
              }}
              className="mt-1.5 flex items-center gap-1 text-[10px] text-[var(--text-muted)] transition hover:text-[var(--accent)]"
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
            )}
          </div>
          {msg.role === "user" && (
            <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] text-[11px] font-semibold uppercase text-[var(--accent)]">
              U
            </div>
          )}
          </div>
        );
      })}

      {streaming && streamContent && (
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
          <div className="max-w-[88%] rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-3 py-2 text-sm leading-relaxed text-[var(--text-secondary)] sm:max-w-[80%] sm:px-4 sm:py-2.5">
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
          <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-xl border border-[var(--accent-border)] bg-[var(--accent-bg)]">
            <div className="flex gap-0.5">
              <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:0ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:150ms]" />
              <span className="h-1 w-1 animate-bounce rounded-full bg-[var(--accent)] [animation-delay:300ms]" />
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-4 py-2.5 text-sm text-[var(--text-muted)]">
            {t("aiPage.thinkingDetail")}
          </div>
        </div>
      )}
      {pendingApprovals.length > 0 && (
        <div className="sticky bottom-0 z-10 border-t border-[var(--warning-border)] bg-[color-mix(in_srgb,var(--warning-bg)_96%,var(--surface))] px-2 py-2 shadow-[0_-8px_20px_rgba(0,0,0,0.16)] backdrop-blur sm:px-4">
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
                className={`flex flex-col gap-2 rounded-lg bg-[var(--input-bg)] p-2.5 ${approval.actionType === "create_automation_task" ? "" : "sm:flex-row sm:items-center sm:justify-between"}`}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-[var(--text-primary)] font-medium">
                    {actionDisplayName(
                      approval.actionType,
                      approval.actionName,
                    )}
                  </div>
                  <div className="text-xs text-[var(--text-secondary)] truncate">
                    {t("aiPage.riskLabel")}
                    <span
                      className={
                        approval.riskLevel === "critical"
                          ? "text-[var(--danger)]"
                          : approval.riskLevel === "high"
                            ? "text-[var(--warning)]"
                            : approval.riskLevel === "medium"
                              ? "text-[var(--warning)]"
                              : "text-[var(--success)]"
                      }
                    >
                      {riskDisplayName(approval.riskLevel)}
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
                  {approval.actionType === "create_automation_task" && (
                    <div className="mt-2 space-y-2 text-xs text-[var(--text-secondary)]">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span>{t("aiPage.automationExecution")}: {String(approval.params.executionMode ?? "-")}</span>
                        <span>{t("aiPage.automationTargets")}: {Array.isArray(approval.params.serverIds) ? approval.params.serverIds.length : 0}</span>
                        <span>{t("aiPage.automationApproval")}: {String(approval.params.approvalMode ?? "-")}</span>
                        {typeof approval.params.templateName === "string" && <span>{t("aiPage.automationTemplate")}: {approval.params.templateName}</span>}
                      </div>
                      {typeof approval.params.plan === "string" && <p className="whitespace-pre-wrap break-words leading-5">{approval.params.plan}</p>}
                      {typeof approval.params.command === "string" && <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-2 font-mono text-[11px] text-[var(--text-primary)]">{approval.params.command}</pre>}
                      {(typeof approval.params.verificationCommand === "string" || typeof approval.params.rollbackCommand === "string") && <div className="space-y-1 font-mono text-[11px]">{typeof approval.params.verificationCommand === "string" && <p>{t("aiPage.automationVerify")}: {approval.params.verificationCommand}</p>}{typeof approval.params.rollbackCommand === "string" && <p>{t("aiPage.automationRollback")}: {approval.params.rollbackCommand}</p>}</div>}
                    </div>
                  )}
                </div>
                <div className="flex w-full gap-2 sm:ml-3 sm:w-auto">
                  <ActionButton variant="danger-solid" className="flex-1 !px-3 !py-1 !text-xs disabled:opacity-50 sm:flex-none"
                    disabled={approvalBusyById[approval.actionId]}
                    aria-busy={
                      approvalBusyById[approval.actionId] ? "true" : undefined
                    }
                    onClick={() => void onApproval(approval, "reject")}
                  >
                    {t("aiPage.reject")}
                  </ActionButton>
                  <ActionButton variant="success-solid" className="flex-1 !px-3 !py-1 !text-xs disabled:opacity-50 sm:flex-none"
                    disabled={approvalBusyById[approval.actionId]}
                    aria-busy={
                      approvalBusyById[approval.actionId] ? "true" : undefined
                    }
                    onClick={() => void onApproval(approval, "confirm")}
                  >
                    {t(
                      approval.actionType === "manage_cron" ||
                        approval.actionType === "run_playbook" ||
                        approval.actionType === "create_automation_task"
                        ? "aiPage.confirmAction"
                        : "aiPage.approve",
                    )}
                  </ActionButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
      <div ref={messagesEndRef} />
    </div>
  );
}
