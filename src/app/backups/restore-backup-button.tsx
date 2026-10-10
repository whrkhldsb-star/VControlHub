"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { formatDateTime } from "@/lib/datetime/format";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { Dialog } from "@/components/ui/dialog";
import { FormField, SegmentedControl } from "@/components/ui-primitives";
import { UI_INPUT, UI_LABEL } from "@/lib/ui/classes";
import { cn } from "@/lib/ui/cn";
import { getBackupTypeLabel } from "@/lib/i18n/domain-labels";

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
      setError(t("backupsPage.restore.errorInput", { confirmText: CONFIRM_TEXT }));
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
          t("backupsPage.restore.successWithTime", { time: formatDateTime(restoredAt, locale) }),
        );
        setQueuedTaskLink(false);
      } else if (result.taskId || result.jobId) {
        const taskId = result.taskId ?? (result.jobId ? `job:${result.jobId}` : "");
        const key = result.deduped ? "backupsPage.restore.deduped" : "backupsPage.restore.queued";
        setMessage(t(key, { taskId }));
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
      setError(getErrorMessage(restoreError, t("backupsPage.restore.errorFallback")));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-1">
      <ActionButton size="sm" variant="danger"
        disabled={disabled || pending}
        onClick={openConfirm} className="w-fit">
        {pending ? t("backupsPage.restore.pending") : t("common.restore")}
      </ActionButton>
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
        <Dialog
          open
          placement="sheet"
          onClose={() => setConfirmOpen(false)}
          closeOnBackdrop={false}
          busy={pending}
          title={t("backupsPage.restore.confirmTitle")}
          description={<>
            {t("backupsPage.restore.warningPrefix")} <span className="font-semibold text-[var(--text-primary)]">{getBackupTypeLabel(t, backupType)}</span> {t("backupsPage.restore.warningSuffix")} <span className="font-mono font-semibold text-[var(--danger)]">{CONFIRM_TEXT}</span> {t("backupsPage.restore.warningContinue")}
          </>}
          footer={<>
            <ActionButton variant="secondary"
              disabled={pending}
              onClick={() => {
                setConfirmOpen(false);
                setConfirmText("");
                setError(null);
              }}>
              {t("common.cancel")}
            </ActionButton>
            <ActionButton variant="danger-solid"
              loading={pending}
              disabled={confirmText !== CONFIRM_TEXT}
              onClick={handleRestore}>
              {pending ? t("backupsPage.restore.pending") : t("backupsPage.restore.confirm")}
            </ActionButton>
          </>}
        >
          <div className="space-y-4">
            {backupType === "FULL" ? (
              <div className="grid gap-1.5">
                <span className={UI_LABEL}>{t("backupsPage.restore.component.label")}</span>
                <SegmentedControl
                  ariaLabel={t("backupsPage.restore.component.label")}
                  value={component}
                  onChange={setComponent}
                  options={(["all", "database", "files"] as const).map((c) => ({ value: c, label: t(`backupsPage.restore.component.${c}`), tone: "danger" as const }))}
                />
              </div>
            ) : null}
            <FormField label={t("backupsPage.restore.inputLabel", { confirmText: CONFIRM_TEXT })} htmlFor="restore-backup-confirm" error={error ?? undefined}>
              <input
                id="restore-backup-confirm"
                value={confirmText}
                onChange={(event) => setConfirmText(event.target.value)}
                autoFocus
                autoComplete="off"
                className={cn(UI_INPUT, "font-mono")}
                placeholder={CONFIRM_TEXT}
              />
            </FormField>
          </div>
        </Dialog>
      )}
    </div>
  );
}
