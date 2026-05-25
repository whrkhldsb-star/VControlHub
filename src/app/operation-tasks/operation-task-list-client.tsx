"use client";

import { useState } from "react";
import Link from "next/link";
import type { OperationTask } from "@/lib/operation-task/service";
import { csrfFetch } from "@/lib/auth/csrf-client";

const sourceLabels: Record<string, string> = { command: "命令", scheduled: "定时", download: "下载", sync: "同步", backup: "备份", deployment: "部署" };
const statusClass: Record<string, string> = {
  pending: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  running: "border-cyan-400/20 bg-cyan-400/10 text-cyan-200",
  completed: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  failed: "border-rose-400/20 bg-rose-400/10 text-rose-200",
  cancelled: "border-slate-400/20 bg-slate-400/10 text-slate-300",
  paused: "border-violet-400/20 bg-violet-400/10 text-violet-200",
};

export function OperationTaskListClient({ initialTasks }: { initialTasks: OperationTask[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await csrfFetch("/api/operation-tasks");
      setTasks(data.tasks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新任务中心失败");
    } finally { setRefreshing(false); }
  };
  const counts = tasks.reduce<Record<string, number>>((acc, task) => { acc[task.status] = (acc[task.status] ?? 0) + 1; return acc; }, {});
  return <div className="space-y-5">
    {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-100">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-4">
      {[["running","运行中"],["pending","待处理"],["failed","失败"],["completed","已完成"]].map(([key,label]) => <div key={key} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold text-white">{counts[key] ?? 0}</div></div>)}
    </div>
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4"><h2 className="text-sm font-semibold text-white">最近任务</h2><button onClick={refresh} disabled={refreshing} className="rounded-lg border border-white/[0.08] px-3 py-1.5 text-xs text-slate-300 hover:bg-white/[0.05] disabled:opacity-50">{refreshing ? "刷新中..." : "刷新"}</button></div>
      <div className="divide-y divide-white/[0.06]">
        {tasks.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">暂无任务</div> : tasks.map((task) => <div key={task.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0"><div className="flex items-center gap-2"><span className="rounded-md bg-white/[0.05] px-2 py-1 text-xs text-slate-400">{sourceLabels[task.source]}</span><span className={`rounded-md border px-2 py-1 text-xs ${statusClass[task.status]}`}>{task.status}</span></div><h3 className="mt-2 truncate text-sm font-medium text-white">{task.title}</h3><p className="mt-1 text-xs text-slate-500">{new Date(task.createdAt).toLocaleString("zh-CN")} {task.actor ? ` · ${task.actor}` : ""} {task.progress ? ` · ${task.progress}` : ""}</p></div>
          {task.href && <Link href={task.href} className="text-xs text-cyan-300 hover:text-cyan-200">查看来源 →</Link>}
        </div>)}
      </div>
    </div>
  </div>;
}
