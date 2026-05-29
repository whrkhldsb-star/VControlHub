import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

export type OperationTaskSource = "command" | "scheduled" | "download" | "sync" | "backup" | "deployment";
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
};

type CommandTaskRow = Prisma.CommandRequestGetPayload<{ include: { requester: { select: { username: true; displayName: true } } } }>;
type ScheduledTaskRow = Prisma.ScheduledTaskGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type DownloadTaskRow = Prisma.DownloadTaskGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type SyncJobTaskRow = Prisma.SyncJobGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type BackupTaskRow = Prisma.BackupRecordGetPayload<{ include: { creator: { select: { username: true; displayName: true } } } }>;
type DeploymentTaskRow = Prisma.DeploymentRunGetPayload<{ include: { creator: { select: { username: true; displayName: true } }; template: { select: { name: true } }; commandRequest: { select: { status: true } } } }>;

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

export async function listOperationTasks(options: { limit?: number } = {}): Promise<OperationTask[]> {
  const limit = options.limit ?? 100;
  const [commands, scheduled, downloads, syncJobs, backups, deployments] = await Promise.all([
    prisma.commandRequest.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { requester: { select: { username: true, displayName: true } } } }),
    prisma.scheduledTask.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.downloadTask.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.syncJob.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.backupRecord.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } } } }),
    prisma.deploymentRun.findMany({ take: limit, orderBy: { createdAt: "desc" }, include: { creator: { select: { username: true, displayName: true } }, template: { select: { name: true } }, commandRequest: { select: { status: true } } } }),
  ]);

  const tasks: OperationTask[] = [
    ...commands.map((item: CommandTaskRow) => ({ id: `command:${item.id}`, source: "command" as const, sourceId: item.id, title: item.title, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.requester), href: "/requests" })),
    ...scheduled.map((item: ScheduledTaskRow) => ({ id: `scheduled:${item.id}`, source: "scheduled" as const, sourceId: item.id, title: item.name, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.lastResult, href: "/scheduled-tasks" })),
    ...downloads.map((item: DownloadTaskRow) => ({ id: `download:${item.id}`, source: "download" as const, sourceId: item.id, title: item.fileName || item.url, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.progress, href: "/downloads" })),
    ...syncJobs.map((item: SyncJobTaskRow) => ({ id: `sync:${item.id}`, source: "sync" as const, sourceId: item.id, title: item.name, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.lastSyncResult, href: "/files" })),
    ...backups.map((item: BackupTaskRow) => ({ id: `backup:${item.id}`, source: "backup" as const, sourceId: item.id, title: `${item.type} 备份`, status: mapOperationStatus(item.status), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), progress: item.filePath, href: "/backups" })),
    ...deployments.map((item: DeploymentTaskRow) => ({ id: `deployment:${item.id}`, source: "deployment" as const, sourceId: item.id, title: item.template.name, status: resolveDeploymentOperationStatus(item), createdAt: toIso(item.createdAt), updatedAt: toIso(item.updatedAt), actor: actorName(item.creator), href: "/deployments" })),
  ];

  return tasks.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, limit);
}
