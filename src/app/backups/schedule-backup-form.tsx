"use client";

import { useMemo, useState } from "react";
import { csrfFetch } from "@/lib/auth/csrf-client";
import type { BackupType } from "@/lib/backup/service";

type ServerOption = { id: string; name: string; enabled: boolean };

type Props = {
  servers: ServerOption[];
  commandByType: Record<BackupType, string>;
};

const TYPE_LABEL: Record<BackupType, string> = {
  DATABASE: "数据库",
  FILES: "文件",
  FULL: "完整",
};

const scheduleBackupTypeSelectId = "schedule-backup-type";
const scheduleCronInputId = "schedule-backup-cron";

function describeCronPreview(expr: string) {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return "请输入 5 段 Cron 表达式：分钟 小时 日期 月份 星期";
  const [min, hour, day, month, dow] = parts;
  if (min === "0" && hour === "*" && day === "*" && month === "*" && dow === "*") return "每小时整点执行";
  if (day === "*" && month === "*" && dow === "*" && /^\d+$/.test(hour) && /^\d+$/.test(min)) return `每天 ${hour}:${min.padStart(2, "0")} 执行`;
  if (day === "*" && month === "*" && /^\d+$/.test(dow) && /^\d+$/.test(hour) && /^\d+$/.test(min)) {
    const names: Record<string, string> = { "0": "周日", "1": "周一", "2": "周二", "3": "周三", "4": "周四", "5": "周五", "6": "周六" };
    return `每${names[dow] ?? `周${dow}`} ${hour}:${min.padStart(2, "0")} 执行`;
  }
  return "自定义 Cron；保存后会进入定时任务调度队列";
}

export function ScheduleBackupForm({ servers, commandByType }: Props) {
  const [type, setType] = useState<BackupType>("DATABASE");
  const [cronExpression, setCronExpression] = useState("0 3 * * *");
  const [selectedServerIds, setSelectedServerIds] = useState<Set<string>>(new Set());
  const [submitting, setSubmitting] = useState(false);
  const [message, setMessage] = useState<{ type: "ok" | "error"; text: string } | null>(null);
  const enabledServers = useMemo(() => servers.filter((server) => server.enabled), [servers]);
  const cronPreview = useMemo(() => describeCronPreview(cronExpression), [cronExpression]);
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
      if (serverIds.length === 0) throw new Error("请选择至少一台执行备份的 VPS 节点");
      await csrfFetch("/api/scheduled-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `定时${TYPE_LABEL[type]}备份`,
          cronExpression,
          command,
          reason: `由备份页面创建的${TYPE_LABEL[type]}定时备份`,
          serverIds,
        }),
      });
      setMessage({ type: "ok", text: "定时备份任务已创建，可在定时任务页面查看下一次运行时间和执行日志。" });
      setSelectedServerIds(new Set());
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "创建定时备份失败" });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={createSchedule} className="mt-4 space-y-4 rounded-xl border border-cyan-400/10 bg-cyan-400/[0.04] p-4">
      <div className="grid gap-3 md:grid-cols-[180px_1fr]">
        <div className="space-y-1.5">
          <label htmlFor={scheduleBackupTypeSelectId} className="block text-xs font-medium text-[var(--text-secondary)]">备份类型</label>
          <select id={scheduleBackupTypeSelectId} value={type} onChange={(event) => setType(event.target.value as BackupType)} className="block w-full rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100">
            <option value="DATABASE">数据库备份</option>
            <option value="FILES">文件备份</option>
            <option value="FULL">完整备份</option>
          </select>
        </div>
        <div className="space-y-1.5">
          <label htmlFor={scheduleCronInputId} className="block text-xs font-medium text-[var(--text-secondary)]">Cron 表达式</label>
          <input id={scheduleCronInputId} value={cronExpression} onChange={(event) => setCronExpression(event.target.value)} required placeholder="0 3 * * *" className="block w-full rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm font-mono text-slate-100" />
        </div>
      </div>
      <p className="rounded-lg border border-cyan-400/10 bg-cyan-400/[0.06] px-3 py-2 text-xs text-cyan-100">预览：{cronPreview}</p>
      <code className="block overflow-auto rounded-lg border border-white/[0.06] bg-slate-950/70 p-3 font-mono text-xs text-slate-300">{command}</code>
      <div className="space-y-2">
        <p className="text-xs font-medium text-[var(--text-secondary)]">执行节点</p>
        {enabledServers.length === 0 ? (
          <p className="text-xs text-amber-200">暂无可用 VPS 节点，请先在 VPS 管理中启用至少一台节点。</p>
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
        {submitting ? "创建中…" : "创建定时备份"}
      </button>
      {message && <p role="status" className={`text-xs ${message.type === "ok" ? "text-emerald-300" : "text-rose-300"}`}>{message.text}</p>}
    </form>
  );
}
