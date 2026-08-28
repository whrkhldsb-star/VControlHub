/**
 * TR-006: 跨来源统一长期保留策略。
 *
 * 背景：任务中心视图是 7 个来源 (job / command / scheduled / download /
 * sync / backup / deployment) 的并集。alert.evaluate 已经有自己的
 * pruneCompletedJobsByType 兜底（见 alert-worker.ts），其他 6 个来源
 * 在大型实例会持续增长没有清理入口。本模块提供：
 *
 *   - pruneOperationTaskHistory(): 对 command/download/deployment 等可终态历史统一执行
 *     "completed-status 保留最新 N 条 + 早于 X 天的更早记录全删" 策略
 *
 * 设计原则：
 *   - skip `scheduled` 源：ScheduledTaskStatus 只有 ACTIVE / PAUSED / DISABLED，
 *     没有"已完成"终态，是长期持久记录不是历史，不应清理
 *   - skip `sync` 源：SyncJob 是长期配置（路径/调度），不是历史；SyncLog 由业务侧自管
 *   - skip `backup` 源：由 backup 域 pruneOldBackupRecordsNow 负责（含磁盘/异地清理）
 *   - skip `job` 源：由 alert-worker 的 pruneCompletedJobsByType 负责
 *     (alert.evaluate) + Job 系统自身 (其他 type) 共同管理
 *   - 单表 prune 用 "findMany ID 排序 + take N → deleteMany where id notIn"，
 *     跟 alert-worker 的 pruneCompletedJobsByType 同范式
 *   - keepLatest 按 teamId 分组生效, 不是全平台前 N 条。全平台口径下
 *     一个高频租户就能把 keepLatest 名额占满, 于此其他租户早于
 *     olderThan 的历史会被全部删掉 —— 那是跨租户的数据互相挤占
 *   - 全部包 try/catch + logger.warn，任一来源失败不影响其他来源继续
 *   - 默认 90 天 / 100 条，可由参数覆盖
 */
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const logger = createLogger("operation-task-retention");

export const OPERATION_TASK_RETENTION_JOB_TYPE = "operation-task.retention";

/** 默认保留天数：早于这个天数的 completed 记录会被裁剪（只保留 keepLatest） */
export const DEFAULT_OPERATION_TASK_RETENTION_DAYS = 90;

/** 默认保留最新条数：每来源、每个 teamId 的 completed 状态各保留这么多条 */
export const DEFAULT_OPERATION_TASK_RETENTION_KEEP_LATEST = 100;

export type OperationTaskRetentionOptions = {
  /** 早于这个时间的 completed 记录才会被裁剪（默认 = now - 90 days） */
  olderThan?: Date;
  /** 每来源、每个 teamId 至少保留最新多少条（默认 100） */
  keepLatest?: number;
  /** 跑时 now 注入（测试用） */
  now?: Date;
};

export type OperationTaskRetentionPerSourceResult = {
  scanned: number;
  deleted: number;
  error?: string;
  /**
   * True when this source is deliberately not pruned here (sync/backup below).
   * Without the flag a `deleted: 0` row reads as "nothing needed pruning" when it
   * actually means "another owner handles this table".
   */
  skipped?: true;
};

export type OperationTaskRetentionResult = {
  olderThan: string;
  keepLatest: number;
  totalDeleted: number;
  perSource: Record<string, OperationTaskRetentionPerSourceResult>;
  /** Sources whose prune threw. Non-empty means the run did not do its job. */
  failedSources: string[];
  durationMs: number;
};

