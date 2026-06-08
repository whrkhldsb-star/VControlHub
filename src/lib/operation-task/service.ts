import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { getOperationTaskListLimit } from "@/lib/runtime-settings/service";

export type OperationTaskSource = "job" | "command" | "scheduled" | "download" | "sync" | "backup" | "deployment";
export type OperationTaskStatus = "pending" | "running" | "completed" | "failed" | "cancelled" | "paused";

export type OperationTask = {
  id: string;
  source: OperationTaskSource;
  sourceId: string;
  title: string;
  status: OperationTaskStatus;
  createdAt: string;
  updatedAt: string;
  actor?: string | null;
  progress?: string | null;
  href?: string;
  workerId?: string | null;
  workerHeartbeatAt?: string | null;
};

type JobTaskRow = Prisma.JobGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type CommandTaskRow = Prisma.CommandRequestGetPayload<{ include: { requester: { select: { username: true; displayName: true } } } }>;
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
  const heartbeatText = heartbeat ? `心跳 ${new Date(heartbeat).toLocaleString("zh-CN")}` : "心跳未知";
  return `后台执行器 ${input.workerId ?? "未知"} · ${heartbeatText}`;
}

export async function listOperationTasks(options: { limit?: number } = {}): Promise<OperationTask[]> {
  const configuredLimit = await getOperationTaskListLimit();
  const requestedLimit = options.limit ?? configuredLimit;
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? requestedLimit : configuredLimit, 1), configuredLimit);
  const [jobs, commands, scheduled, downloads, syncJobs, backups, deployments] = await Promise.all([
    prisma.job.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.commandRequest.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { requester: { select: { username: true, displayName: true } } } }),
    prisma.scheduledTask.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.downloadTask.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.syncJob.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.backupRecord.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.deploymentRun.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } }, template: { select: { name: true } }, commandRequest: { select: { status: true, workerId: true, workerHeartbeatAt: true, updatedAt: true } } } }),
  ]);

  const tasks: OperationTask[] = [
    ...jobs.map((item: JobTaskRow) => ({ id: `job:${item.id}`, source: "job" as const, sourceId: item.id, title: item.title, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.progress ?? item.errorMessage, workerId: item.workerId, workerHeartbeatAt: item.workerHeartbeatAt ? toIso(item.workerHeartbeatAt) : null, href: "/tasks" })),
    ...commands.map((item: CommandTaskRow) => ({ id: `command:${item.id}`, source: "command" as const, sourceId: item.id, title: item.title, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.requester), progress: formatWorkerProgress(item), workerId: item.workerId, workerHeartbeatAt: item.workerHeartbeatAt ? toIso(item.workerHeartbeatAt) : null, href: "/requests" })),
    ...scheduled.map((item: ScheduledTaskRow) => ({ id: `scheduled:${item.id}`, source: "scheduled" as const, sourceId: item.id, title: item.name, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.lastResult, href: "/scheduled-tasks" })),
    ...downloads.map((item: DownloadTaskRow) => ({ id: `download:${item.id}`, source: "download" as const, sourceId: item.id, title: item.fileName || item.url, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.progress, href: "/downloads" })),
    ...syncJobs.map((item: SyncJobTaskRow) => ({ id: `sync:${item.id}`, source: "sync" as const, sourceId: item.id, title: item.name, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.lastSyncResult, href: "/files" })),
    ...backups.map((item: BackupTaskRow) => ({ id: `backup:${item.id}`, source: "backup" as const, sourceId: item.id, title: `${item.type} 备份`, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.filePath, href: "/backups" })),
    ...deployments.map((item: DeploymentTaskRow) => ({ id: `deployment:${item.id}`, source: "deployment" as const, sourceId: item.id, title: item.template.name, status: resolveDeploymentOperationStatus(item), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.commandRequest ? formatWorkerProgress(item.commandRequest) : null, workerId: item.commandRequest?.workerId ?? null, workerHeartbeatAt: item.commandRequest?.workerHeartbeatAt ? toIso(item.commandRequest.workerHeartbeatAt) : null, href: "/deployments" })),
  ];

  return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
}
