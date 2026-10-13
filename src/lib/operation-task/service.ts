import { CommandRequestStatus, DownloadTaskStatus, JobStatus, Prisma, SyncJobStatus, type Job } from "@prisma/client";

import { teamWhere } from "@/lib/auth/team-scope";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { actorName } from "@/lib/ticket/timeline";
import { prisma } from "@/lib/db";
import { getOperationTaskListLimit } from "@/lib/runtime-settings/service";
import { serviceT } from "@/lib/i18n/service-locale";

// TR-039: pure DTO types live in ./dto so client code can reach them
// without pulling the whole server-only service module. We import them
// for in-file use AND re-export them so every existing call site
// 'from "@/lib/operation-task/service"' keeps working.
import type {
  OperationTask,
  OperationTaskFailureSummary,
  OperationTaskListFilters,
  OperationTaskListOptions,
  OperationTaskListResult,
  OperationTaskListSort,
  OperationTaskSource,
  OperationTaskSourceSummary,
  OperationTaskStatus,
} from "./dto";

export type { OperationTaskListOptions, OperationTaskListResult, OperationTaskStatus };

type JobTaskRow = Job & {
  creator?: { username: string; displayName: string | null } | null;
  _count?: { events: number };
};
// Output columns are deliberately NOT selected here: stdout/stderr are capped
// at 256 KB each by the command output limit, and a page of 200 requests used
// to drag ~200 MB out of Postgres for a three-line preview. The bounded tails
// are fetched separately by `fetchTargetOutputTails`.
type CommandTaskRow = Prisma.CommandRequestGetPayload<{ include: { requester: { select: { username: true; displayName: true } }; targets: { select: { id: true; status: true; finishedAt: true; startedAt: true }; take: 2; orderBy: { finishedAt: "desc" } }; executionLogs: { select: { summary: true; createdAt: true }; take: 2; orderBy: { createdAt: "desc" } }; scheduledTaskRuns: { select: { scheduledTask: { select: { name: true } } }; take: 1 } } }>;
type DownloadTaskRow = Prisma.DownloadTaskGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type SyncJobTaskRow = Prisma.SyncJobGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type BackupTaskRow = Prisma.BackupRecordGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type DeploymentTaskRow = Prisma.DeploymentRunGetPayload<{ include: { creator: { select: { username: true; displayName: true } }; template: { select: { name: true } }; commandRequest: { select: { status: true; workerId: true; workerHeartbeatAt: true; updatedAt: true } } } }>;

function toIso(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : new Date(0).toISOString();
}

const RAW_STATUS_GROUPS: Array<[OperationTaskStatus, readonly string[]]> = [
  ["running", ["RUNNING", "CANCELLING", "ACTIVE", "IN_PROGRESS", "APPROVED"]],
  ["completed", ["COMPLETED", "IDLE"]],
  // SyncJob ERROR is a failed run (it used to fall through to "pending").
  ["failed", ["FAILED", "REJECTED", "EXPIRED", "ERROR"]],
  ["cancelled", ["CANCELLED", "DISABLED"]],
  ["paused", ["PAUSED"]],
];
/** Every raw status with an explicit mapping; anything else is "pending". */
const KNOWN_RAW_STATUSES = RAW_STATUS_GROUPS.flatMap(([, raw]) => raw);

export function mapOperationStatus(status: string): OperationTaskStatus {
  for (const [mapped, raw] of RAW_STATUS_GROUPS) if (raw.includes(status)) return mapped;
  return "pending";
}

type WhereClause = Record<string, unknown>;

/**
 * The inverse of {@link mapOperationStatus} for one source's `status` column,
 * so the requested statuses are filtered in the database before `take`.
 * Enum columns list their values; free-text columns are open-ended, where
 * "pending" also means "any value without an explicit mapping". Returns null
 * when no row of this source can match.
 */
