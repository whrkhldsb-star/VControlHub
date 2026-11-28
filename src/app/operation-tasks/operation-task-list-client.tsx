"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useUrlQueryState } from "@/lib/hooks/use-url-query-state";
import { useVisibilityInterval } from "@/lib/hooks/use-visibility-interval";
import Link from "next/link";
import { EmptyState, ListPanel, ListRow, SurfacePanel, Toolbar } from "@/components/page-shell";
import { Badge, CONTROL_CLASS, Notice } from "@/components/ui-primitives";
import { ExecutionEvidence } from "@/components/execution-evidence";
import { PaginatedList } from "@/components/paginated-list";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { formatDateTime } from "@/lib/datetime/format";
import type { Locale } from "@/lib/i18n/core";
import type {
  OperationTask,
  OperationTaskFailureSummary,
  OperationTaskListResult,
  OperationTaskSourceSummary,
  OperationTaskStatus,
} from "@/lib/operation-task/dto";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";
import { directCommandHref } from "@/lib/ui/deep-links";
import { cn } from "@/lib/ui/cn";

import { JobEventsDialog } from "./job-events-dialog";
import { CommandDetailDialog } from "./command-detail-dialog";
import { getErrorMessage } from "@/lib/http/error-message";
import { ActionButton, ButtonLink } from "@/components/action-button";
import { getDomainStatusLabel, getJobTypeLabel, getOperationTaskTitle } from "@/lib/i18n/domain-labels";
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

const riskTone: Record<string, StatusTone> = {
  high: "warning",
  critical: "danger",
};

function taskTypesOf(tasks: readonly OperationTask[]): string[] {
  return Array.from(new Set(tasks.map((task) => task.taskType).filter((value): value is string => Boolean(value))));
}

function getRefreshPath(
  statusFilter: string,
  taskTypeFilter: string,
  sort: string,
  awaitingApprovalOnly = false,
  needle = "",
) {
  const params = new URLSearchParams();
  if (awaitingApprovalOnly) {
    params.set("status", "pending");
    params.set("awaitingApproval", "1");
  } else if (statusFilter === "attention") {
    params.set("status", "failed,running,pending");
  } else if (statusFilter !== "all") {
    params.set("status", statusFilter);
  }
  if (taskTypeFilter !== "all") params.set("taskType", taskTypeFilter);
  if (sort !== "recent") params.set("sort", sort);
  const trimmed = needle.trim();
  if (trimmed) params.set("q", trimmed);
  const query = params.toString();
  return `/api/operation-tasks${query ? `?${query}` : ""}`;
}

function getExportPath(
  statusFilter: string,
  taskTypeFilter: string,
  sort: string,
  needle = "",
  awaitingApprovalOnly = false,
) {
  const path = getRefreshPath(statusFilter, taskTypeFilter, sort, awaitingApprovalOnly, needle);
  return `${path}${path.includes("?") ? "&" : "?"}format=csv`;
}

type TaskRowProps = {
  task: OperationTask;
  t: (k: string, vars?: Record<string, string | number>) => string;
  locale: Locale;
  sourceLabels: Record<string, string>;
  canReadCommands: boolean;
  onViewEvents: (sourceId: string) => void;
  onInspectCommand: (task: OperationTask) => void;
  onRequestCancel: (task: OperationTask) => void;
};