function resolveOlderThan(options: OperationTaskRetentionOptions): Date {
  if (options.olderThan) return options.olderThan;
  const now = options.now ?? new Date();
  return new Date(now.getTime() - DEFAULT_OPERATION_TASK_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

function resolveKeepLatest(options: OperationTaskRetentionOptions): number {
  return Math.max(1, Math.floor(options.keepLatest ?? DEFAULT_OPERATION_TASK_RETENTION_KEEP_LATEST));
}

/**
 * Hard upper bound on how many `teamId` scopes one source prunes per run.
 * Team count is already small in practice; the cap only exists so a corrupted
 * or unexpectedly wide grouping cannot turn one tick into thousands of queries.
 * Hitting it is logged, never silent — the remaining scopes are pruned next run.
 */
const MAX_RETENTION_TEAM_SCOPES = 200;

/**
 * Apply "keep the newest `keepLatest`, delete everything else older than
 * `olderThan`" **once per team scope** (plus the `teamId: null` legacy scope).
 *
 * The callbacks are per-source so each Prisma delegate keeps its own literal
 * status union and stays type-checked at the call site.
 */
async function pruneTerminalHistoryPerTeam(input: {
  source: string;
  keepLatest: number;
  olderThan: Date;
  listTeamScopes: () => Promise<(string | null)[]>;
  listRetainedIds: (teamId: string | null, take: number) => Promise<string[]>;
  deleteOlderThan: (teamId: string | null, retainedIds: string[]) => Promise<number>;
}): Promise<OperationTaskRetentionPerSourceResult> {
  const allScopes = await input.listTeamScopes();
  const scopes = allScopes.slice(0, MAX_RETENTION_TEAM_SCOPES);
  if (allScopes.length > scopes.length) {
    logger.warn("Retention team scope cap reached; remaining scopes prune on the next run", {
      source: input.source,
      scopes: allScopes.length,
      cap: MAX_RETENTION_TEAM_SCOPES,
    });
  }

  let scanned = 0;
  let deleted = 0;
  for (const teamId of scopes) {
    const retainedIds = await input.listRetainedIds(teamId, input.keepLatest);
    scanned += retainedIds.length;
    deleted += await input.deleteOlderThan(teamId, retainedIds);
  }
  return { scanned, deleted };
}

const COMMAND_TERMINAL_STATUSES = ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"] as const;

async function pruneCommand(keepLatest: number, olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  return pruneTerminalHistoryPerTeam({
    source: "command",
    keepLatest,
    olderThan,
    listTeamScopes: async () => {
      const groups = await prisma.commandRequest.groupBy({
        by: ["teamId"],
        where: { status: { in: [...COMMAND_TERMINAL_STATUSES] } },
      });
      return groups.map((group) => group.teamId);
    },
    listRetainedIds: async (teamId, take) => {
      const rows = await prisma.commandRequest.findMany({
        where: { status: { in: [...COMMAND_TERMINAL_STATUSES] }, teamId },
        orderBy: [{ createdAt: "desc" }],
        select: { id: true },
        take,
      });
      return rows.map((row) => row.id);
    },
    deleteOlderThan: async (teamId, retainedIds) => {
      const result = await prisma.commandRequest.deleteMany({
        where: {
          status: { in: [...COMMAND_TERMINAL_STATUSES] },
          teamId,
          createdAt: { lt: olderThan },
          ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
        },
      });
      return result.count;
    },
  });
}

const DOWNLOAD_TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED"] as const;

async function pruneDownload(keepLatest: number, olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  return pruneTerminalHistoryPerTeam({
    source: "download",
    keepLatest,
    olderThan,
    listTeamScopes: async () => {
      const groups = await prisma.downloadTask.groupBy({
        by: ["teamId"],
        where: { status: { in: [...DOWNLOAD_TERMINAL_STATUSES] } },
      });
      return groups.map((group) => group.teamId);
    },
    listRetainedIds: async (teamId, take) => {
      const rows = await prisma.downloadTask.findMany({
        where: { status: { in: [...DOWNLOAD_TERMINAL_STATUSES] }, teamId },
        orderBy: [{ createdAt: "desc" }],
        select: { id: true },
        take,
      });
      return rows.map((row) => row.id);
    },
    deleteOlderThan: async (teamId, retainedIds) => {
      const result = await prisma.downloadTask.deleteMany({
        where: {
          status: { in: [...DOWNLOAD_TERMINAL_STATUSES] },
          teamId,
          createdAt: { lt: olderThan },
          ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
        },
      });
      return result.count;
    },
  });
}

async function pruneSync(_keepLatest: number, _olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  // SyncJob rows are long-lived automation configs (source/target paths + schedule),
  // not disposable task history. Never delete them from operation-task retention.
  // SyncLog history can be pruned separately if needed; keepLatest is intentionally unused.
  return { scanned: 0, deleted: 0, skipped: true };
}

async function pruneBackup(_keepLatest: number, _olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  // BackupRecord prune must unlink artifacts (+ offsite) via pruneOldBackupRecordsNow.
  // DB-only deleteMany here would orphan tarballs under backups/. Defer entirely.
  return { scanned: 0, deleted: 0, skipped: true };
}

// DeploymentRun status is String. Live terminal set includes REJECTED (deployment service);
// keep ROLLED_BACK for forward-compat even if writers do not emit it today.
const DEPLOYMENT_TERMINAL_STATUSES = ["COMPLETED", "FAILED", "CANCELLED", "REJECTED", "ROLLED_BACK"] as const;

async function pruneDeployment(keepLatest: number, olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  return pruneTerminalHistoryPerTeam({
    source: "deployment",
    keepLatest,
    olderThan,
    listTeamScopes: async () => {
      const groups = await prisma.deploymentRun.groupBy({
        by: ["teamId"],
        where: { status: { in: [...DEPLOYMENT_TERMINAL_STATUSES] } },
      });
      return groups.map((group) => group.teamId);
    },
    listRetainedIds: async (teamId, take) => {
      const rows = await prisma.deploymentRun.findMany({
        where: { status: { in: [...DEPLOYMENT_TERMINAL_STATUSES] }, teamId },
        orderBy: [{ createdAt: "desc" }],
        select: { id: true },
        take,
      });
      return rows.map((row) => row.id);
    },
    deleteOlderThan: async (teamId, retainedIds) => {
      const result = await prisma.deploymentRun.deleteMany({
        where: {
          status: { in: [...DEPLOYMENT_TERMINAL_STATUSES] },
          teamId,
          createdAt: { lt: olderThan },
          ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
        },
      });
      return result.count;
    },
  });
}

async function safeRun(source: string, fn: () => Promise<OperationTaskRetentionPerSourceResult>): Promise<OperationTaskRetentionPerSourceResult> {
  try {
    return await fn();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.warn(`pruneOperationTaskHistory: ${source} failed`, { error: message });
    return { scanned: 0, deleted: 0, error: message };
  }
}

/**
 * 跨来源执行保留策略。任一来源失败被 catch 隔离, 不影响其他来源。
 * Returns per-source 删除统计 + 总和。
 */
export async function pruneOperationTaskHistory(
  options: OperationTaskRetentionOptions = {},
): Promise<OperationTaskRetentionResult> {
  const startedAt = Date.now();
  const olderThan = resolveOlderThan(options);
  const keepLatest = resolveKeepLatest(options);
  const perSource: Record<string, OperationTaskRetentionPerSourceResult> = {};

  const [command, download, sync, backup, deployment] = await Promise.all([
    safeRun("command", () => pruneCommand(keepLatest, olderThan)),
    safeRun("download", () => pruneDownload(keepLatest, olderThan)),
    safeRun("sync", () => pruneSync(keepLatest, olderThan)),
    safeRun("backup", () => pruneBackup(keepLatest, olderThan)),
    safeRun("deployment", () => pruneDeployment(keepLatest, olderThan)),
  ]);
  perSource.command = command;
  perSource.download = download;
  perSource.sync = sync;
  perSource.backup = backup;
  perSource.deployment = deployment;

  const totalDeleted = Object.values(perSource).reduce((sum, r) => sum + r.deleted, 0);
  const failedSources = Object.entries(perSource)
    .filter(([, result]) => result.error)
    .map(([source]) => source);
  const durationMs = Date.now() - startedAt;

  if (failedSources.length > 0) {
    logger.warn("Operation task retention finished with failed sources", {
      failedSources,
      totalDeleted,
    });
  }

  if (totalDeleted > 0) {
    logger.info("Pruned operation task history", {
      totalDeleted,
      perSource,
      olderThan: olderThan.toISOString(),
      keepLatest,
      durationMs,
    });
  }

  return {
    olderThan: olderThan.toISOString(),
    keepLatest,
    totalDeleted,
    perSource,
    failedSources,
    durationMs,
  };
}
