"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { csrfFetch } from "@/lib/auth/csrf-client";

type AiHostedApprovalCardProps = {
  action: {
    id: string;
    actionName: string;
    actionType: string;
    riskLevel: string;
    params: unknown;
    createdAt?: Date | string;
    server?: { id: string; name: string; host: string } | null;
  };
};

function formatParams(params: unknown) {
  try {
    return JSON.stringify(params ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function riskLabel(t: (k: string) => string, riskLevel: string) {
  const normalized = riskLevel.toLowerCase();
  if (normalized === "critical") return t("aiHostedApproval.riskCritical");
  if (normalized === "high") return t("aiHostedApproval.riskHigh");
  if (normalized === "medium") return t("aiHostedApproval.riskMedium");
  if (normalized === "low") return t("aiHostedApproval.riskLow");
  return riskLevel;
}

/**
 * Requester-facing confirmation card on /requests.
 *
 * getPendingActions only returns the current user's PENDING_APPROVAL rows, so
 * the primary action must be `confirm` (creates CommandRequest / playbook run),
 * not `approve` (requires ai:action:approve and executes immediately as admin).
 */
export function AiHostedApprovalCard({ action }: AiHostedApprovalCardProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"pending" | "confirming" | "rejecting" | "confirmed" | "rejected">("pending");
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  async function confirm() {
    setError(null);
    setStatus("confirming");
    try {
      await csrfFetch(`/api/ai/hosted-actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "confirm" }),
      });
      setStatus("confirmed");
    } catch (err) {
      setStatus("pending");
      setError(err instanceof Error ? err.message : t("aiHostedApproval.reviewFailed"));
    }
  }

  async function reject() {
    setError(null);
    const reason = rejectReason.trim() || t("aiHostedApproval.rejectReasonDefault");
    setStatus("rejecting");
    try {
      await csrfFetch(`/api/ai/hosted-actions/${action.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", reason }),
      });
      setStatus("rejected");
    } catch (err) {
      setStatus("pending");
      setError(err instanceof Error ? err.message : t("aiHostedApproval.reviewFailed"));
    }
  }

  const disabled = status !== "pending";

  return (
    <article data-tone="cyan" className="rounded-xl border border-[var(--color-action-border)]/15 p-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-[var(--text-primary)]">{action.actionName}</h3>
            <span data-tone="cyan" className="rounded-lg border border-[var(--color-action-border)]/20 px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{t("aiHostedApproval.badge")}</span>
            <span data-tone="amber" className="rounded-lg border border-[var(--warning-border)] px-2 py-0.5 text-[11px] font-medium text-[var(--warning)]">{riskLabel(t, action.riskLevel)}</span>
          </div>
          <p className="mt-1 text-xs text-[var(--text-secondary)]">{t("aiHostedApproval.description")}</p>
          <div className="mt-3 grid gap-2 text-xs text-[var(--text-secondary)] sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{t("aiHostedApproval.actionType")}</div>
              <div className="mt-1 font-mono text-[var(--text-primary)]">{action.actionType}</div>
            </div>
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2">
              <div className="text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{t("aiHostedApproval.targetVps")}</div>
              <div className="mt-1 text-[var(--text-secondary)]">{action.server ? `${action.server.name} · ${action.server.host}` : t("aiHostedApproval.notSpecified")}</div>
            </div>
          </div>
          <pre className="mt-3 max-h-32 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] p-3 text-[11px] text-[var(--text-secondary)]">{formatParams(action.params)}</pre>
          {!disabled ? (
            <label className="mt-3 block text-xs text-[var(--text-secondary)]">
              <span className="mb-1 block text-[10px] uppercase tracking-wider text-[var(--text-muted)]">{t("aiHostedApproval.rejectReasonLabel")}</span>
              <input
                type="text"
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder={t("aiHostedApproval.rejectReasonPlaceholder")}
                data-input
                className="w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2 text-sm outline-none"
                disabled={disabled}
              />
            </label>
          ) : null}
          {error ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{error}</p> : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 sm:flex-row">
          <button
            type="button"
            disabled={disabled}
            onClick={() => void confirm()}
            data-action-button
            data-variant="success"
            className="!px-3 !py-2 !text-xs disabled:opacity-60"
          >
            {status === "confirming"
              ? t("aiHostedApproval.confirming")
              : status === "confirmed"
                ? t("aiHostedApproval.confirmed")
                : t("aiHostedApproval.confirmAction")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => void reject()}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "rejecting"
              ? t("aiHostedApproval.rejecting")
              : status === "rejected"
                ? t("aiHostedApproval.rejected")
                : t("aiHostedApproval.reject")}
          </button>
        </div>
      </div>
    </article>
  );
}
