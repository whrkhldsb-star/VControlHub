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
  const [component, setComponent] = useState<"all" | "database" | "files">("all");
  const [message, setMessage] = useState<string | null>(null);
  const [queuedTaskLink, setQueuedTaskLink] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openConfirm = () => {
    setConfirmText("");
    setMessage(null);
    setQueuedTaskLink(false);
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
    setQueuedTaskLink(false);
    setError(null);
    try {
      // Default POST enqueues a durable backup.restore job (202 { jobId, taskId }).
      // Only wait=1 returns { restore: { restoredAt } } after synchronous execution.
      // Treating a queued job as "restore completed" is a false-success UX/safety bug.
      const result = await csrfFetch(`/api/backups/${backupId}/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: CONFIRM_TEXT, component }),
      }) as {
        restore?: { restoredAt?: string };
        restoredAt?: string;
        jobId?: string;
        taskId?: string;
        deduped?: boolean;
        error?: string;
      };

      const restoredAt = result.restore?.restoredAt ?? result.restoredAt;
      if (restoredAt) {
        setMessage(
          t("backupsPage.restore.successWithTime").replace(
            "{time}",
            new Date(restoredAt).toLocaleString(toDateLocale(locale)),
          ),
        );
        setQueuedTaskLink(false);
      } else if (result.taskId || result.jobId) {
        const taskId = result.taskId ?? (result.jobId ? `job:${result.jobId}` : "");
        const key = result.deduped ? "backupsPage.restore.deduped" : "backupsPage.restore.queued";
        setMessage(t(key).replace("{taskId}", taskId));
        setQueuedTaskLink(true);
      } else {
        // Unknown 2xx shape — do not claim restore completed.
        setMessage(t("backupsPage.restore.queuedUnknown"));
        setQueuedTaskLink(true);
      }
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
       data-action-button data-variant="danger" className="w-fit !px-3 !py-1.5 !text-xs disabled:cursor-not-allowed disabled:opacity-50">
        {pending ? t("backupsPage.restore.pending") : t("common.restore")}
      </button>
      {message && (
        <p className="text-xs text-[var(--success)]">
          {message}{" "}
          {queuedTaskLink ? (
            <a href="/operation-tasks" className="underline">
              {t("backupsPage.restore.openTasks")}
            </a>
          ) : null}
        </p>
      )}
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
            <div className="mt-4 grid gap-2">
              <span className="text-sm text-[var(--text-secondary)]">{t("backupsPage.restore.component.label")}</span>
              <div className="flex gap-2">
                {(["all", "database", "files"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setComponent(c)}
                    className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${component === c ? "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]" : "border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--surface-hover)]"}`}
                  >
                    {t(`backupsPage.restore.component.${c}`)}
                  </button>
                ))}
              </div>
            </div>
            <label className="mt-4 grid gap-1 text-sm text-[var(--text-secondary)]">
              {t("backupsPage.restore.inputLabel").replace("{confirmText}", CONFIRM_TEXT)}
              <input
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoFocus
                className="min-h-11 rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-muted)] focus:border-[var(--danger-border)]"
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
                data-action-button data-variant="secondary" className="!min-h-11 !rounded-xl !px-4 !py-2 !text-sm disabled:opacity-50"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                disabled={pending || confirmText !== CONFIRM_TEXT}
                onClick={handleRestore}
               data-action-button data-variant="danger" className="min-h-11 !px-4 !py-2 !text-sm disabled:cursor-not-allowed disabled:opacity-50">
                {pending ? t("backupsPage.restore.pending") : t("backupsPage.restore.confirm")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
