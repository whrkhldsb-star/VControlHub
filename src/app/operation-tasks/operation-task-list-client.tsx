"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { OperationTask, OperationTaskFailureSummary, OperationTaskSourceSummary, OperationTaskStatus } from "@/lib/operation-task/service";
import { csrfFetch } from "@/lib/auth/csrf-client";

const sourceLabels: Record<string, string> = { job: "后台", command: "命令", scheduled: "定时", download: "下载", sync: "同步", backup: "备份", deployment: "部署" };
const statusClass: Record<string, string> = {
  pending: "border-amber-400/20 bg-amber-400/10 text-amber-200",
  running: "border-cyan-400/20 bg-cyan-400/10 text-cyan-200",
  completed: "border-emerald-400/20 bg-emerald-400/10 text-emerald-200",
  failed: "border-rose-400/20 bg-rose-400/10 text-rose-200",
  cancelled: "border-slate-400/20 bg-slate-400/10 text-slate-300",
  paused: "border-violet-400/20 bg-violet-400/10 text-violet-200",
};
const statusFilters = [
  { label: "全部", value: "all" },
  { label: "需处理", value: "attention" },
  { label: "失败", value: "failed" },
  { label: "运行中", value: "running" },
  { label: "待处理", value: "pending" },
  { label: "已完成", value: "completed" },
] as const;

const sortOptions = [
  { label: "最新优先", value: "recent" },
  { label: "需处理优先", value: "attention" },
] as const;

function getRefreshPath(statusFilter: string, taskTypeFilter: string, sort: string) {
  const params = new URLSearchParams();
  if (statusFilter === "attention") params.set("status", "failed,running,pending");
  else if (statusFilter !== "all") params.set("status", statusFilter);
  if (taskTypeFilter !== "all") params.set("taskType", taskTypeFilter);
  if (sort !== "recent") params.set("sort", sort);
  const query = params.toString();
  return `/api/operation-tasks${query ? `?${query}` : ""}`;
}

function getExportPath(statusFilter: string, taskTypeFilter: string, sort: string) {
  const path = getRefreshPath(statusFilter, taskTypeFilter, sort);
  return `${path}${path.includes("?") ? "&" : "?"}format=csv`;
}