function rawStatusWhere(
  statuses: ReadonlySet<OperationTaskStatus>,
  candidates: readonly string[],
  openEnded: boolean,
  field = "status",
): WhereClause | null {
  const included = candidates.filter((value) => statuses.has(mapOperationStatus(value)));
  const clauses: WhereClause[] = included.length ? [{ [field]: { in: included } }] : [];
  if (openEnded && statuses.has("pending")) clauses.push({ [field]: { notIn: KNOWN_RAW_STATUSES } });
  if (clauses.length === 0) return null;
  return clauses.length === 1 ? clauses[0]! : { OR: clauses };
}

/** syncJobOperationStatus, inverted: IDLE is "pending" until the first run. */
function syncStatusWhere(statuses: ReadonlySet<OperationTaskStatus>): WhereClause | null {
  const clauses: WhereClause[] = [];
  const nonIdle = Object.values(SyncJobStatus).filter((value) => value !== "IDLE" && statuses.has(mapOperationStatus(value)));
  if (nonIdle.length) clauses.push({ status: { in: nonIdle } });
  if (statuses.has("pending")) clauses.push({ status: "IDLE", lastSyncAt: null });
  if (statuses.has("completed")) clauses.push({ status: "IDLE", lastSyncAt: { not: null } });
  return clauses.length ? { OR: clauses } : null;
}

/** resolveDeploymentOperationStatus, inverted: a linked command's status wins. */
function deploymentStatusWhere(statuses: ReadonlySet<OperationTaskStatus>): WhereClause | null {
  const commandStatuses = Object.values(CommandRequestStatus).filter((value) =>
    value === "PENDING_APPROVAL" ? statuses.has("pending") : statuses.has(mapOperationStatus(value)),
  );
  const ownStatus = rawStatusWhere(statuses, KNOWN_RAW_STATUSES, true);
  const clauses: WhereClause[] = [];
  if (ownStatus) clauses.push({ commandRequestId: null, ...ownStatus });
  if (commandStatuses.length) clauses.push({ commandRequest: { status: { in: commandStatuses } } });
  return clauses.length ? { OR: clauses } : null;
}

/**
 * A command a schedule dispatched is that schedule's execution: list it under
 * the schedule's name rather than as an anonymous command, and never list the
 * schedule definition itself (an enabled schedule is not a running task).
 */
function commandTaskOrigin(item: CommandTaskRow) {
  const schedule = item.scheduledTaskRuns?.[0]?.scheduledTask;
  return schedule
    ? { id: `scheduled:${item.id}`, source: "scheduled" as const, title: schedule.name, href: "/scheduled-tasks" }
    : { id: `command:${item.id}`, source: "command" as const, title: item.title, href: "/requests" };
}

/** A sync job that has never run has no outcome yet; IDLE alone is not "completed". */
function syncJobOperationStatus(item: Pick<SyncJobTaskRow, "status" | "lastSyncAt">): OperationTaskStatus {
  if (item.status === "IDLE" && !item.lastSyncAt) return "pending";
  return mapOperationStatus(item.status);
}

function resolveDeploymentOperationStatus(item: DeploymentTaskRow): OperationTaskStatus {
  const commandStatus = item.commandRequest?.status;
  if (!commandStatus) return mapOperationStatus(item.status);
  if (commandStatus === "PENDING_APPROVAL") return "pending";
  return mapOperationStatus(commandStatus);
}

function formatWorkerProgress(input: { workerId?: string | null; workerHeartbeatAt?: Date | string | null; updatedAt?: Date | string | null }) {
  if (!input.workerId && !input.workerHeartbeatAt) return null;
  const heartbeat = input.workerHeartbeatAt ?? input.updatedAt;
  const heartbeatText = heartbeat ? `heartbeat ${new Date(heartbeat).toISOString()}` : "heartbeat unknown";
  return `backend executor ${input.workerId ?? "unknown"} · ${heartbeatText}`;
}

/**
 * Characters of stdout/stderr kept per target for the list preview. The list
 * shows the last three trimmed lines capped at 180 chars each, so ~1 KB of tail
 * is plenty while still being 250× smaller than a full output column.
 */
