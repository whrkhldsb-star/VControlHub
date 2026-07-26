"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";

export function BackupDrillButton({ backupId, disabled }: { backupId: string; disabled: boolean }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setPending(true); setMessage(null); setError(null);
    try {
      const result = await csrfFetch<{ taskId: string; deduped: boolean }>(`/api/backups/${encodeURIComponent(backupId)}/drill`, { method: "POST" });
      setMessage(`${t(result.deduped ? "backupsPage.drill.deduped" : "backupsPage.drill.queued", { taskId: result.taskId })} (${result.taskId})`);
    } catch (cause) { setError(getErrorMessage(cause, t("backupsPage.drill.error"))); }
    finally { setPending(false); }
  }
  return <div>
    <ActionButton variant="outline" disabled={disabled || pending} onClick={run} className="!px-3 !py-2 !text-xs !font-medium disabled:opacity-50">{pending ? t("backupsPage.drill.pending") : t("backupsPage.drill.submit")}</ActionButton>
    {message ? <p className="mt-1 text-xs text-[var(--success)]">{message} <a href="/operation-tasks" className="underline">{t("backupsPage.drill.openTasks")}</a></p> : null}
    {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
  </div>;
}
