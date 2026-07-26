"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";

type Props = {
  backupId: string;
  status: string;
};

export function VoidBackupRecordButton({ backupId, status }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Backend CAS only voids PENDING/FAILED; hide/disable for VOIDED and other non-voidable states.
  const canVoid = status === "PENDING" || status === "FAILED";
  const disabled = pending || !canVoid;

  const handleVoid = async () => {
    if (disabled) return;
    if (!confirming) {
      setMessage(null);
      setError(null);
      setConfirming(true);
      return;
    }
    setPending(true);
    setMessage(null);
    setError(null);
    try {
      await csrfFetch(`/api/backups/${backupId}/void`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: t("backupsPage.void.reason") }),
      });
      setMessage(t("backupsPage.void.success"));
      setConfirming(false);
      router.refresh();
    } catch (voidError) {
      setError(getErrorMessage(voidError, t("backupsPage.void.errorFallback")));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-1">
      {confirming ? (
        <p id={`void-backup-${backupId}-warning`} className="text-xs text-[var(--warning)]">
          {t("backupsPage.void.confirmWarning")}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ActionButton variant="outline"
          disabled={disabled}
          onClick={handleVoid}
          aria-describedby={confirming ? `void-backup-${backupId}-warning` : undefined}
         
          className="!w-fit !px-3 !py-1.5 !text-xs !font-semibold disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? t("backupsPage.void.pending") : confirming ? t("backupsPage.void.confirmSubmit") : t("backupsPage.void.submit")}
        </ActionButton>
        {confirming ? (
          <ActionButton variant="secondary"
            disabled={pending}
            onClick={() => setConfirming(false)}
           
            className="!w-fit !px-3 !py-1.5 !text-xs !font-semibold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("common.cancel")}
          </ActionButton>
        ) : null}
      </div>
      {message && <p className="text-xs text-[var(--success)]">{message}</p>}
      {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