const COMMAND_OUTPUT_TAIL_CHARS = 1_024;

type OutputTail = { stdout: string | null; stderr: string | null };

/**
 * Bounded tails of command output for the task list.
 *
 * Selecting `stdout`/`stderr` inline meant every list load transferred up to
 * 256 KB × 2 columns × 2 targets per request row — tens of MB per page for a
 * three-line preview. `right()` trims the transfer in SQL without a schema
 * change. Best effort by design: if the raw read is unavailable the preview
 * simply falls back to execution logs and worker progress.
 */
async function fetchTargetOutputTails(ids: string[]): Promise<Map<string, OutputTail>> {
  const tails = new Map<string, OutputTail>();
  if (ids.length === 0) return tails;
  try {
    const rows = await prisma.$queryRaw<Array<{ id: string; stdout: string | null; stderr: string | null }>>(
      Prisma.sql`
        SELECT id,
               right(coalesce(stdout, ''), ${COMMAND_OUTPUT_TAIL_CHARS}::int) AS stdout,
               right(coalesce(stderr, ''), ${COMMAND_OUTPUT_TAIL_CHARS}::int) AS stderr
        FROM command_targets
        WHERE id = ANY(${ids}::text[])
      `,
    );
    for (const row of rows) tails.set(row.id, { stdout: row.stdout, stderr: row.stderr });
  } catch {
    // Preview enrichment only — never fail the whole list over it.
  }
  return tails;
}

function compactLogPreview(parts: Array<string | null | undefined>) {
  return parts
    .flatMap((part) => String(part ?? "").split(/\r?\n/))
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-3)
    .map((line) => line.length > 180 ? `${line.slice(0, 177)}...` : line);
}

const FOLDABLE_COMPLETED_JOB_TYPES = new Set(["alert.evaluate"]);

function foldCompletedPeriodicJobs(tasks: OperationTask[]) {
  const folded = new Map<string, OperationTask>();
  const visible: OperationTask[] = [];

  for (const task of tasks) {
    if (task.source !== "job" || task.status !== "completed" || !task.taskType || !FOLDABLE_COMPLETED_JOB_TYPES.has(task.taskType)) {
      visible.push(task);
      continue;
    }

    const existing = folded.get(task.taskType);
    if (!existing) {
      const representative = { ...task, foldedCount: 1 };
      folded.set(task.taskType, representative);
      visible.push(representative);
      continue;
    }

    existing.foldedCount = (existing.foldedCount ?? 1) + 1;
    if (new Date(task.createdAt).getTime() > new Date(existing.createdAt).getTime()) {
      existing.id = task.id;
      existing.sourceId = task.sourceId;
      existing.title = task.title;
      existing.createdAt = task.createdAt;
      existing.updatedAt = task.updatedAt;
      existing.actor = task.actor;
      existing.progress = task.progress;
      existing.logPreview = task.logPreview;
      existing.href = task.href;
      existing.workerId = task.workerId;
      existing.workerHeartbeatAt = task.workerHeartbeatAt;
    }
  }

  return visible;
}

function normalizeStatusFilter(status: OperationTaskListFilters["status"]) {
  if (!status) return null;
  return new Set(Array.isArray(status) ? status : [status]);
}

function normalizeTaskTypeFilter(taskType: string | undefined) {
  const value = taskType?.trim();
  return value ? value : null;
}

function filterOperationTasks(tasks: OperationTask[], filters: OperationTaskListFilters) {
  const statuses = normalizeStatusFilter(filters.status);
  const taskType = normalizeTaskTypeFilter(filters.taskType);
  return tasks.filter((task) => {
    if (statuses && !statuses.has(task.status)) return false;
    if (taskType && task.taskType !== taskType) return false;
    return true;
  });
}

const attentionRank: Partial<Record<OperationTaskStatus, number>> = { failed: 0, running: 1, pending: 2 };

