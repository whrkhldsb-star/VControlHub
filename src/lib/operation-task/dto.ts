/**
 * Operation-task DTO boundary.
 *
 * TR-039: extracted from `src/lib/operation-task/service.ts` so client-side
 * code (operation-task-list-client.tsx, page.tsx) and the API route
 * (api/operation-tasks/route.ts) can reach for these types without pulling
 * the whole service module — which transitively imports Prisma, runtime
 * settings, the DB pool and a stack of server-only helpers — into the
 * client bundle.
 *
 * Service.ts re-exports everything declared here so existing call sites
 * keep working unchanged. New client code must import from this module.
 *
 * Pure types only — no runtime side effects, no Prisma, no DB. The shape
 * of `OperationTask` is the wire contract between server and client; if
 * you change a field here, every layer (route, service, client) sees the
 * change in the type system simultaneously.
 */

export type OperationTaskSource =
  | "job"
  | "command"
  | "scheduled"
  | "download"
  | "sync"
  | "backup"
  | "deployment";

export type OperationTaskStatus =
  | "pending"
  | "running"
  | "completed"
  | "failed"
  | "cancelled"
  | "paused";

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
  logPreview?: string[];
  href?: string;
  workerId?: string | null;
  workerHeartbeatAt?: string | null;
  taskType?: string | null;
  foldedCount?: number;
  // TR-001 T13a: durable-job event count (claimed / heartbeat / completed /
  // failed / retrying / cancelled). Only set for `source === "job"` tasks;
  // other sources (command, scheduled, download, sync, backup, deployment)
  // don't have the JobEvent timeline.
  eventCount?: number;
};

export type OperationTaskFailureSummary = {
  reason: string;
  total: number;
  sources: OperationTaskSource[];
  latestTaskId: string;
  latestTitle: string;
  latestAt: string;
};

export type OperationTaskSourceSummary = {
  source: OperationTaskSource;
  total: number;
  attention: number;
  failed: number;
  running: number;
  pending: number;
};

export type OperationTaskListResult = {
  tasks: OperationTask[];
  sourceSummary: OperationTaskSourceSummary[];
  failureSummary: OperationTaskFailureSummary[];
};

export type OperationTaskListSort = "recent" | "attention";

export type OperationTaskListFilters = {
  status?: OperationTaskStatus | OperationTaskStatus[];
  taskType?: string;
  sort?: OperationTaskListSort;
};

export type OperationTaskListOptions = OperationTaskListFilters & { limit?: number };
