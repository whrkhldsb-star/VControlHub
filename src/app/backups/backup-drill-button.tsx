"use client";

import Link from "next/link";
import { useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { operationTaskHref } from "@/lib/ui/deep-links";

export function BackupDrillButton({ backupId, disabled }: { backupId: string; disabled: boolean }) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function run() {
    setPending(true); setMessage(null); setTaskId(null); setError(null);
    try {
      const result = await csrfFetch<{ taskId: string; deduped: boolean }>(`/api/backups/${encodeURIComponent(backupId)}/drill`, { method: "POST" });
      setTaskId(result.taskId);
      setMessage(t(result.deduped ? "backupsPage.drill.deduped" : "backupsPage.drill.queued", { taskId: result.taskId }));
    } catch (cause) { setError(getErrorMessage(cause, t("backupsPage.drill.error"))); }
    finally { setPending(false); }
  }
  return <div>
    <ActionButton size="sm" variant="secondary" disabled={disabled} loading={pending} onClick={run}>{pending ? t("backupsPage.drill.pending") : t("backupsPage.drill.submit")}</ActionButton>
    {message ? <p className="mt-1 text-xs text-[var(--success)]">{message} <Link href={taskId ? operationTaskHref(taskId) : "/operation-tasks"} className="underline">{t("backupsPage.drill.openTasks")}</Link></p> : null}
    {error ? <p className="mt-1 text-xs text-[var(--danger)]">{error}</p> : null}
  </div>;
}
