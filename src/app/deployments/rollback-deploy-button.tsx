"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { useToast } from "@/components/toast-provider";

type Props = {
  runId: string;
  templateName: string;
  disabled?: boolean;
};

export function RollbackDeployButton({ runId, templateName, disabled = false }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const { addToast } = useToast();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRollback() {
    if (pending || disabled) return;
    if (!confirming) {
      setError(null);
      setConfirming(true);
      return;
    }

    setPending(true);
    setError(null);
    try {
      await csrfFetch(`/api/deployments/${runId}/rollback`, {
        method: "POST",
        body: JSON.stringify({ reason: t("deploymentsPage.rollback.reason").replace("{name}", templateName) }),
      });
      setConfirming(false);
      addToast("success", t("deploymentsPage.rollback.toast.success"));
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error ? err.message : t("deploymentsPage.rollback.toast.failed");
      setError(msg);
      addToast("error", msg);
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {confirming ? (
        <span id={`rollback-deploy-${runId}-warning`} className="text-xs text-amber-200">
          {t("deploymentsPage.rollback.confirmWarning")}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleRollback}
        disabled={pending || disabled}
        aria-describedby={confirming ? `rollback-deploy-${runId}-warning` : undefined}
        data-tone="emerald" className="rounded-lg border border-emerald-400/30 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {pending ? t("deploymentsPage.rollback.submitting") : confirming ? t("deploymentsPage.rollback.confirmBtn") : t("deploymentsPage.rollback.triggerBtn")}
      </button>
      {confirming ? (
        <button
          type="button"
          onClick={() => {
            setConfirming(false);
            setError(null);
          }}
          disabled={pending}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)]/10 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:bg-[var(--surface)]/10 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {t("common.cancel")}
        </button>
      ) : null}
      {error && <span role="alert" className="text-xs text-rose-300">{error}</span>}
    </div>
  );
}
