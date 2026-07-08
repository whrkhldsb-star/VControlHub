"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { toDateLocale } from "@/lib/i18n/locale-format";
import { useI18n } from "@/lib/i18n/use-locale";
import { useDialogFocus } from "@/lib/a11y/use-dialog-focus";

type Props = {
  backupId: string;
  backupType: string;
  disabled?: boolean;
};

export function RestoreBackupButton({ backupId, backupType, disabled = false }: Props) {
  const { t, locale } = useI18n();
  const CONFIRM_TEXT = t("backupsPage.restore.confirmToken");
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const dialogRef = useDialogFocus<HTMLDivElement>({ open: confirmOpen, onClose: () => setConfirmOpen(false) });
  const [confirmText, setConfirmText] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openConfirm = () => {
    setConfirmText("");
    setMessage(null);
    setError(null);
    setConfirmOpen(true);
  };

  const handleRestore = async () => {
    if (confirmText !== CONFIRM_TEXT) {
      setError(t("backupsPage.restore.errorInput").replace("{confirmText}", CONFIRM_TEXT));
      return;
    }

    setPending(true);
    setMessage(null);
    setError(null);
    try {
      const result = await csrfFetch(`/api/backups/${backupId}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_TEXT }),
      }) as { restoredAt?: string; error?: string };
      setMessage(
        result.restoredAt
          ? t("backupsPage.restore.successWithTime").replace("{time}", new Date(result.restoredAt).toLocaleString(toDateLocale(locale)))
          : t("backupsPage.restore.success")
      );
      setConfirmOpen(false);
      setConfirmText("");
      router.refresh();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : t("backupsPage.restore.errorFallback"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-1">
      <button
        type="button"
        disabled={disabled || pending}
        onClick={openConfirm}
        className="w-fit rounded-lg border border-[var(--danger-border)] px-3 py-1.5 text-xs font-semibold text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? t("backupsPage.restore.pending") : t("common.restore")}
      </button>
      {message && <p className="text-xs text-[var(--success)]">{message}</p>}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-[var(--surface)]/75 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="presentation">
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="restore-backup-title"
            aria-describedby="restore-backup-description"
            className="mx-0 w-full max-w-md rounded-t-2xl border border-[var(--danger-border)] bg-[var(--modal-bg)] p-5 shadow-2xl shadow-black/30 sm:mx-4 sm:rounded-2xl"
          >
            <h3 id="restore-backup-title" className="text-base font-semibold text-[var(--text-primary)]">{t("backupsPage.restore.confirmTitle")}</h3>
            <p id="restore-backup-description" className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
              {t("backupsPage.restore.warningPrefix")} <span className="font-semibold text-[var(--text-primary)]">{backupType}</span> {t("backupsPage.restore.warningSuffix")} <span className="font-mono font-semibold text-[var(--danger)]">{CONFIRM_TEXT}</span> {t("backupsPage.restore.warningContinue")}
            </p>
            <label className="mt-4 grid gap-1 text-sm text-[var(--text-secondary)]">
              {t("backupsPage.restore.inputLabel").replace("{confirmText}", CONFIRM_TEXT)}
              <input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoFocus
                className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface)]/[0.04] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--danger-border)]"
                placeholder={CONFIRM_TEXT}
              />
            </label>
            {error && <p role="alert" className="mt-3 text-xs text-[var(--danger)]">{error}</p>}
            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  setConfirmOpen(false);
                  setConfirmText("");
                  setError(null);
                }}
                className="min-h-11 rounded-xl border border-[var(--border)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:bg-[var(--surface-hover)] disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={pending || confirmText !== CONFIRM_TEXT}
                onClick={handleRestore}
                data-tone="rose" className="min-h-11 rounded-xl border border-[var(--danger-border)] px-4 py-2 text-sm font-semibold text-[var(--danger)] transition hover:bg-[var(--danger-bg)] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {pending ? t("backupsPage.restore.pending") : t("backupsPage.restore.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
