"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/use-locale";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";

type Props = {
  commandRequestId: string;
  commandTitle: string;
};

export function CancelCommandButton({ commandRequestId, commandTitle }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    setMessage(null);
    try {
      await csrfFetch("/api/commands", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "cancel",
          commandRequestId,
          reason: reason.trim() || undefined,
        }),
      });
      setMessage(t("requestsPage.cancel.successMessage"));
      setOpen(false);
      setReason("");
      router.refresh();
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : t("requestsPage.cancel.errorFallback"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="mt-3 space-y-2">
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-tone="rose" className="rounded-lg border border-rose-400/30 px-3 py-1.5 text-xs font-medium text-rose-100 transition hover:bg-rose-400/20"
        aria-label={`${t("requestsPage.cancel.ariaLabel")}：${commandTitle}`}
      >
        {t("requestsPage.cancel.title")}
      </button>
      {message && <p role="status" className="text-xs text-emerald-300">{message}</p>}
      {error && <p role="alert" className="text-xs text-rose-300">{error}</p>}

      {open && (
        <div role="dialog" aria-modal="true" aria-labelledby={`cancel-command-${commandRequestId}-title`} className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6">
          <div className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--modal-bg)] p-5 shadow-2xl">
            <h3 id={`cancel-command-${commandRequestId}-title`} className="text-lg font-semibold text-[var(--text-primary)]">{t("requestsPage.cancel.confirmTitle")}</h3>
            <p className="mt-2 text-sm text-[var(--text-secondary)]">
              {t("requestsPage.cancel.confirmBody").replace("{title}", commandTitle)}
            </p>
            <label htmlFor={`cancel-command-${commandRequestId}-reason`} className="mt-4 block text-sm font-medium text-[var(--text-secondary)]">
              {t("requestsPage.cancel.reasonLabel")}
            </label>
            <textarea
              id={`cancel-command-${commandRequestId}-reason`}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              className="mt-2 min-h-20 w-full rounded-xl border border-[var(--border)] bg-white/[0.03] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-rose-300"
              placeholder={t("requestsPage.cancel.reasonPlaceholder")}
            />
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setOpen(false);
                  setError(null);
                }}
                className="rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-white/5 disabled:opacity-50"
              >
                {t("requestsPage.cancel.keep")}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={submit}
                className="rounded-xl bg-rose-500 px-4 py-2 text-sm font-medium text-[var(--text-primary)] transition hover:bg-rose-400 disabled:opacity-50"
              >
                {pending ? t("requestsPage.cancel.pending") : t("requestsPage.cancel.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
