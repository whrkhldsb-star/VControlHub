"use client";

import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

export function BackupDrillButton({ backupId, disabled }: { backupId: string; disabled: boolean }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setPending(true); setMessage(null); setError(null);
    try {
      const result = await csrfFetch<{ taskId: string; deduped: boolean }>(`/api/backups/${encodeURIComponent(backupId)}/drill`, { method: "POST" });
      setMessage(`${t(result.deduped ? "backupsPage.drill.deduped" : "backupsPage.drill.queued").replace("{taskId}", result.taskId)} (${result.taskId})`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : t("backupsPage.drill.error")); }
    finally { setPending(false); }
  }
  return <div>
    <button type="button" disabled={disabled || pending} onClick={run} data-action-button data-variant="outline" className="!px-3 !py-2 !text-xs !font-medium disabled:opacity-50">{pending ? t("backupsPage.drill.pending") : t("backupsPage.drill.submit")}</button>
    {message ? <p className="mt-1 text-xs text-[var(--success)]">{message} <a href="/operation-tasks" className="underline">{t("backupsPage.drill.openTasks")}</a></p> : null}
    {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
  </div>;
}
