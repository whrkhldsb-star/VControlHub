"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState } from "@/components/page-shell";
import type { OperationTask, OperationTaskFailureSummary, OperationTaskSourceSummary, OperationTaskStatus } from "@/lib/operation-task/dto";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

import { JobEventsDialog } from "./job-events-dialog";

function getSourceLabels(t: (k: string) => string): Record<string, string> {
  return {
    job: t("operationTasksPage.source.job"),
    command: t("operationTasksPage.source.command"),
    scheduled: t("operationTasksPage.source.scheduled"),
    download: t("operationTasksPage.source.download"),
    sync: t("operationTasksPage.source.sync"),
    backup: t("operationTasksPage.source.backup"),
    deployment: t("operationTasksPage.source.deployment"),
  };
}
const statusTone: Record<string, "accent" | "success" | "warning" | "danger" | "neutral"> = {
  pending: "warning",
  running: "accent",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
  paused: "neutral",
};

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
  const { t } = useI18n();
  const statusFilters = [
    { label: t("operationTasks.filter.all"), value: "all" },
    { label: t("operationTasks.filter.attention"), value: "attention" },
    { label: t("operationTasks.filter.failed"), value: "failed" },
    { label: t("operationTasks.filter.running"), value: "running" },
    { label: t("operationTasks.filter.pending"), value: "pending" },
    { label: t("operationTasks.filter.completed"), value: "completed" },
  ] as const;

  const sortOptions = [
    { label: t("operationTasks.sort.recent"), value: "recent" },
    { label: t("operationTasks.sort.attention"), value: "attention" },
  ] as const;
  const [tasks, setTasks] = useState(initialTasks);
  const [sourceSummary, setSourceSummary] = useState(initialSourceSummary);
  const [failureSummary, setFailureSummary] = useState(initialFailureSummary);
  const [statusFilter, setStatusFilter] = useState<(typeof statusFilters)[number]["value"]>("all");
  const [taskTypeFilter, setTaskTypeFilter] = useState("all");
  const [sort, setSort] = useState<(typeof sortOptions)[number]["value"]>("recent");
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventsJobId, setEventsJobId] = useState<string | null>(null);
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
      setError(err instanceof Error ? err.message : t("operationTasks.refreshFailed"));
    } finally { setRefreshing(false); }
  };
  const counts = tasks.reduce<Record<OperationTaskStatus, number>>((acc, task) => { acc[task.status] = (acc[task.status] ?? 0) + 1; return acc; }, {} as Record<OperationTaskStatus, number>);
  return <div className="space-y-5">
    {error && <div role="alert" data-tone="rose" className="rounded-xl border border-rose-400/20 px-4 py-3 text-sm text-rose-100">{error}</div>}
    <div className="grid gap-3 sm:grid-cols-4">
      {[["running", t("operationTasks.filter.running")],["pending", t("operationTasks.filter.pending")],["failed", t("operationTasks.filter.failed")],["completed", t("operationTasks.filter.completed")]].map(([key,label]) => <div key={key} data-card className=" p-4"><div className="text-xs text-[var(--text-muted)]">{label}</div><div className="mt-2 text-2xl font-semibold text-[var(--text-primary)]">{counts[key as OperationTaskStatus] ?? 0}</div></div>)}
    </div>
    <section aria-label={t("operationTasks.summary.sourceGroup")} data-card className="p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("operationTasks.summary.sourceGroup")}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("operationTasks.summary.sourceGroupDesc")}</p>
        </div>
        <div className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.summary.totalCount").replace("{count}", String(tasks.length))}</div>
      </div>
      {sourceSummary.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">{t("operationTasks.summary.noSources")}</p> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sourceSummary.map((item) => <div key={item.source} className="rounded-lg border border-[var(--border)]/[0.10] bg-[var(--surface)]/[0.04] px-3 py-3">
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-[var(--text-primary)]">{getSourceLabels(t)[item.source] ?? item.source}</span><span className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.summary.grandTotal").replace("{count}", String(item.total))}</span></div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]"><span>{t("operationTasksPage.summary.needProcess").replace("{count}", String(item.attention))}</span><span>{t("operationTasksPage.summary.failed").replace("{count}", String(item.failed))}</span><span>{t("operationTasksPage.summary.running").replace("{count}", String(item.running))}</span><span>{t("operationTasksPage.summary.pending").replace("{count}", String(item.pending))}</span></div>
        </div>)}
      </div>}
    </section>
    <section aria-label={t("operationTasks.summary.failureGroup")} data-tone="rose" className="rounded-xl border border-rose-400/15 p-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("operationTasks.summary.failureGroup")}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.desc")}</p>
        </div>
        <div className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.totalCount").replace("{count}", String(failureSummary.reduce((total, item) => total + item.total, 0)))}</div>
      </div>
      {failureSummary.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">{t("operationTasks.summary.noFailures")}</p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {failureSummary.map((item) => <div key={item.reason} data-tone="rose" className="rounded-lg border border-rose-400/15 px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-[var(--text-primary)]">{item.reason}</span><span data-tone="danger" className="rounded-lg border px-2 py-1 text-xs font-medium">{t("operationTasksPage.failures.itemCount").replace("{count}", String(item.total))}</span></div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.sourceAndLatest").replace("{sources}", item.sources.map((source) => getSourceLabels(t)[source] ?? source).join("、")).replace("{title}", item.latestTitle)}</p>
        </div>)}
      </div>}
    </section>
    <div data-card className="">
      <div className="flex flex-col gap-4 border-b border-[var(--border)]/[0.10] px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("operationTasksPage.recentTasks")}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("operationTasksPage.recentTasksHint")}</p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="text-xs font-medium text-[var(--text-muted)]">
            <span className="mb-1 block">{t("operationTasksPage.filter.status")}</span>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="min-w-32 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {statusFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-muted)]">
            <span className="mb-1 block">{t("operationTasksPage.filter.taskType")}</span>
            <select value={taskTypeFilter} onChange={(event) => setTaskTypeFilter(event.target.value)} className="min-w-44 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]">
              <option value="all">{t("operationTasksPage.filter.allTypes")}</option>
              {taskTypeOptions.map((taskType) => <option key={taskType} value={taskType}>{taskType}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-muted)]">
            <span className="mb-1 block">{t("operationTasksPage.filter.sort")}</span>
            <select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className="min-w-36 rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-sm text-[var(--text-primary)]">
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button onClick={refresh} disabled={refreshing} className="rounded-lg border border-[var(--border)] px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">{refreshing ? t("operationTasks.action.refreshing") : t("operationTasks.action.applyFilter")}</button>
          <a href={getExportPath(statusFilter, taskTypeFilter, sort)} data-tone="accent" className="rounded-lg border px-3 py-2 text-xs font-medium">{t("operationTasksPage.export.csv")}</a>
        </div>
      </div>
      <div className="divide-y divide-[var(--border)]">
        {tasks.length === 0 ? <EmptyState text={t("operationTasks.tasks.empty")} /> : tasks.map((task) => <div key={task.id} className="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><span className="rounded-lg bg-[var(--surface-hover)] px-2 py-1 text-xs text-[var(--text-muted)]">{getSourceLabels(t)[task.source] ?? task.source}</span><span data-tone={statusTone[task.status] ?? "neutral"} className="rounded-lg border px-2 py-1 text-xs font-medium">{task.status}</span>{task.taskType && <span className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)]">{task.taskType}</span>}{task.foldedCount && task.foldedCount > 1 && <span className="rounded-lg border border-indigo-400/20 bg-indigo-400/10 px-2 py-1 text-xs text-indigo-200 dark:text-indigo-200">{t("operationTasksPage.folded").replace("{count}", String(task.foldedCount))}</span>}{task.workerId && <span title={task.workerHeartbeatAt ? `最近心跳：${new Date(task.workerHeartbeatAt).toLocaleString("zh-CN")}` : t("operationTasksPage.worker.noHeartbeat")} data-tone="accent" className="rounded-lg border px-2 py-1 text-xs font-medium">worker {task.workerId}</span>}</div><h3 className="mt-2 truncate text-sm font-medium text-[var(--text-primary)]">{task.title}</h3><p className="mt-1 text-xs text-[var(--text-muted)]">{new Date(task.createdAt).toLocaleString("zh-CN")} {task.actor ? ` · ${task.actor}` : ""} {task.progress ? ` · ${task.progress}` : ""}</p>{task.logPreview && task.logPreview.length > 0 && <div aria-label={`最近日志：${task.title}`} className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2"><div className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("operationTasksPage.logs.recent")}</div><ul className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">{task.logPreview.map((line, index) => <li key={`${task.id}-log-${index}`} className="break-words font-mono">{line}</li>)}</ul></div>}</div>
          <div className="flex flex-col items-end gap-2">
            {task.source === "job" && task.eventCount && task.eventCount > 0 ? (
              <button type="button" onClick={() => setEventsJobId(task.sourceId)} className="text-xs text-[var(--color-action)] hover:opacity-80">
                {t("operationTasksPage.task.viewEvents").replace("{count}", String(task.eventCount))}
              </button>
            ) : null}
            {task.href && <Link href={task.href} className="text-xs text-[var(--color-action)] hover:text-[var(--text-secondary)]">{t("operationTasksPage.task.viewSource")}</Link>}
          </div>
        </div>)}
      </div>
    </div>
    <JobEventsDialog jobId={eventsJobId} open={eventsJobId !== null} onClose={() => setEventsJobId(null)} />
  </div>;
}
