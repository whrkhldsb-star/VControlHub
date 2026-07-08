import { Prisma, type Job } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getOperationTaskListLimit } from "@/lib/runtime-settings/service";
import { serverT } from "@/lib/i18n/server-locale";

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

export type {
  OperationTask,
  OperationTaskFailureSummary,
  OperationTaskListFilters,
  OperationTaskListOptions,
  OperationTaskListResult,
  OperationTaskListSort,
  OperationTaskSource,
  OperationTaskSourceSummary,
  OperationTaskStatus,
};

type JobTaskRow = Job & {
  creator?: { username: string; displayName: string | null } | null;
  _count?: { events: number };
};
type CommandTaskRow = Prisma.CommandRequestGetPayload<{ include: { requester: { select: { username: true; displayName: true } }; targets: { select: { stdout: true; stderr: true; status: true; finishedAt: true; startedAt: true }; take: 2; orderBy: { finishedAt: "desc" } }; executionLogs: { select: { summary: true; createdAt: true }; take: 2; orderBy: { createdAt: "desc" } } } }>;
type ScheduledTaskRow = Prisma.ScheduledTaskGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type DownloadTaskRow = Prisma.DownloadTaskGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type SyncJobTaskRow = Prisma.SyncJobGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type BackupTaskRow = Prisma.BackupRecordGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type DeploymentTaskRow = Prisma.DeploymentRunGetPayload<{ include: { creator: { select: { username: true; displayName: true } }; template: { select: { name: true } }; commandRequest: { select: { status: true; workerId: true; workerHeartbeatAt: true; updatedAt: true } } } }>;

function toIso(value: Date | string | null | undefined) {
  return value ? new Date(value).toISOString() : new Date(0).toISOString();
}

function actorName(actor: { username?: string | null; displayName?: string | null } | null | undefined) {
  return actor?.displayName || actor?.username || null;
}

