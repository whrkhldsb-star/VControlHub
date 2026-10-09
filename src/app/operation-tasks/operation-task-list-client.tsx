"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import Link from "next/link";
import { EmptyState, ListPanel, ListRow, StatCard, StatGrid, SurfacePanel, Toolbar } from "@/components/page-shell";
import { Badge, CONTROL_CLASS, Notice } from "@/components/ui-primitives";
import { PaginatedList } from "@/components/paginated-list";
import { formatDateTime } from "@/lib/datetime/format";
import type { Locale } from "@/lib/i18n/core";
import type { OperationTask, OperationTaskFailureSummary, OperationTaskListResult, OperationTaskSourceSummary, OperationTaskStatus } from "@/lib/operation-task/dto";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

import { JobEventsDialog } from "./job-events-dialog";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton } from "@/components/action-button";
import { getDomainStatusLabel } from "@/lib/i18n/domain-labels";
import { StatusBadge, type StatusTone } from "@/components/status-badge";

const TASKS_PER_PAGE = 20;

function getSourceLabels(t: (k: string, vars?: Record<string, string | number>) => string): Record<string, string> {
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
/**
 * globals.css only defines `--tone-bg` for the seven hue names
 * (cyan/emerald/rose/amber/sky/blue/violet), so a hand-rolled
 * `<span data-tone="warning" className="border">` got no background, no border
 * colour and no text colour — all six statuses rendered identically. These names
 * are StatusBadge tones, which map to a real hue and set the classes explicitly.
 */
const statusTone: Record<string, StatusTone> = {
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
  t: (k: string, vars?: Record<string, string | number>) => string;
  locale: Locale;
  sourceLabels: Record<string, string>;
  onViewEvents: (sourceId: string) => void;
};

const TaskRow = memo(function TaskRow({ task, t, locale, sourceLabels, onViewEvents }: TaskRowProps) {
  return (
    <ListRow className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{sourceLabels[task.source] ?? task.source}</Badge>
          <StatusBadge tone={statusTone[task.status] ?? "neutral"}>{getDomainStatusLabel(t, task.status)}</StatusBadge>
          {task.taskType && <Badge>{task.taskType}</Badge>}
          {task.foldedCount && task.foldedCount > 1 && <Badge tone="accent">{t("operationTasksPage.folded", { count: task.foldedCount })}</Badge>}
          {task.workerId && <StatusBadge tone="info" title={task.workerHeartbeatAt ? t("operationTasksPage.worker.heartbeat", { time: formatDateTime(task.workerHeartbeatAt, locale) }) : t("operationTasksPage.worker.noHeartbeat")} className="!rounded-lg">worker {task.workerId}</StatusBadge>}
        </div>
        <h3 className="ui-title-group mt-2 truncate">{task.title}</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{formatDateTime(task.createdAt, locale)} {task.actor ? ` · ${task.actor}` : ""} {task.progress ? ` · ${task.progress}` : ""}</p>
        {task.logPreview && task.logPreview.length > 0 && (
          <div aria-label={`Recent logs: ${task.title}`} data-inset className="mt-3 px-3 py-2">
            <div className="text-xs font-medium uppercase text-[var(--text-muted)]">{t("operationTasksPage.logs.recent")}</div>
            <ul className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
              {task.logPreview.map((line, index) => <li key={`${task.id}-log-${index}`} className="break-words font-mono">{line}</li>)}
            </ul>
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        {task.source === "job" && task.eventCount && task.eventCount > 0 ? (
          <button type="button" onClick={() => onViewEvents(task.sourceId)} className="text-xs font-medium text-[var(--accent)] hover:opacity-80">
            {t("operationTasksPage.task.viewEvents", { count: task.eventCount })}
          </button>
        ) : null}
        {task.href && <Link href={task.href} className="text-xs font-medium text-[var(--accent)] hover:text-[var(--text-secondary)]">{t("operationTasksPage.task.viewSource")}</Link>}
      </div>
    </ListRow>
  );
}, (prev, next) => prev.task === next.task && prev.t === next.t && prev.locale === next.locale && prev.sourceLabels === next.sourceLabels && prev.onViewEvents === next.onViewEvents);

export function OperationTaskListClient({ initialTasks, initialSourceSummary = [], initialFailureSummary = [] }: { initialTasks: OperationTask[]; initialSourceSummary?: OperationTaskSourceSummary[]; initialFailureSummary?: OperationTaskFailureSummary[] }) {
  const { t, locale } = useI18n();
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
  const { state: urlState, setField: setUrlField } = useUrlQueryState({
    status: "all",
    type: "all",
    sort: "recent",
  });
  const statusFilter = (urlState.status || "all") as (typeof statusFilters)[number]["value"];
  const setStatusFilter = (value: (typeof statusFilters)[number]["value"]) => setUrlField("status", value);
  const taskTypeFilter = urlState.type || "all";
  const setTaskTypeFilter = (value: string) => setUrlField("type", value);
  const sort = (urlState.sort || "recent") as (typeof sortOptions)[number]["value"];
  const setSort = (value: (typeof sortOptions)[number]["value"]) => setUrlField("sort", value);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eventsJobId, setEventsJobId] = useState<string | null>(null);
  // Client-side title/actor/type needle over the loaded slice — the server
  // filters are coarse (status/type), this narrows "that one task" quickly.
  const [needle, setNeedle] = useState("");
  // Bumped after every successful refresh so PaginatedList's resetKey changes
  // and the page snaps back to 1, matching the pre-PaginatedList behavior.
  const [refreshTick, setRefreshTick] = useState(0);
  const handleViewEvents = useCallback((sourceId: string) => setEventsJobId(sourceId), []);
  const taskTypeOptions = useMemo(() => Array.from(new Set(tasks.map((task) => task.taskType).filter((value): value is string => Boolean(value)))).sort(), [tasks]);
  const needleNorm = needle.trim().toLowerCase();
  const visibleTasks = useMemo(
    () =>
      needleNorm
        ? tasks.filter((task) =>
            task.title.toLowerCase().includes(needleNorm) ||
            (task.actor ?? "").toLowerCase().includes(needleNorm) ||
            (task.taskType ?? "").toLowerCase().includes(needleNorm))
        : tasks,
    [tasks, needleNorm],
  );
  const refreshSequenceRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const filterKey = `${statusFilter}:${taskTypeFilter}:${sort}`;
  const refresh = useCallback(async () => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const refreshSequence = ++refreshSequenceRef.current;
    const requestFilterKey = filterKey;
    setRefreshing(true);
    setError(null);
    try {
      const data = await csrfFetch<Partial<OperationTaskListResult>>(
        getRefreshPath(statusFilter, taskTypeFilter, sort),
        { signal: controller.signal },
      );
      if (
        refreshSequence !== refreshSequenceRef.current ||
        requestFilterKey !== `${statusFilter}:${taskTypeFilter}:${sort}`
      ) {
        return;
      }
      setTasks(data.tasks ?? []);
      setSourceSummary(data.sourceSummary ?? []);
      setFailureSummary(data.failureSummary ?? []);
      setRefreshTick((tick) => tick + 1);
    } catch (err) {
      if (controller.signal.aborted || refreshSequence !== refreshSequenceRef.current) return;
      setError(getErrorMessage(err, t("operationTasks.refreshFailed")));
    } finally {
      if (refreshSequence === refreshSequenceRef.current) setRefreshing(false);
    }
  }, [statusFilter, taskTypeFilter, sort, filterKey, t]);
  // Apply URL deep-link / non-default filter changes without requiring Apply.
  // Skip the first paint when filters are still the SSR defaults to keep initialTasks
  // and avoid a redundant fetch that races tests/mocks.
  const didSkipDefaultRefreshRef = useRef(false);
  useEffect(() => {
    const isDefault =
      statusFilter === "all" && taskTypeFilter === "all" && sort === "recent";
    if (!didSkipDefaultRefreshRef.current) {
      didSkipDefaultRefreshRef.current = true;
      if (isDefault) return;
    }
    void refresh();
  }, [refresh, statusFilter, taskTypeFilter, sort]);
  useEffect(() => () => {
    refreshAbortRef.current?.abort();
  }, []);
  const counts = tasks.reduce<Record<OperationTaskStatus, number>>((acc, task) => { acc[task.status] = (acc[task.status] ?? 0) + 1; return acc; }, {} as Record<OperationTaskStatus, number>);
  return <div className="flex flex-col gap-5">
    {error && <Notice tone="danger">{error}</Notice>}
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
      actions={<span className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.summary.totalCount", { count: tasks.length })}</span>}
    >
      {sourceSummary.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">{t("operationTasks.summary.noSources")}</p> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {sourceSummary.map((item) => <div key={item.source} data-inset className="px-3 py-3">
          <div className="flex items-center justify-between gap-3"><span className="text-sm font-medium text-[var(--text-primary)]">{sourceLabels[item.source] ?? item.source}</span><span className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.summary.grandTotal", { count: item.total })}</span></div>
          <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]"><span>{t("operationTasksPage.summary.needProcess", { count: item.attention })}</span><span>{t("operationTasksPage.summary.failed", { count: item.failed })}</span><span>{t("operationTasksPage.summary.running", { count: item.running })}</span><span>{t("operationTasksPage.summary.pending", { count: item.pending })}</span></div>
        </div>)}
      </div>}
    </SurfacePanel>
    </section>
    <section data-card="" aria-label={t("operationTasks.summary.failureGroup")} className={`p-4 ${failureSummary.length ? "border-[var(--danger-border)]" : ""}`}>
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h2 className="ui-title-section">{t("operationTasks.summary.failureGroup")}</h2>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.desc")}</p>
        </div>
        <div className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.totalCount", { count: failureSummary.reduce((total, item) => total + item.total, 0) })}</div>
      </div>
      {failureSummary.length === 0 ? <p className="mt-3 text-sm text-[var(--text-muted)]">{t("operationTasks.summary.noFailures")}</p> : <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {failureSummary.map((item) => <div data-inset="" key={item.reason} className="border-[var(--danger-border)] px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-sm font-medium text-[var(--text-primary)]">{item.reason}</span><StatusBadge tone="danger">{t("operationTasksPage.failures.itemCount", { count: item.total })}</StatusBadge></div>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.sourceAndLatest", { sources: item.sources.map((source) => sourceLabels[source] ?? source).join("、"), title: item.latestTitle })}</p>
        </div>)}
      </div>}
    </section>
    <ListPanel
      title={t("operationTasksPage.recentTasks")}
      description={t("operationTasksPage.recentTasksHint")}
      count={visibleTasks.length}
      actions={
        <Toolbar className="!mb-0 flex-col gap-2 border-0 bg-transparent p-0 shadow-none sm:flex-row sm:items-end">
          <label className="ui-label">
            <span className="mb-1 block">{t("operationTasksPage.filter.search")}</span>
            <input
              type="search"
              value={needle}
              onChange={(event) => setNeedle(event.target.value)}
              placeholder={t("operationTasksPage.filter.searchPlaceholder")}
              aria-label={t("operationTasksPage.filter.search")}
              className={`${CONTROL_CLASS} min-w-44 sm:w-52`}
            />
          </label>
          <label className="ui-label">
            <span className="mb-1 block">{t("operationTasksPage.filter.status")}</span>
            <select data-input value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className={`${CONTROL_CLASS} !w-auto min-w-32`}>
              {statusFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
            </select>
          </label>
          <label className="ui-label">
            <span className="mb-1 block">{t("operationTasksPage.filter.taskType")}</span>
            <select data-input value={taskTypeFilter} onChange={(event) => setTaskTypeFilter(event.target.value)} className={`${CONTROL_CLASS} !w-auto min-w-44`}>
              <option value="all">{t("operationTasksPage.filter.allTypes")}</option>
              {taskTypeOptions.map((taskType) => <option key={taskType} value={taskType}>{taskType}</option>)}
            </select>
          </label>
          <label className="ui-label">
            <span className="mb-1 block">{t("operationTasksPage.filter.sort")}</span>
            <select data-input value={sort} onChange={(event) => setSort(event.target.value as typeof sort)} className={`${CONTROL_CLASS} !w-auto min-w-36`}>
              {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </label>
          <ActionButton variant="secondary" onClick={refresh} disabled={refreshing}>{refreshing ? t("operationTasks.action.refreshing") : t("operationTasks.action.applyFilter")}</ActionButton>
          <a href={getExportPath(statusFilter, taskTypeFilter, sort)} data-action-button data-size="sm" data-variant="ghost">{t("operationTasksPage.export.csv")}</a>
        </Toolbar>
      }
      empty={visibleTasks.length === 0 ? <EmptyState text={needleNorm ? t("operationTasksPage.filter.noMatch") : t("operationTasks.tasks.empty")} /> : undefined}
    >
      <PaginatedList pageSize={TASKS_PER_PAGE} resetKey={`${filterKey}:${refreshTick}:${needleNorm}`}>
        {visibleTasks.map((task) => <TaskRow key={task.id} task={task} t={t} locale={locale} sourceLabels={sourceLabels} onViewEvents={handleViewEvents} />)}
      </PaginatedList>
    </ListPanel>
    <JobEventsDialog jobId={eventsJobId} open={eventsJobId !== null} onClose={() => setEventsJobId(null)} />
  </div>;
}