const TaskRow = memo(function TaskRow({
  task,
  t,
  locale,
  sourceLabels,
  canReadCommands,
  onViewEvents,
  onInspectCommand,
  onRequestCancel,
}: TaskRowProps) {
  // Backup rows carry their type and are named by it, so the type is not repeated as a badge.
  const isBackup = task.source === "backup" && Boolean(task.taskType);
  const title = getOperationTaskTitle(t, task);
  // The progress is on the line under the title already: a log that only repeated it ("最近日志 100%") is left out.
  const progress = task.progress?.trim();
  const logLines = (task.logPreview ?? []).filter((line) => line !== progress);
  const meta = [formatDateTime(task.createdAt, locale), task.actor, progress].filter(Boolean).join(" · ");
  const isAwaitingApproval = task.rawStatus === "PENDING_APPROVAL";
  const statusLabel = isAwaitingApproval
    ? getDomainStatusLabel(t, "PENDING_APPROVAL")
    : getDomainStatusLabel(t, task.status);
  const commandId =
    task.commandRequestId ??
    (task.source === "command" || task.source === "scheduled" ? task.sourceId : null);
  const showInspect = Boolean(
    commandId && (task.canInspectCommand ?? (canReadCommands && (task.source === "command" || task.source === "scheduled"))),
  );
  const showRerun = Boolean(commandId && task.canRerunCommand);
  const showCancel = Boolean(commandId && task.canCancelCommand);

  return (
    <ListRow className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{sourceLabels[task.source] ?? task.source}</Badge>
          <StatusBadge tone={statusTone[task.status] ?? "neutral"}>{statusLabel}</StatusBadge>
          {task.riskLevel && riskTone[task.riskLevel] ? (
            <StatusBadge tone={riskTone[task.riskLevel]!}>{task.riskLevel}</StatusBadge>
          ) : null}
          {task.taskType && !isBackup && <Badge>{getJobTypeLabel(t, task.taskType)}</Badge>}
          {task.foldedCount && task.foldedCount > 1 && <Badge tone="accent">{t("operationTasksPage.folded", { count: task.foldedCount })}</Badge>}
          {task.workerId && (
            <StatusBadge
              tone="info"
              title={
                task.workerHeartbeatAt
                  ? t("operationTasksPage.worker.heartbeat", { time: formatDateTime(task.workerHeartbeatAt, locale) })
                  : t("operationTasksPage.worker.noHeartbeat")
              }
            >
              {t("operationTasksPage.worker.label", { id: task.workerId })}
            </StatusBadge>
          )}
        </div>
        <h3 className="ui-title-group mt-2 truncate">{title}</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{meta}</p>
        {task.targetEvidence?.map((target) => (
          <div key={target.id} className="mt-2 text-xs text-[var(--text-muted)]">
            <span className="break-all font-medium">{target.label}</span>
            <ExecutionEvidence target={target} translate={t} />
            {target.succeededAt && (
              <p>{t("serverOverviewDetails.success.command")} · {formatDateTime(target.succeededAt, locale)}</p>
            )}
          </div>
        ))}
        {logLines.length > 0 && (
          <div aria-label={t("operationTasksPage.recentLogsAria", { title })} data-inset className="mt-3 px-3 py-2">
            <div className="text-xs font-medium text-[var(--text-muted)]">{t("operationTasksPage.logs.recent")}</div>
            <ul className="mt-2 space-y-1 text-xs text-[var(--text-secondary)]">
              {logLines.map((line, index) => <li key={`${task.id}-log-${index}`} className="break-words font-mono">{line}</li>)}
            </ul>
          </div>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-3 sm:flex-col sm:items-end sm:gap-2">
        {task.source === "job" && task.eventCount && task.eventCount > 0 ? (
          <button
            type="button"
            onClick={() => onViewEvents(task.sourceId)}
            className="text-xs font-medium text-[var(--accent)] hover:opacity-80"
          >
            {t("operationTasksPage.task.viewEvents", { count: task.eventCount })}
          </button>
        ) : null}
        {showInspect ? (
          <button
            type="button"
            onClick={() => onInspectCommand(task)}
            className="text-xs font-medium text-[var(--accent)] hover:opacity-80"
          >
            {t("operationTasksPage.task.inspectOutput")}
          </button>
        ) : null}
        {showRerun ? (
          <Link
            href={directCommandHref({ fromRequestId: commandId! })}
            className="text-xs font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            {t("operationTasksPage.task.rerun")}
          </Link>
        ) : null}
        {showCancel ? (
          <button
            type="button"
            onClick={() => onRequestCancel(task)}
            className="text-xs font-medium text-[var(--danger)] hover:opacity-80"
          >
            {t("operationTasksPage.task.cancel")}
          </button>
        ) : null}
        {task.href && (
          <Link
            href={task.href}
            className="text-xs font-medium text-[var(--accent)] hover:text-[var(--text-secondary)]"
          >
            {t("operationTasksPage.task.viewSource")}
          </Link>
        )}
      </div>
    </ListRow>
  );
}, (prev, next) =>
  prev.task === next.task &&
  prev.t === next.t &&
  prev.locale === next.locale &&
  prev.sourceLabels === next.sourceLabels &&
  prev.canReadCommands === next.canReadCommands &&
  prev.onViewEvents === next.onViewEvents &&
  prev.onInspectCommand === next.onInspectCommand &&
  prev.onRequestCancel === next.onRequestCancel);

export function OperationTaskListClient({
  initialTasks,
  initialSourceSummary = [],
  initialFailureSummary = [],
  canCreateCommands = false,
  canReadCommands = false,
  canReadDeployments = false,
  canReadBackups = false,
  canReadDownloads = false,
}: {
  initialTasks: OperationTask[];
  initialSourceSummary?: OperationTaskSourceSummary[];
  initialFailureSummary?: OperationTaskFailureSummary[];
  canCreateCommands?: boolean;
  canReadCommands?: boolean;
  canReadDeployments?: boolean;
  canReadBackups?: boolean;
  canReadDownloads?: boolean;
}) {
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
  const { state: urlState, setField: setUrlField, patch: setUrlFields } = useUrlQueryState({
    status: "all",
    type: "all",
    sort: "recent",
    q: "",
    task: "",
    awaitingApproval: "",
  });
  const statusFilter = (urlState.status || "all") as (typeof statusFilters)[number]["value"];
  const awaitingApprovalOnly = urlState.awaitingApproval === "1" || urlState.awaitingApproval === "true";
  const setStatusFilter = (value: (typeof statusFilters)[number]["value"]) =>
    setUrlFields({ status: value, awaitingApproval: "" });
  const taskTypeFilter = urlState.type || "all";
  const setTaskTypeFilter = (value: string) => setUrlField("type", value);
  const sort = (urlState.sort || "recent") as (typeof sortOptions)[number]["value"];
  const setSort = (value: (typeof sortOptions)[number]["value"]) => setUrlField("sort", value);
  const needle = urlState.q || "";
  const setNeedle = (value: string) => setUrlField("q", value);
  const [debouncedNeedle, setDebouncedNeedle] = useState(needle);
  useEffect(() => {
    const trimmed = needle.trim();
    if (trimmed === debouncedNeedle.trim()) return;
    const timer = setTimeout(() => setDebouncedNeedle(trimmed), 250);
    return () => clearTimeout(timer);
  }, [needle, debouncedNeedle]);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inspectedCommand, setInspectedCommand] = useState<{ id: string; canCancel: boolean } | null>(null);
  const [cancelTarget, setCancelTarget] = useState<OperationTask | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const eventsJobId = urlState.task ? urlState.task.replace(/^job:/, "") : null;
  const closeEventsDialog = useCallback(() => {
    setUrlField("task", "");
  }, [setUrlField]);
  const handleViewEvents = useCallback((sourceId: string) => {
    setUrlField("task", `job:${sourceId}`);
  }, [setUrlField]);
  const handleInspectCommand = useCallback((task: OperationTask) => {
    const id = task.commandRequestId ?? task.sourceId;
    setInspectedCommand({ id, canCancel: Boolean(task.canCancelCommand) });
  }, []);
  const handleRequestCancel = useCallback((task: OperationTask) => {
    setCancelTarget(task);
  }, []);

  // Every type seen since the page opened, and the one in the address: the list on screen holds only the
  // chosen type once a type is chosen, and the select then offered nothing else to switch to.
  const [seenTaskTypes, setSeenTaskTypes] = useState<string[]>(() => taskTypesOf(initialTasks));
  const taskTypeOptions = useMemo(
    () => Array.from(new Set([...seenTaskTypes, ...(taskTypeFilter !== "all" ? [taskTypeFilter] : [])])).sort(),
    [seenTaskTypes, taskTypeFilter],
  );
  const needleNorm = needle.trim().toLowerCase();
  const visibleTasks = useMemo(
    () =>
      tasks.filter((task) => {
        if (awaitingApprovalOnly && task.rawStatus !== "PENDING_APPROVAL") return false;
        if (!needleNorm) return true;
        return (
          task.title.toLowerCase().includes(needleNorm) ||
          getOperationTaskTitle(t, task).toLowerCase().includes(needleNorm) ||
          (task.actor ?? "").toLowerCase().includes(needleNorm) ||
          (task.taskType ?? "").toLowerCase().includes(needleNorm) ||
          task.source.toLowerCase().includes(needleNorm) ||
          (sourceLabels[task.source] ?? "").toLowerCase().includes(needleNorm) ||
          task.sourceId.toLowerCase().includes(needleNorm) ||
          (task.progress ?? "").toLowerCase().includes(needleNorm) ||
          (task.targetEvidence ?? []).some((target) => target.label.toLowerCase().includes(needleNorm))
        );
      }),
    [tasks, needleNorm, awaitingApprovalOnly, sourceLabels, t],
  );

  const refreshSequenceRef = useRef(0);
  const refreshAbortRef = useRef<AbortController | null>(null);
  const queryKey = debouncedNeedle.trim();
  const filterKey = `${statusFilter}:${taskTypeFilter}:${sort}:${awaitingApprovalOnly ? "1" : "0"}:${queryKey}`;
  const refresh = useCallback(async (queryOverride?: string) => {
    refreshAbortRef.current?.abort();
    const controller = new AbortController();
    refreshAbortRef.current = controller;
    const refreshSequence = ++refreshSequenceRef.current;
    const activeQuery = (queryOverride ?? queryKey).trim();
    const requestFilterKey = `${statusFilter}:${taskTypeFilter}:${sort}:${awaitingApprovalOnly ? "1" : "0"}:${activeQuery}`;
    setRefreshing(true);
    setError(null);
    try {
      const data = await csrfFetch<Partial<OperationTaskListResult>>(
        getRefreshPath(statusFilter, taskTypeFilter, sort, awaitingApprovalOnly, activeQuery),
        { signal: controller.signal },
      );
      if (
        refreshSequence !== refreshSequenceRef.current ||
        (queryOverride === undefined && requestFilterKey !== filterKey)
      ) {
        return;
      }
      setTasks(data.tasks ?? []);
      setSeenTaskTypes((seen) => {
        const added = taskTypesOf(data.tasks ?? []).filter((taskType) => !seen.includes(taskType));
        return added.length > 0 ? [...seen, ...added] : seen;
      });
      setSourceSummary(data.sourceSummary ?? []);
      setFailureSummary(data.failureSummary ?? []);
    } catch (err) {
      if (controller.signal.aborted || refreshSequence !== refreshSequenceRef.current) return;
      setError(getErrorMessage(err, t("operationTasks.refreshFailed")));
    } finally {
      if (refreshSequence === refreshSequenceRef.current) setRefreshing(false);
    }
  }, [statusFilter, taskTypeFilter, sort, awaitingApprovalOnly, queryKey, filterKey, t]);

  // Apply URL deep-link / non-default filter changes without requiring Apply.
  // Skip the first paint when filters are still the SSR defaults to keep initialTasks
  // and avoid a redundant fetch that races tests/mocks.
  const didSkipDefaultRefreshRef = useRef(false);
  useEffect(() => {
    const isDefault =
      statusFilter === "all" && taskTypeFilter === "all" && sort === "recent" && !awaitingApprovalOnly && !queryKey;
    if (!didSkipDefaultRefreshRef.current) {
      didSkipDefaultRefreshRef.current = true;
      if (isDefault) return;
    }
    void refresh();
  }, [refresh, statusFilter, taskTypeFilter, sort, awaitingApprovalOnly, queryKey]);

  useEffect(() => () => {
    refreshAbortRef.current?.abort();
  }, []);

  const hasInFlightTasks = tasks.some((task) => task.status === "running" || task.status === "pending");
  useVisibilityInterval(() => {
    void refresh();
  }, hasInFlightTasks ? 10_000 : null);

  const sliceCounts = tasks.reduce<Record<OperationTaskStatus, number>>(
    (acc, task) => {
      acc[task.status] = (acc[task.status] ?? 0) + 1;
      return acc;
    },
    {} as Record<OperationTaskStatus, number>,
  );
  const awaitingApprovalCount = tasks.filter((task) => task.rawStatus === "PENDING_APPROVAL").length;
  const totalFailures = failureSummary.reduce((total, item) => total + item.total, 0);

  const handleConfirmCancel = async () => {
    if (!cancelTarget || cancelling) return;
    const commandRequestId = cancelTarget.commandRequestId ?? cancelTarget.sourceId;
    setCancelling(true);
    setError(null);
    try {
      await csrfFetch("/api/commands", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel", commandRequestId }),
      });
      setCancelTarget(null);
      await refresh();
    } catch (err) {
      setError(getErrorMessage(err, t("operationTasksPage.task.cancelFailed")));
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  };

  const quickPills = [
    {
      id: "all",
      label: t("operationTasks.filter.all"),
      count: tasks.length,
      active: !awaitingApprovalOnly && statusFilter === "all",
      onClick: () => setUrlFields({ status: "all", awaitingApproval: "" }),
    },
    {
      id: "running",
      label: t("operationTasks.filter.running"),
      count: sliceCounts.running ?? 0,
      active: !awaitingApprovalOnly && statusFilter === "running",
      onClick: () => setUrlFields({ status: "running", awaitingApproval: "" }),
    },
    {
      id: "awaiting_approval",
      label: t("operationTasksPage.filter.awaitingApproval"),
      count: awaitingApprovalCount,
      active: awaitingApprovalOnly,
      onClick: () => setUrlFields({ status: "pending", awaitingApproval: "1" }),
    },
    {
      id: "failed",
      label: t("operationTasks.filter.failed"),
      count: sliceCounts.failed ?? 0,
      active: !awaitingApprovalOnly && statusFilter === "failed",
      onClick: () => setUrlFields({ status: "failed", awaitingApproval: "" }),
    },
  ];

  return (
    <div className="flex flex-col gap-5">
      {error && <Notice tone="danger">{error}</Notice>}

      {/* Compact clickable status pills keep the runs list immediately above the fold */}
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label={t("operationTasksPage.recentTasks")}>
        {quickPills.map((pill) => (
          <button
            key={pill.id}
            type="button"
            aria-pressed={pill.active}
            onClick={pill.onClick}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              pill.active
                ? "border-[var(--accent-border)] bg-[var(--accent-soft)] text-[var(--accent)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-secondary)] hover:bg-[var(--surface-subtle)] hover:text-[var(--text-primary)]",
            )}
          >
            <span>{pill.label}</span>
            <span className="rounded-full bg-[var(--surface-subtle)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--text-muted)]">
              {pill.count}
            </span>
          </button>
        ))}
      </div>

      <Toolbar className="mb-0 flex-col items-stretch gap-3 sm:flex-row sm:flex-wrap sm:items-end">
        <label className="ui-label flex-1 sm:min-w-48 sm:max-w-xs">
          <span className="mb-1 block">{t("operationTasksPage.filter.search")}</span>
          <input
            type="search"
            value={needle}
            onChange={(event) => setNeedle(event.target.value)}
            placeholder={t("operationTasksPage.filter.searchPlaceholder")}
            aria-label={t("operationTasksPage.filter.search")}
            className={`${CONTROL_CLASS} w-full`}
          />
        </label>
        <label className="ui-label">
          <span className="mb-1 block">{t("operationTasksPage.filter.status")}</span>
          <select
            data-input
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)}
            className={`${CONTROL_CLASS} w-full sm:w-auto sm:min-w-32`}
          >
            {statusFilters.map((filter) => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
          </select>
        </label>
        <label className="ui-label">
          <span className="mb-1 block">{t("operationTasksPage.filter.taskType")}</span>
          <select
            data-input
            value={taskTypeFilter}
            onChange={(event) => setTaskTypeFilter(event.target.value)}
            className={`${CONTROL_CLASS} w-full sm:w-auto sm:min-w-44`}
          >
            <option value="all">{t("operationTasksPage.filter.allTypes")}</option>
            {taskTypeOptions.map((taskType) => <option key={taskType} value={taskType}>{getJobTypeLabel(t, taskType)}</option>)}
          </select>
        </label>
        <label className="ui-label">
          <span className="mb-1 block">{t("operationTasksPage.filter.sort")}</span>
          <select
            data-input
            value={sort}
            onChange={(event) => setSort(event.target.value as typeof sort)}
            className={`${CONTROL_CLASS} w-full sm:w-auto sm:min-w-36`}
          >
            {sortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <ActionButton size="sm" variant="secondary" onClick={() => void refresh(needle)} disabled={refreshing}>
            {refreshing ? t("operationTasks.action.refreshing") : t("operationTasks.action.refresh")}
          </ActionButton>
          <a
            href={getExportPath(statusFilter, taskTypeFilter, sort, needle, awaitingApprovalOnly)}
            data-action-button
            data-size="sm"
            data-variant="secondary"
          >
            {t("operationTasksPage.export.csv")}
          </a>
        </div>
      </Toolbar>

      <ListPanel
        title={t("operationTasksPage.recentTasks")}
        description={t("operationTasksPage.recentTasksHint")}
        count={visibleTasks.length}
        empty={visibleTasks.length === 0 ? (
          <EmptyState
            text={needleNorm ? t("operationTasksPage.filter.noMatch") : t("operationTasks.tasks.empty")}
            action={needleNorm ? (
              <ActionButton size="sm" variant="secondary" onClick={() => setNeedle("")}>{t("common.clearSearch")}</ActionButton>
            ) : (canCreateCommands || canReadDeployments || canReadBackups || canReadDownloads) ? (
              <div className="flex flex-wrap justify-center gap-2">
                {canCreateCommands ? <ButtonLink href="/commands" size="xs" variant="primary">{t("operationTasksPage.action.runCommand")}</ButtonLink> : null}
                {canReadDeployments ? <ButtonLink href="/deployments" size="xs" variant="secondary">{t("operationTasksPage.source.deployment")}</ButtonLink> : null}
                {canReadBackups ? <ButtonLink href="/backups" size="xs" variant="secondary">{t("operationTasksPage.source.backup")}</ButtonLink> : null}
                {canReadDownloads ? <ButtonLink href="/downloads" size="xs" variant="secondary">{t("operationTasksPage.source.download")}</ButtonLink> : null}
              </div>
            ) : undefined}
          />
        ) : undefined}
      >
        {/* The panel body divides its children; the rows sit one level down inside the pager. */}
        <PaginatedList pageSize={TASKS_PER_PAGE} resetKey={`${filterKey}:${needleNorm}`} className="divide-y divide-[var(--border-subtle)]">
          {visibleTasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              t={t}
              locale={locale}
              sourceLabels={sourceLabels}
              canReadCommands={canReadCommands}
              onViewEvents={handleViewEvents}
              onInspectCommand={handleInspectCommand}
              onRequestCancel={handleRequestCancel}
            />
          ))}
        </PaginatedList>
      </ListPanel>

      {/* Collapsible Insights keeps source and failure breakdowns accessible without burying the task list */}
      <details data-card="" className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-medium text-[var(--text-primary)]">
          <span>{t("operationTasksPage.insights.toggle")}</span>
          <span className="text-xs font-normal text-[var(--text-muted)]">
            {t("operationTasksPage.insights.summary", { sources: sourceSummary.length, failures: totalFailures })}
          </span>
        </summary>
        <div className="space-y-4 border-t border-[var(--border-subtle)] p-4">
          <section aria-label={t("operationTasks.summary.sourceGroup")}>
            <SurfacePanel
              title={t("operationTasks.summary.sourceGroup")}
              description={t("operationTasks.summary.sourceGroupDesc")}
              actions={<span className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.summary.totalCount", { count: tasks.length })}</span>}
            >
              {sourceSummary.length === 0 ? (
                <p className="mt-3 text-sm text-[var(--text-muted)]">{t("operationTasks.summary.noSources")}</p>
              ) : (
                <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {sourceSummary.map((item) => (
                    <div key={item.source} data-inset className="px-3 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-[var(--text-primary)]">{sourceLabels[item.source] ?? item.source}</span>
                        <span className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.summary.grandTotal", { count: item.total })}</span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs text-[var(--text-secondary)]">
                        <span>{t("operationTasksPage.summary.needProcess", { count: item.attention })}</span>
                        <span>{t("operationTasksPage.summary.failed", { count: item.failed })}</span>
                        <span>{t("operationTasksPage.summary.running", { count: item.running })}</span>
                        <span>{t("operationTasksPage.summary.pending", { count: item.pending })}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SurfacePanel>
          </section>
          {failureSummary.length > 0 && (
            <section data-card="" aria-label={t("operationTasks.summary.failureGroup")} className="p-4">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <h2 className="ui-title-section">{t("operationTasks.summary.failureGroup")}</h2>
                  <p className="mt-1 text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.desc")}</p>
                </div>
                <div className="text-xs text-[var(--text-muted)]">{t("operationTasksPage.failures.totalCount", { count: totalFailures })}</div>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {failureSummary.map((item) => (
                  <div data-inset="" key={item.reason} className="px-3 py-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-[var(--text-primary)]">{item.reason}</span>
                      <StatusBadge tone="danger">{t("operationTasksPage.failures.itemCount", { count: item.total })}</StatusBadge>
                    </div>
                    <p className="mt-2 text-xs text-[var(--text-muted)]">
                      {t("operationTasksPage.failures.sourceAndLatest", {
                        sources: item.sources.map((source) => sourceLabels[source] ?? source).join(t("common.listSeparator")),
                        title: getOperationTaskTitle(t, { source: item.latestTaskId.split(":")[0] ?? "", title: item.latestTitle }),
                      })}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </details>

      <JobEventsDialog jobId={eventsJobId} open={eventsJobId !== null} onClose={closeEventsDialog} />
      <CommandDetailDialog
        commandRequestId={inspectedCommand?.id ?? null}
        open={inspectedCommand !== null}
        onClose={() => setInspectedCommand(null)}
        canCreateCommands={canCreateCommands}
        canCancel={inspectedCommand?.canCancel ?? false}
        onCancelled={() => void refresh()}
      />
      <ConfirmDialog
        open={cancelTarget !== null}
        title={t("operationTasksPage.task.cancelConfirmTitle")}
        description={
          cancelTarget
            ? t("operationTasksPage.task.cancelConfirmDesc", { title: getOperationTaskTitle(t, cancelTarget) })
            : undefined
        }
        cancelLabel={t("common.cancel")}
        confirmLabel={t("operationTasksPage.task.cancel")}
        confirmVariant="danger-solid"
        busy={cancelling}
        onCancel={() => setCancelTarget(null)}
        onConfirm={() => void handleConfirmCancel()}
      />
    </div>
  );
}