export function mapOperationStatus(status: string): OperationTaskStatus {
  if (["RUNNING", "ACTIVE", "IN_PROGRESS", "APPROVED"].includes(status)) return "running";
  if (["COMPLETED", "IDLE"].includes(status)) return "completed";
  if (["FAILED", "REJECTED", "EXPIRED"].includes(status)) return "failed";
  if (["CANCELLED", "DISABLED"].includes(status)) return "cancelled";
  if (["PAUSED"].includes(status)) return "paused";
  return "pending";
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

function normalizeFailureReason(task: OperationTask, t: (key: string) => string) {
  const text = `${task.title} ${task.progress ?? ""}`.toLowerCase();
  if (/permission|denied|forbidden|unauthorized|401|403|权限|拒绝/.test(text)) return t("backend.operationTask.failure.authOrPermission");
  if (/timeout|timed out|超时|deadline/.test(text)) return t("backend.operationTask.failure.timeout");
  if (/no such file|not found|missing|不存在|未找到/.test(text)) return t("backend.operationTask.failure.fileOrResourceNotFound");
  if (/connect|network|econn|dns|socket|网络|连接/.test(text)) return t("backend.operationTask.failure.networkOrConnection");
  if (/smtp|email|mail|webhook|telegram|通知/.test(text)) return t("backend.operationTask.failure.notification");
  if (/backup|restore|备份|恢复/.test(text)) return t("backend.operationTask.failure.backupOrRestore");
  return task.taskType ? t("backend.operationTask.failure.taskTypeFailed").replace("{taskType}", task.taskType) : t("backend.operationTask.failure.sourceFailed").replace("{source}", task.source);
}

function summarizeOperationTaskFailures(tasks: OperationTask[], t: (key: string) => string): OperationTaskFailureSummary[] {
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

export async function listOperationTasks(options: OperationTaskListOptions = {}): Promise<OperationTask[]> {
  const result = await listOperationTaskResult(options);
  return result.tasks;
}

export async function listOperationTaskResult(options: OperationTaskListOptions = {}): Promise<OperationTaskListResult> {
  const configuredLimit = await getOperationTaskListLimit();
  const requestedLimit = options.limit ?? configuredLimit;
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : configuredLimit, 1), configuredLimit);
  const [jobs, commands, scheduled, downloads, syncJobs, backups, deployments] = await Promise.all([
    prisma.job.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } }, _count: { select: { events: true } } } }),
    prisma.commandRequest.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { requester: { select: { username: true, displayName: true } }, targets: { take: 2, orderBy: { finishedAt: "desc" }, select: { stdout: true, stderr: true, status: true, finishedAt: true, startedAt: true } }, executionLogs: { take: 2, orderBy: { createdAt: "desc" }, select: { summary: true, createdAt: true } } } }),
    prisma.scheduledTask.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.downloadTask.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.syncJob.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.backupRecord.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.deploymentRun.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } }, template: { select: { name: true } }, commandRequest: { select: { status: true, workerId: true, workerHeartbeatAt: true, updatedAt: true } } } }),
  ]);

  const tasks: OperationTask[] = [
    ...jobs.map((item: JobTaskRow) => ({ id: `job:${item.id}`, source: "job" as const, sourceId: item.id, title: item.title, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.progress ?? item.errorMessage, logPreview: compactLogPreview([item.progress, item.errorMessage]), workerId: item.workerId, workerHeartbeatAt: item.workerHeartbeatAt ? toIso(item.workerHeartbeatAt) : null, href: "/tasks", taskType: item.type, eventCount: item._count?.events ?? 0 })),
    ...commands.map((item: CommandTaskRow) => ({ id: `command:${item.id}`, source: "command" as const, sourceId: item.id, title: item.title, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.requester), progress: formatWorkerProgress(item), logPreview: compactLogPreview([(item.executionLogs ?? []).map((log) => log.summary).join("\n"), (item.targets ?? []).map((target) => [target.stdout, target.stderr].filter(Boolean).join("\n")).join("\n"), formatWorkerProgress(item)]), workerId: item.workerId, workerHeartbeatAt: item.workerHeartbeatAt ? toIso(item.workerHeartbeatAt) : null, href: "/requests" })),
    ...scheduled.map((item: ScheduledTaskRow) => ({ id: `scheduled:${item.id}`, source: "scheduled" as const, sourceId: item.id, title: item.name, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.lastResult, logPreview: compactLogPreview([item.lastResult]), href: "/scheduled-tasks" })),
    ...downloads.map((item: DownloadTaskRow) => ({ id: `download:${item.id}`, source: "download" as const, sourceId: item.id, title: item.fileName || item.url, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.progress, logPreview: compactLogPreview([item.progress, item.targetPath]), href: "/downloads" })),
    ...syncJobs.map((item: SyncJobTaskRow) => ({ id: `sync:${item.id}`, source: "sync" as const, sourceId: item.id, title: item.name, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.lastSyncResult, logPreview: compactLogPreview([item.lastSyncResult]), href: "/files" })),
    ...backups.map((item: BackupTaskRow) => ({ id: `backup:${item.id}`, source: "backup" as const, sourceId: item.id, title: `${item.type} backup`, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.filePath, logPreview: compactLogPreview([item.filePath]), href: "/backups" })),
    ...deployments.map((item: DeploymentTaskRow) => ({ id: `deployment:${item.id}`, source: "deployment" as const, sourceId: item.id, title: item.template.name, status: resolveDeploymentOperationStatus(item), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.commandRequest ? formatWorkerProgress(item.commandRequest) : null, logPreview: compactLogPreview([item.commandRequest ? formatWorkerProgress(item.commandRequest) : null]), workerId: item.commandRequest?.workerId ?? null, workerHeartbeatAt: item.commandRequest?.workerHeartbeatAt ? toIso(item.commandRequest.workerHeartbeatAt) : null, href: "/deployments" })),
  ];

  const foldedTasks = foldCompletedPeriodicJobs(tasks);
  const filteredTasks = sortOperationTasks(filterOperationTasks(foldedTasks, options), options.sort)
    .slice(0, limit);
  const t = await serverT();
  return {
    tasks: filteredTasks,
    sourceSummary: summarizeOperationTaskSources(filteredTasks),
    failureSummary: summarizeOperationTaskFailures(filteredTasks, t),
  };
}
