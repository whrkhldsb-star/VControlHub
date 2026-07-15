"use client";

import { memo, useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { EmptyState, ListPanel, ListRow, StatCard, StatGrid, SurfacePanel, Toolbar } from "@/components/page-shell";
import { CONTROL_CLASS } from "@/components/ui-primitives";
import type { OperationTask, OperationTaskFailureSummary, OperationTaskSourceSummary, OperationTaskStatus } from "@/lib/operation-task/dto";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { toDateLocale } from "@/lib/i18n/locale-format";

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

type TaskRowProps = {
  task: OperationTask;
  t: (k: string) => string;
  dateLocale: string;
  sourceLabels: Record<string, string>;
  onViewEvents: (sourceId: string) => void;
};

const TaskRow = memo(function TaskRow({ task, t, dateLocale, sourceLabels, onViewEvents }: TaskRowProps) {
  return (
    <ListRow className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded-lg border border-[var(--border-subtle)] bg-[var(--surface-elevated)] px-2 py-1 text-xs text-[var(--text-muted)]">{sourceLabels[task.source] ?? task.source}</span>
          <span data-tone={statusTone[task.status] ?? "neutral"} className="rounded-lg border px-2 py-1 text-xs font-semibold">{task.status}</span>
          {task.taskType && <span className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--text-muted)]">{task.taskType}</span>}
          {task.foldedCount && task.foldedCount > 1 && <span className="rounded-lg border border-[var(--accent-border)] bg-[var(--accent-bg)] px-2 py-1 text-xs text-[var(--accent)]">{t("operationTasksPage.folded").replace("{count}", String(task.foldedCount))}</span>}
          {task.workerId && <span title={task.workerHeartbeatAt ? t("operationTasksPage.worker.heartbeat").replace("{time}", new Date(task.workerHeartbeatAt).toLocaleString(dateLocale)) : t("operationTasksPage.worker.noHeartbeat")} data-tone="accent" className="rounded-lg border px-2 py-1 text-xs font-medium">worker {task.workerId}</span>}
        </div>
        <h3 className="mt-2 truncate text-sm font-semibold text-[var(--text-primary)]">{task.title}</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{new Date(task.createdAt).toLocaleString(dateLocale)} {task.actor ? ` · ${task.actor}` : ""} {task.progress ? ` · ${task.progress}` : ""}</p>
        {task.logPreview && task.logPreview.length > 0 && (
          <div aria-label={`Recent logs: ${task.title}`} className="mt-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-2">
            <div className="text-[11px] font-medium uppercase tracking-[0.2em] text-[var(--text-muted)]">{t("operationTasksPage.logs.recent")}</div>
            <ul className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
              {task.logPreview.map((line, index) => <li key={`${task.id}-log-${index}`} className="break-words font-mono">{line}</li>)}
            </ul>
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        {task.source === "job" && task.eventCount && task.eventCount > 0 ? (
          <button type="button" onClick={() => onViewEvents(task.sourceId)} className="text-xs font-medium text-[var(--accent)] hover:opacity-80">
            {t("operationTasksPage.task.viewEvents").replace("{count}", String(task.eventCount))}
          </button>
        ) : null}
        {task.href && <Link href={task.href} className="text-xs font-medium text-[var(--accent)] hover:text-[var(--text-secondary)]">{t("operationTasksPage.task.viewSource")}</Link>}
      </div>
    </ListRow>
  );
}, (prev, next) => prev.task === next.task && prev.t === next.t && prev.dateLocale === next.dateLocale && prev.sourceLabels === next.sourceLabels && prev.onViewEvents === next.onViewEvents);

export function OperationTaskListClient({ initialTasks, initialSourceSummary = [], initialFailureSummary = [] }: { initialTasks: OperationTask[]; initialSourceSummary?: OperationTaskSourceSummary[]; initialFailureSummary?: OperationTaskFailureSummary[] }) {
  const { t, locale } = useI18n();
  const dateLocale = toDateLocale(locale);
  const sourceLabels = useMemo(() => getSourceLabels(t), [t]);
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
  const handleViewEvents = useCallback((sourceId: string) => setEventsJobId(sourceId), []);
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
    {error && <div role="alert" className="rounded-xl border border-[var(--danger-border)] bg-[var(--danger-bg)] px-4 py-3 text-sm text-[var(--danger)]">{error}</div>}
    <StatGrid cols={4} className="mb-0">
      <StatCard label={t("operationTasks.filter.running")} value={String(counts.running ?? 0)} accent={(counts.running ?? 0) > 0} accentColor="cyan" />
      <StatCard label={t("operationTasks.filter.pending")} value={String(counts.pending ?? 0)} accent={(counts.pending ?? 0) > 0} accentColor="amber" />
      <StatCard label={t("operationTasks.filter.failed")} value={String(counts.failed ?? 0)} accent={(counts.failed ?? 0) > 0} accentColor="rose" />
      <StatCard label={t("operationTasks.filter.completed")} value={String(counts.completed ?? 0)} accent={(counts.completed ?? 0) > 0} accentColor="emerald" />
    </StatGrid>
    <section aria-label={t("operationTasks.summary.sourceGroup")}>
    <SurfacePanel
      title={t("operationTasks.summary.sourceGroup")}
      description={t("operationTasks.summary.sourceGroupDesc")}
      actions={<span className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.summary.totalCount").replace("{count}", String(tasks.length))}</span>}
    >
      {sourceSummary.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">{t("operationTasks.summary.noSources")}</p> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sourceSummary.map((item) => <div key={item.source} className="rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-subtle)] px-3 py-3">
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-[var(--text-primary)]">{sourceLabels[item.source] ?? item.source}</span><span className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.summary.grandTotal").replace("{count}", String(item.total))}</span></div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]"><span>{t("operationTasksPage.summary.needProcess").replace("{count}", String(item.attention))}</span><span>{t("operationTasksPage.summary.failed").replace("{count}", String(item.failed))}</span><span>{t("operationTasksPage.summary.running").replace("{count}", String(item.running))}</span><span>{t("operationTasksPage.summary.pending").replace("{count}", String(item.pending))}</span></div>
        </div>)}
      </div>}
    </SurfacePanel>
    </section>
    <section aria-label={t("operationTasks.summary.failureGroup")} className="rounded-2xl border border-[var(--danger-border)] bg-[color-mix(in_srgb,var(--danger-bg)_35%,var(--surface))] p-4 shadow-[var(--shadow-sm)]">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{t("operationTasks.summary.failureGroup")}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.desc")}</p>
        </div>
        <div className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.totalCount").replace("{count}", String(failureSummary.reduce((total, item) => total + item.total, 0)))}</div>
      </div>
      {failureSummary.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">{t("operationTasks.summary.noFailures")}</p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {failureSummary.map((item) => <div key={item.reason} className="rounded-xl border border-[var(--danger-border)] bg-[var(--surface)] px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-[var(--text-primary)]">{item.reason}</span><span className="rounded-lg border border-[var(--danger-border)] bg-[var(--danger-bg)] px-2 py-1 text-xs font-medium text-[var(--danger)]">{t("operationTasksPage.failures.itemCount").replace("{count}", String(item.total))}</span></div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.sourceAndLatest").replace("{sources}", item.sources.map((source) => sourceLabels[source] ?? source).join("、")).replace("{title}", item.latestTitle)}</p>
        </div>)}
      </div>}
    </section>
    <ListPanel
      title={t("operationTasksPage.recentTasks")}
      count={tasks.length}
      actions={
        <Toolbar className="!mb-0 flex-col gap-2 border-0 bg-transparent p-0 shadow-none sm:flex-row sm:items-end">
          <label className="text-xs font-medium text-[var(--text-muted)]">
            <span className="mb-1 block">{t("operationTasksPage.filter.status")}</span>
            <select data-input value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className={`${CONTROL_CLASS} !w-auto min-w-32`}>
              {statusFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-muted)]">
            <span className="mb-1 block">{t("operationTasksPage.filter.taskType")}</span>
            <select data-input value={taskTypeFilter} onChange={(event) => setTaskTypeFilter(event.target.value)} className={`${CONTROL_CLASS} !w-auto min-w-44`}>
              <option value="all">{t("operationTasksPage.filter.allTypes")}</option>
              {taskTypeOptions.map((taskType) => <option key={taskType} value={taskType}>{taskType}</option>)}
            </select>
          </label>
          <label className="text-xs font-medium text-[var(--text-muted)]">
            <span className="mb-1 block">{t("operationTasksPage.filter.sort")}</span>
            <select data-input value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className={`${CONTROL_CLASS} !w-auto min-w-36`}>
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={refresh} disabled={refreshing} className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:bg-[var(--surface-hover)] disabled:opacity-50">{refreshing ? t("operationTasks.action.refreshing") : t("operationTasks.action.applyFilter")}</button>
          <a href={getExportPath(statusFilter, taskTypeFilter, sort)} data-action-button data-variant="primary" className="px-3 py-2 text-xs">{t("operationTasksPage.export.csv")}</a>
        </Toolbar>
      }
      empty={tasks.length === 0 ? <EmptyState text={t("operationTasks.tasks.empty")} /> : undefined}
    >
      {tasks.map((task) => <TaskRow key={task.id} task={task} t={t} dateLocale={dateLocale} sourceLabels={sourceLabels} onViewEvents={handleViewEvents} />)}
    </ListPanel>
    <JobEventsDialog jobId={eventsJobId} open={eventsJobId !== null} onClose={() => setEventsJobId(null)} />
  </div>;
}
