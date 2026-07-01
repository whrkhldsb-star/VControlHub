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

export function AiHostedApprovalCard({ action }: AiHostedApprovalCardProps) {
  const { t } = useI18n();
  const [status, setStatus] = useState<"pending" | "approving" | "rejecting" | "approved" | "rejected">("pending");
  const [error, setError] = useState<string | null>(null);

  async function review(decision: "approve" | "reject") {
    setError(null);
    setStatus(decision === "approve" ? "approving" : "rejecting");
    try {
      await csrfFetch(`/api/ai/hosted-actions/${action.id}`, {
        method: "PATCH",
        body: JSON.stringify({ action: decision }),
      });
      setStatus(decision === "approve" ? "approved" : "rejected");
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
            <span data-tone="cyan" className="rounded-full border border-[var(--color-action-border)]/20 px-2 py-0.5 text-[11px] font-medium text-[var(--text-secondary)]">{t("aiHostedApproval.badge")}</span>
            <span data-tone="amber" className="rounded-full border border-amber-400/20 px-2 py-0.5 text-[11px] font-medium text-amber-200">{riskLabel(t, action.riskLevel)}</span>
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
          {error ? <p role="alert" className="mt-2 text-xs text-rose-300">{error}</p> : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={disabled}
            onClick={() => review("approve")}
            className="rounded-lg bg-emerald-500 px-3 py-2 text-xs font-medium text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "approving" ? t("aiHostedApproval.approving") : status === "approved" ? t("aiHostedApproval.approved") : t("aiHostedApproval.approveAction")}
          </button>
          <button
            type="button"
            disabled={disabled}
            onClick={() => review("reject")}
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/[0.10] disabled:cursor-not-allowed disabled:opacity-60"
          >
            {status === "rejecting" ? t("aiHostedApproval.rejecting") : status === "rejected" ? t("aiHostedApproval.rejected") : t("aiHostedApproval.reject")}
          </button>
        </div>
      </div>
    </article>
  );
}
