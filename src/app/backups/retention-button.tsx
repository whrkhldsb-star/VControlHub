"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type Props = {
  /** 当前已超过 30 天的记录数。0 时按钮 disabled。 */
  olderThan30Days: number;
  /** 整个 backups 总数（包含 FAILED / PENDING / RUNNING），用于决策提示。 */
  totalRecords: number;
};

const MIN_OLDER_THAN_DAYS = 30;
const DEFAULT_KEEP_LATEST_PER_TYPE = 3;

export function RetentionButton({ olderThan30Days, totalRecords }: Props) {
  const { t } = useI18n();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [taskId, setTaskId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [olderThanDays, setOlderThanDays] = useState(MIN_OLDER_THAN_DAYS);
  const [keepLatestPerType, setKeepLatestPerType] = useState(DEFAULT_KEEP_LATEST_PER_TYPE);

  const disabled = pending || olderThan30Days === 0;

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    setPending(true);
    setTaskId(null);
    setError(null);
    try {
      const result = await csrfFetch("/api/backups/retention", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          olderThanDays: Number(olderThanDays) || MIN_OLDER_THAN_DAYS,
          keepLatestPerType: Number(keepLatestPerType),
        }),
      });
      setTaskId(result?.taskId ?? null);
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : t("backupsPage.retention.errorFallback"));
    } finally {
      setPending(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="grid gap-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-xs text-[var(--text-muted)]">
          <span>{t("backupsPage.retention.daysLabel")}</span>
          <input
            type="number"
            min={1}
            max={3650}
            value={olderThanDays}
            onChange={(event) => setOlderThanDays(Math.max(1, Math.min(3650, Number(event.target.value) || MIN_OLDER_THAN_DAYS)))}
            className="w-24 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-sm text-[var(--text-primary)]/70"
            disabled={pending}
          />
        </label>
        <label className="grid gap-1 text-xs text-[var(--text-muted)]">
          <span>{t("backupsPage.retention.keepLatestLabel")}</span>
          <input
            type="number"
            min={0}
            max={1000}
            value={keepLatestPerType}
            onChange={(event) => setKeepLatestPerType(Math.max(0, Math.min(1000, Number(event.target.value) || 0)))}
            className="w-24 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 py-1 text-sm text-[var(--text-primary)]/70"
            disabled={pending}
          />
        </label>
        <button
          type="submit"
          disabled={disabled}
          className="rounded-lg border border-[var(--warning-border)] px-3 py-1.5 text-xs font-semibold text-[var(--warning)] transition hover:bg-[var(--warning-bg)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {pending ? t("backupsPage.retention.pending") : t("backupsPage.retention.submit")}
        </button>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {t("backupsPage.retention.matchInfo")
          .replace("{total}", String(totalRecords))
          .replace("{older}", String(olderThan30Days))
          .replace("{extra}", t("backupsPage.retention.matchInfoExtra"))}
      </p>
      {taskId && (
        <p role="status" className="text-xs text-[var(--success)]">
          {t("backupsPage.retention.queuedPrefix")} <Link href="/operation-tasks" className="underline">{t("backupsPage.retry.taskCenter")}</Link> {t("backupsPage.retention.queuedSuffix").replace("{taskId}", taskId)}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs text-[var(--danger)]">{t("backupsPage.retention.error")}: {error}</p>
      )}
    </form>
  );
}
