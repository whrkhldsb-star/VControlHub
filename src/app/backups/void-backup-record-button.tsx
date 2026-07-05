"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type Props = {
  backupId: string;
  status: string;
};

export function VoidBackupRecordButton({ backupId, status }: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const disabled = pending || status === "COMPLETED" || status === "RUNNING";

  const handleVoid = async () => {
    if (disabled) return;
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
      router.refresh();
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : t("backupsPage.void.errorFallback"));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="grid gap-1">
      <button
        type="button"
        disabled={disabled}
        onClick={handleVoid}
        className="w-fit rounded-lg border border-[var(--warning-border)] px-3 py-1.5 text-xs font-semibold text-[var(--warning)] transition hover:bg-[var(--warning-bg)] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pending ? t("backupsPage.void.pending") : t("backupsPage.void.submit")}
      </button>
      {message && <p className="text-xs text-[var(--success)]">{message}</p>}
      {error && <p role="alert" className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}