function sortOperationTasks(tasks: OperationTask[], sort: OperationTaskListSort | undefined) {
  return tasks.sort((a, b) => {
    if (sort === "attention") {
      const rankA = attentionRank[a.status] ?? 3;
      const rankB = attentionRank[b.status] ?? 3;
      if (rankA !== rankB) return rankA - rankB;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function summarizeOperationTaskSources(tasks: OperationTask[]): OperationTaskSourceSummary[] {
  const summary = new Map<OperationTaskSource, OperationTaskSourceSummary>();
  for (const task of tasks) {
    const item = summary.get(task.source) ?? { source: task.source, total: 0, attention: 0, failed: 0, running: 0, pending: 0 };
    item.total += 1;
    if (task.status === "failed") item.failed += 1;
    if (task.status === "running") item.running += 1;
    if (task.status === "pending") item.pending += 1;
    if (["failed", "running", "pending"].includes(task.status)) item.attention += 1;
    summary.set(task.source, item);
  }
  return Array.from(summary.values()).sort((a, b) => b.attention - a.attention || b.total - a.total || a.source.localeCompare(b.source));
}

function normalizeFailureReason(task: OperationTask, t: (key: string, vars?: Record<string, string | number>) => string) {
  const text = `${task.title} ${task.progress ?? ""}`.toLowerCase();
  if (/permission|denied|forbidden|unauthorized|401|403|权限|拒绝/.test(text)) return t("backend.operationTask.failure.authOrPermission");
  if (/timeout|timed out|超时|deadline/.test(text)) return t("backend.operationTask.failure.timeout");
  if (/no such file|not found|missing|不存在|未找到/.test(text)) return t("backend.operationTask.failure.fileOrResourceNotFound");
  if (/connect|network|econn|dns|socket|网络|连接/.test(text)) return t("backend.operationTask.failure.networkOrConnection");
  if (/smtp|email|mail|webhook|telegram|通知/.test(text)) return t("backend.operationTask.failure.notification");
  if (/backup|restore|备份|恢复/.test(text)) return t("backend.operationTask.failure.backupOrRestore");
  return task.taskType ? t("backend.operationTask.failure.taskTypeFailed", { taskType: task.taskType }) : t("backend.operationTask.failure.sourceFailed", { source: t(`backend.operationTask.source.${task.source}`) });
}

function summarizeOperationTaskFailures(tasks: OperationTask[], t: (key: string, vars?: Record<string, string | number>) => string): OperationTaskFailureSummary[] {
  const summary = new Map<string, OperationTaskFailureSummary & { sourceSet: Set<OperationTaskSource> }>();
  for (const task of tasks) {
    if (task.status !== "failed") continue;
    const reason = normalizeFailureReason(task, t);
    const existing = summary.get(reason);
    if (!existing) {
      summary.set(reason, { reason, total: 1, sourceSet: new Set([task.source]), sources: [task.source], latestTaskId: task.id, latestTitle: task.title, latestAt: task.updatedAt });
      continue;
    }
    existing.total += 1;
    existing.sourceSet.add(task.source);
    if (new Date(task.updatedAt).getTime() > new Date(existing.latestAt).getTime()) {
      existing.latestTaskId = task.id;
      existing.latestTitle = task.title;
      existing.latestAt = task.updatedAt;
    }
  }
  return Array.from(summary.values())
    .map(({ sourceSet, ...item }) => ({ ...item, sources: Array.from(sourceSet).sort() }))
    .sort((a, b) => b.total - a.total || new Date(b.latestAt).getTime() - new Date(a.latestAt).getTime() || a.reason.localeCompare(b.reason));
}

/**
 * Caller identity is required, not optional: every `where` below is built from it,
 * and a missing session collapsed the team scope to `{}` — i.e. every tenant's
 * jobs, commands, downloads, backups and deployments in one list. The only
 * callers were the HTTP route and the page (both pass a session) plus tests.
 */
export type OperationTaskSessionScope = {
  userId: string;
  roles: import("@/lib/auth/rbac").RoleKey[];
  currentTeamId: string | null;
};

export async function listOperationTaskResult(options: OperationTaskListOptions, session: OperationTaskSessionScope): Promise<OperationTaskListResult> {
  const configuredLimit = await getOperationTaskListLimit();
  const requestedLimit = options.limit ?? configuredLimit;
  // `Math.trunc` is not cosmetic: `limit` becomes Prisma `take`, which rejects a
  // fractional row count. Callers other than the HTTP route (which validates
  // `.int()`) pass this straight through.
  const limit = Math.trunc(
    Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : configuredLimit, 1), configuredLimit),
  );
  const teamScope = teamWhere(session);
  const canReadTeamTasks = sessionHasPermission(session, "team:manage");
  const scopedWhere = (ownerField: string): Record<string, unknown> => {
    if (canReadTeamTasks) return teamScope;
    return { AND: [teamScope, { [ownerField]: session.userId }] };
  };

  // Filters are pushed into every source query BEFORE `take`. Filtering the
  // merged newest-N rows afterwards (as before) hid an old RUNNING/FAILED task
  // behind any burst of newer ones. The in-memory filter below stays as the
  // authoritative check. With the "attention" sort and no status filter, the
  // attention rows of each source are fetched in addition to the newest rows
  // so a long-stuck task is still ranked first.
  const requestedStatuses = normalizeStatusFilter(options.status);
  const taskType = normalizeTaskTypeFilter(options.taskType);
  const attentionStatuses = new Set<OperationTaskStatus>(["failed", "running", "pending"]);
  const statusPasses: Array<ReadonlySet<OperationTaskStatus> | null> = requestedStatuses
    ? [requestedStatuses]
    : options.sort === "attention" ? [null, attentionStatuses] : [null];
  /** Run one source query per status pass and merge by id (newest first). */
  async function fetchSource<T extends { id: string; createdAt: Date }>(
    ownerField: string,
    statusWhere: (statuses: ReadonlySet<OperationTaskStatus>) => WhereClause | null,
    extraWhere: WhereClause | null,
    run: (where: WhereClause) => Promise<T[]>,
  ): Promise<T[]> {
    if (extraWhere === null) return [];
    const merged = new Map<string, T>();
    for (const statuses of statusPasses) {
      const status = statuses ? statusWhere(statuses) : {};
      if (status === null) continue;
      const parts = [scopedWhere(ownerField), status, extraWhere].filter((part) => Object.keys(part).length > 0);
      for (const row of await run(parts.length <= 1 ? (parts[0] ?? {}) : { AND: parts })) merged.set(row.id, row);
    }
    return [...merged.values()].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }
  // Only jobs and backups carry a task type; other sources cannot match one.
  const typedWhere = taskType ? { type: taskType } : {};
  const untypedWhere = taskType ? null : {};
  const [jobs, commands, downloads, syncJobs, backups, deployments] = await Promise.all([
    fetchSource("createdBy", (statuses) => rawStatusWhere(statuses, Object.values(JobStatus), false), typedWhere, (where) =>
      prisma.job.findMany({ where, take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } }, _count: { select: { events: true } } } })),
    fetchSource("requesterId", (statuses) => rawStatusWhere(statuses, Object.values(CommandRequestStatus), false), untypedWhere, (where) =>
      prisma.commandRequest.findMany({ where, take: limit, orderBy: { createdAt: "desc" }, include: { requester: { select: { username: true, displayName: true } }, targets: { take: 2, orderBy: { finishedAt: "desc" }, select: { id: true, status: true, finishedAt: true, startedAt: true } }, executionLogs: { take: 2, orderBy: { createdAt: "desc" }, select: { summary: true, createdAt: true } }, scheduledTaskRuns: { take: 1, select: { scheduledTask: { select: { name: true } } } } } })),
    fetchSource("createdBy", (statuses) => rawStatusWhere(statuses, Object.values(DownloadTaskStatus), false), untypedWhere, (where) =>
      prisma.downloadTask.findMany({ where, take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } })),
    fetchSource("createdBy", syncStatusWhere, untypedWhere, (where) =>
      prisma.syncJob.findMany({ where, take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } })),
    fetchSource("createdBy", (statuses) => rawStatusWhere(statuses, KNOWN_RAW_STATUSES, true), typedWhere, (where) =>
      prisma.backupRecord.findMany({ where, take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } })),
    fetchSource("createdBy", deploymentStatusWhere, untypedWhere, (where) =>
      prisma.deploymentRun.findMany({ where, take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } }, template: { select: { name: true } }, commandRequest: { select: { status: true, workerId: true, workerHeartbeatAt: true, updatedAt: true } } } })),
  ]);

  const targetOutputTails = await fetchTargetOutputTails(
    commands.flatMap((item) => (item.targets ?? []).map((target) => target.id)),
  );

  const tasks: OperationTask[] = [
    ...jobs.map((item: JobTaskRow) => ({ id: `job:${item.id}`, source: "job" as const, sourceId: item.id, title: item.title, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.progress ?? item.errorMessage, logPreview: compactLogPreview([item.progress, item.errorMessage]), workerId: item.workerId, workerHeartbeatAt: item.workerHeartbeatAt ? toIso(item.workerHeartbeatAt) : null, taskType: item.type, eventCount: item._count?.events ?? 0 })),
    ...commands.map((item: CommandTaskRow) => ({ ...commandTaskOrigin(item), sourceId: item.id, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.requester), progress: formatWorkerProgress(item), logPreview: compactLogPreview([(item.executionLogs ?? []).map((log) => log.summary).join("\n"), (item.targets ?? []).map((target) => { const tail = targetOutputTails.get(target.id); return [tail?.stdout, tail?.stderr].filter(Boolean).join("\n"); }).join("\n"), formatWorkerProgress(item)]), workerId: item.workerId, workerHeartbeatAt: item.workerHeartbeatAt ? toIso(item.workerHeartbeatAt) : null })),
    ...downloads.map((item: DownloadTaskRow) => ({ id: `download:${item.id}`, source: "download" as const, sourceId: item.id, title: item.fileName || item.url, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.progress, logPreview: compactLogPreview([item.progress, item.targetPath]), href: "/downloads" })),
    ...syncJobs.map((item: SyncJobTaskRow) => ({ id: `sync:${item.id}`, source: "sync" as const, sourceId: item.id, title: item.name, status: syncJobOperationStatus(item), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.lastSyncResult, logPreview: compactLogPreview([item.lastSyncResult]), href: "/files" })),
    ...backups.map((item: BackupTaskRow) => ({ id: `backup:${item.id}`, source: "backup" as const, sourceId: item.id, title: `${item.type} backup`, taskType: item.type, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.filePath, logPreview: compactLogPreview([item.filePath]), href: "/backups" })),
    ...deployments.map((item: DeploymentTaskRow) => ({ id: `deployment:${item.id}`, source: "deployment" as const, sourceId: item.id, title: item.template.name, status: resolveDeploymentOperationStatus(item), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.commandRequest ? formatWorkerProgress(item.commandRequest) : null, logPreview: compactLogPreview([item.commandRequest ? formatWorkerProgress(item.commandRequest) : null]), workerId: item.commandRequest?.workerId ?? null, workerHeartbeatAt: item.commandRequest?.workerHeartbeatAt ? toIso(item.commandRequest.workerHeartbeatAt) : null, href: "/deployments" })),
  ];

  const foldedTasks = foldCompletedPeriodicJobs(tasks);
  const filteredTasks = sortOperationTasks(filterOperationTasks(foldedTasks, options), options.sort)
    .slice(0, limit);
  const t = await serviceT();
  return {
    tasks: filteredTasks,
    sourceSummary: summarizeOperationTaskSources(filteredTasks),
    failureSummary: summarizeOperationTaskFailures(filteredTasks, t),
  };
}