export function OperationTaskListClient({ initialTasks, initialSourceSummary = [], initialFailureSummary = [] }: { initialTasks: OperationTask[]; initialSourceSummary?: OperationTaskSourceSummary[]; initialFailureSummary?: OperationTaskFailureSummary[] }) {
  const [tasks, setTasks] = useState(initialTasks);
  const [sourceSummary, setSourceSummary] = useState(initialSourceSummary);
  const [failureSummary, setFailureSummary] = useState(initialFailureSummary);
  const [statusFilter, setStatusFilter] = useState<(typeof statusFilters)[number]["value"]>("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState("all");
  const [sort, setSort] = useState<(typeof sortOptions)[number]["value"]>("recent");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const taskTypeOptions = useMemo(() => Array.from(new Set(tasks.map((task) => task.taskType).filter((value): value is string => Boolean(value)))).sort(), [tasks]);
  const refresh = async () => {
    setRefreshing(true);
    setError(null);
    try {
      const data = await csrfFetch(getRefreshPath(statusFilter, taskTypeFilter, sort));
      setTasks(data.tasks ?? []);
      setSourceSummary(data.sourceSummary ?? []);
      setFailureSummary(data.failureSummary ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "刷新任务中心失败");
    } finally { setRefreshing(false); }
  };
  const counts = tasks.reduce<Record<OperationTaskStatus, number>>((acc, task) => { acc[task.status] = (acc[task.status] ?? 0) + 1; return acc; }, {} as Record<OperationTaskStatus, number>);
  return <div className="space-y-5">
    {error && <div role="alert" className="rounded-xl border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3 text-sm text-rose-100">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-4">
      {[["running","运行中"],["pending","待处理"],["failed","失败"],["completed","已完成"]].map(([key,label]) => <div key={key} className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4"><div className="text-xs text-slate-500">{label}</div><div className="mt-2 text-2xl font-semibold text-white">{counts[key as OperationTaskStatus] ?? 0}</div></div>)}
    </div>
    <section aria-label="来源聚合" className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">来源聚合</h2>
          <p className="mt-1 text-xs text-slate-500">按任务来源汇总当前筛选结果，优先显示失败/运行中/待处理数量。</p>
        </div>
        <div className="text-xs text-slate-500">共 {tasks.length} 条</div>
      </div>
      {sourceSummary.length === 0 ? <p className="mt-3 text-sm text-slate-500">暂无来源分布</p> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sourceSummary.map((item) => <div key={item.source} className="rounded-lg border border-white/[0.06] bg-white/[0.03] px-3 py-3">
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-white">{sourceLabels[item.source] ?? item.source}</span><span className="text-xs text-slate-500">总计 {item.total}</span></div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-400"><span>需处理 {item.attention}</span><span>失败 {item.failed}</span><span>运行中 {item.running}</span><span>待处理 {item.pending}</span></div>
        </div>)}
      </div>}
    </section>
    <section aria-label="失败原因聚合" className="rounded-xl border border-rose-400/15 bg-rose-500/[0.04] p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">失败原因聚合</h2>
          <p className="mt-1 text-xs text-slate-500">按当前筛选结果归类失败任务，优先处理重复出现的失败模式。</p>
        </div>
        <div className="text-xs text-slate-500">共 {failureSummary.reduce((total, item) => total + item.total, 0)} 条失败</div>
      </div>
      {failureSummary.length === 0 ? <p className="mt-3 text-sm text-slate-500">当前筛选结果暂无失败任务</p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {failureSummary.map((item) => <div key={item.reason} className="rounded-lg border border-rose-400/15 bg-rose-500/[0.05] px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-white">{item.reason}</span><span className="rounded-md border border-rose-400/20 bg-rose-400/10 px-2 py-1 text-xs text-rose-100">{item.total} 条</span></div>
          <p className="mt-2 text-xs text-slate-500">来源：{item.sources.map((source) => sourceLabels[source] ?? source).join("、")} · 最新：{item.latestTitle}</p>
        </div>)}
      </div>}
    </section>
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02]">
      <div className="flex flex-col gap-4 border-b border-white/[0.06] px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-white">最近任务</h2>
          <p className="mt-1 text-xs text-slate-500">可优先查看失败/运行中任务，并按 durable job 类型缩小排查范围。</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="text-xs font-medium text-slate-400">
            <span className="mb-1 block">状态筛选</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="min-w-32 rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 light:bg-white">
              {statusFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-400">
            <span className="mb-1 block">任务类型</span>
            <select value={taskTypeFilter} onChange={(event) => setTaskTypeFilter(event.target.value)} className="min-w-44 rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 light:bg-white">
              <option value="all">全部类型</option>
              {taskTypeOptions.map((taskType) => <option key={taskType} value={taskType}>{taskType}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-slate-400">
            <span className="mb-1 block">排序偏好</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="min-w-36 rounded-lg border border-white/[0.08] bg-slate-950 px-3 py-2 text-sm text-slate-100 light:bg-white">
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button onClick={refresh} disabled={refreshing} className="rounded-lg border border-white/[0.08] px-3 py-2 text-xs text-slate-300 hover:bg-white/[0.05] disabled:opacity-50">{refreshing ? "刷新中..." : "应用筛选"}</button>
          <a href={getExportPath(statusFilter, taskTypeFilter, sort)} className="rounded-lg border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-xs font-medium text-cyan-100 hover:bg-cyan-400/20">导出当前结果 CSV</a>
        </div>
      </div>
      <div className="divide-y divide-white/[0.06]">
        {tasks.length === 0 ? <div className="p-8 text-center text-sm text-slate-500">暂无匹配任务</div> : tasks.map((task) => <div key={task.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-md bg-white/[0.05] px-2 py-1 text-xs text-slate-400">{sourceLabels[task.source] ?? task.source}</span><span className={`rounded-md border px-2 py-1 text-xs ${statusClass[task.status]}`}>{task.status}</span>{task.taskType && <span className="rounded-md border border-white/[0.08] px-2 py-1 text-xs text-slate-400">{task.taskType}</span>}{task.foldedCount && task.foldedCount > 1 && <span className="rounded-md border border-indigo-400/20 bg-indigo-400/10 px-2 py-1 text-xs text-indigo-200">已折叠 {task.foldedCount} 次周期完成记录</span>}{task.workerId && <span title={task.workerHeartbeatAt ? `最近心跳：${new Date(task.workerHeartbeatAt).toLocaleString("zh-CN")}` : "后台执行器已认领，暂无心跳时间"} className="rounded-md border border-cyan-400/20 bg-cyan-400/10 px-2 py-1 text-xs text-cyan-200">worker {task.workerId}</span>}</div><h3 className="mt-2 truncate text-sm font-medium text-white">{task.title}</h3><p className="mt-1 text-xs text-slate-500">{new Date(task.createdAt).toLocaleString("zh-CN")} {task.actor ? ` · ${task.actor}` : ""} {task.progress ? ` · ${task.progress}` : ""}</p>{task.logPreview && task.logPreview.length > 0 && <div aria-label={`最近日志：${task.title}`} className="mt-3 rounded-lg border border-white/[0.06] bg-slate-950/60 px-3 py-2 light:bg-slate-50"><div className="text-[11px] font-medium uppercase tracking-[0.2em] text-slate-500">最近日志</div><ul className="mt-2 space-y-1 text-xs text-slate-300">{task.logPreview.map((line, index) => <li key={`${task.id}-log-${index}`} className="break-words font-mono">{line}</li>)}</ul></div>}</div>
          {task.href && <Link href={task.href} className="text-xs text-cyan-300 hover:text-cyan-200">查看来源 →</Link>}
        </div>)}
      </div>
    </div>
  </div>;
}
