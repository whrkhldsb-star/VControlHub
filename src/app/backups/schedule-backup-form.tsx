"use client";

import { useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import type { BackupType } from "@/lib/backup/service";

type ServerOption = { id: string; name: string; enabled: boolean };

type Props = {
  servers: ServerOption[];
  commandByType: Record<BackupType, string>;
};

function getTypeLabel(t: (k: string) => string, type: BackupType): string {
  const map: Record<BackupType, string> = {
    DATABASE: t("backupsPage.schedule.type.database"),
    FILES: t("backupsPage.schedule.type.files"),
    FULL: t("backupsPage.schedule.type.full"),
  };
  return map[type];
}

const scheduleBackupTypeSelectId = "schedule-backup-type";
const scheduleCronInputId = "schedule-backup-cron";

function describeCronPreview(expr: string, t: (k: string) => string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return t("backupsPage.schedule.cronError.5parts");
  const [min, hour, day, month, dow] = parts;
  if (min === "0" && hour === "*" && day === "*" && month === "*" && dow === "*") return t("backupsPage.schedule.cronPreview.everyHour");
  if (day === "*" && month === "*" && dow === "*" && /^\d+$/.test(hour!) && /^\d+$/.test(min!)) return t("backupsPage.schedule.cronPreview.everyDay").replace("{hour}", hour!).replace("{min}", min!.padStart(2, "0"));
  if (day === "*" && month === "*" && /^\d+$/.test(dow!) && /^\d+$/.test(hour!) && /^\d+$/.test(min!)) {
    const dowName = t(`backupsPage.schedule.cronPreview.dowName.${dow}`);
    const safeName = dowName.startsWith("backupsPage.") ? t("backupsPage.schedule.cronPreview.dowFallback").replace("{dow}", dow!) : dowName;
    return t("backupsPage.schedule.cronPreview.everyDow").replace("{dowName}", safeName).replace("{hour}", hour!).replace("{min}", min!.padStart(2, "0"));
  }
  return t("backupsPage.schedule.cronPreview.custom");
}

export function ScheduleBackupForm({ servers, commandByType }: Props) {
  const { t } = useI18n();
  const [type, setType] = useState<BackupType>("DATABASE");
  const [cronExpression, setCronExpression] = useState("0 3 * * *");
  const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const enabledServers = useMemo(() => servers.filter((server) => server.enabled), [servers]);
  const cronPreview = useMemo(() => describeCronPreview(cronExpression, t), [cronExpression, t]);
  const command = commandByType[type];

  const toggleServer = (id: string) => {
    setSelectedServerIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const createSchedule = async (event: React.FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setMessage(null);
    try {
      const serverIds = Array.from(selectedServerIds);
      if (serverIds.length === 0) throw new Error(t("backupsPage.schedule.error.noServer"));
      await csrfFetch("/api/scheduled-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: t("backupsPage.schedule.nameTemplate").replace("{type}", getTypeLabel(t, type)),
          cronExpression,
          command,
          reason: t("backupsPage.schedule.reasonTemplate").replace("{type}", getTypeLabel(t, type)),
          serverIds,
        }),
      });
      setMessage({ type: "ok", text: t("backupsPage.schedule.success") });
      setSelectedServerIds(new Set());
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : t("backupsPage.schedule.failFallback") });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={createSchedule} data-tone="cyan" className="mt-4 space-y-4 rounded-xl border border-cyan-400/10 p-4">
      <div className="grid gap-3 md:grid-cols-[180px_1fr]">
        <div className="space-y-1.5">
          <label htmlFor={scheduleBackupTypeSelectId} className="block text-xs font-medium text-[var(--text-secondary)]">{t("common.backupType")}</label>
          <select id={scheduleBackupTypeSelectId} value={type} onChange={(event) => setType(event.target.value as BackupType)} className="block w-full rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100">
            <option value="DATABASE">{t("common.databaseBackup")}</option>
            <option value="FILES">{t("common.fileBackup")}</option>
            <option value="FULL">{t("common.fullBackup")}</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={scheduleCronInputId} className="block text-xs font-medium text-[var(--text-secondary)]">{t("common.cronExpression")}</label>
          <input id={scheduleCronInputId} value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} required placeholder="0 3 * * *" className="block w-full rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100" />
        </div>
      </div>
      <p data-tone="cyan" className="rounded-lg border border-cyan-400/10 px-3 py-2 text-xs text-cyan-100">{t("common.preview")}{cronPreview}</p>
      <code className="block overflow-auto rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{command}</code>
      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--text-secondary)]">{t("backupsPage.schedule.executeOn")}</p>
        {enabledServers.length === 0 ? (
          <p className="text-xs text-amber-200">{t("backupsPage.schedule.empty")}</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {enabledServers.map((server) => (
              <label key={server.id} className="flex items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-slate-200">
                <input type="checkbox" checked={selectedServerIds.has(server.id)} onChange={() => toggleServer(server.id)} className="accent-cyan-400" />
                <span>{server.name}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <button type="submit" disabled={submitting || enabledServers.length === 0} className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 disabled:cursor-not-allowed disabled:opacity-60">
        {submitting ? t("backupsPage.schedule.submitting") : t("backupsPage.schedule.submit")}
      </button>
      {message && <p role="status" className={`text-xs ${message.type === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{message.text}</p>}
    </form>
  );
}
