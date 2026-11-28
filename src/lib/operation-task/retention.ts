import type { CommandRequestStatus, DownloadTaskStatus, Prisma } from "@prisma/client";
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
 *   - 同一租户的裁剪在同一快照内提交，失败时一起回滚
 *   - 默认 90 天 / 100 条，可由参数覆盖
 */
import { downloadHistoryRemovable } from "@/lib/downloads/transfer-manifest";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const logger = createLogger("operation-task-retention");

export const OPERATION_TASK_RETENTION_JOB_TYPE = "operation-task.retention";

/** 默认保留天数：早于这个天数的 completed 记录会被裁剪（只保留 keepLatest） */
export const DEFAULT_OPERATION_TASK_RETENTION_DAYS = 90;

/** 默认保留最新条数：每来源、每个 teamId 的 completed 状态各保留这么多条 */
export const DEFAULT_OPERATION_TASK_RETENTION_KEEP_LATEST = 100;

export type OperationTaskRetentionOptions = {
  signal?: AbortSignal;
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

const sources = ["command", "download", "deployment"] as const;
type Source = typeof sources[number];
const terminalStatuses = {
  command: ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"],
  download: ["COMPLETED", "FAILED", "CANCELLED"],
  deployment: ["COMPLETED", "FAILED", "CANCELLED", "REJECTED", "ROLLED_BACK"],
} satisfies { command: CommandRequestStatus[]; download: DownloadTaskStatus[]; deployment: string[] };

async function pruneTenantSource(tx: Prisma.TransactionClient, source: Source, teamId: string | null, take: number, olderThan: Date, signal?: AbortSignal) {
  const orderBy = [{ createdAt: "desc" }, { id: "desc" }] satisfies Prisma.CommandRequestOrderByWithRelationInput[];
  const page = { orderBy, select: { id: true }, take };
  const cutoff = (ids: { id: string }[]) => ({
    createdAt: { lt: olderThan }, ...(ids.length > 0 && { id: { notIn: ids.map(row => row.id) } }),
  });
  if (source === "command") {
    const where = { teamId, status: { in: terminalStatuses.command } };
    const ids = await tx.commandRequest.findMany({ where, ...page });
    signal?.throwIfAborted();
    // Guard unsettled AI hosted actions (FK-less link for automatic upgrades):
    // keep any finished CommandRequest whose outcome has not yet been projected.
    const unsettledHostedIds: string[] = [];
    const hostedDelegate = (tx as unknown as {
      aiHostedAction?: {
        findMany?: (args: unknown) => Promise<Array<{ commandRequestId: string | null }>>;
      };
    }).aiHostedAction;
    if (hostedDelegate?.findMany) {
      const BATCH_SIZE = 1000;
      let cursorId: string | undefined;
      for (;;) {
        signal?.throwIfAborted();
        const unsettledActions = await hostedDelegate.findMany({
          where: {
            teamId,
            commandRequestId: { not: null },
            OR: [{ completedAt: null }, { status: { in: ["PENDING_APPROVAL", "APPROVED", "EXECUTING"] } }],
          },
          select: { id: true, commandRequestId: true },
          orderBy: { id: "asc" },
          ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
          take: BATCH_SIZE,
        });
        for (const action of unsettledActions) {
          if (action.commandRequestId) unsettledHostedIds.push(action.commandRequestId);
        }
        if (unsettledActions.length < BATCH_SIZE) break;
        const last = unsettledActions.at(-1) as { id?: string } | undefined;
        if (!last?.id) break;
        cursorId = last.id;
      }
    }
    const protectedIds = [...new Set([...ids.map((row) => row.id), ...unsettledHostedIds])];
    const result = await tx.commandRequest.deleteMany({ where: {
      ...where,
      createdAt: { lt: olderThan },
      ...(protectedIds.length > 0 && { id: { notIn: protectedIds } }),
      // A deployment or rollback learns its outcome from its command (on
      // its next listing). Deleted first, the command took that outcome
      // with it: the run stayed pending for good, then was settled as
      // "never created" once its link was cleared.
      deploymentRuns: { none: { status: { in: ["PENDING", "RUNNING"] } } },
      deploymentRollbackRuns: { none: { status: { in: ["PENDING", "APPROVED", "RUNNING"] } } },
      // Same for a scheduled task's run: its cascade delete left the task
      // "awaiting final result" for good. Kept until reconciled.
      scheduledTaskRuns: { none: { status: "DISPATCHED" } },
    } });
    return { scanned: ids.length, deleted: result.count };
  }
  if (source === "download") {
    const where = { teamId, status: { in: terminalStatuses.download } };
    const ids = await tx.downloadTask.findMany({ where, ...page });
    signal?.throwIfAborted();
    const result = await tx.downloadTask.deleteMany({ where: {
      ...where, ...cutoff(ids),
      ...downloadHistoryRemovable,
    } });
    return { scanned: ids.length, deleted: result.count };
  }
  {
    const where = { teamId, status: { in: terminalStatuses.deployment } };
    const ids = await tx.deploymentRun.findMany({ where, ...page });
    signal?.throwIfAborted();
    const result = await tx.deploymentRun.deleteMany({ where: {
      ...where, ...cutoff(ids),
      // A rollback cascades with its source run: keep the run while one
      // is still pending or running (its command keeps going otherwise
      // with no record left of it).
      rollbackAttempts: { none: { status: { in: ["PENDING", "RUNNING"] } } },
    } });
    return { scanned: ids.length, deleted: result.count };
  }
}

export async function pruneOperationTaskHistory(options: OperationTaskRetentionOptions = {}): Promise<OperationTaskRetentionResult> {
  options.signal?.throwIfAborted();
  const startedAt = Date.now();
  const olderThan = resolveOlderThan(options);
  const keepLatest = resolveKeepLatest(options);
  const perSource: Record<string, OperationTaskRetentionPerSourceResult> = Object.fromEntries(
    [...sources, "sync", "backup"].map(source => [source, { scanned: 0, deleted: 0,
      ...((source === "sync" || source === "backup") && { skipped: true }) }]),
  );
  const tenants = new Set<string | null>();
  const recordError = (source: Source, error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    perSource[source]!.error = message;
    logger.warn(`pruneOperationTaskHistory: ${source} failed`, { error: message });
  };
  for (const source of sources) {
    try {
      const groups = source === "command" ? await prisma.commandRequest.groupBy({ by: ["teamId"], where: { status: { in: terminalStatuses.command } } })
        : source === "download" ? await prisma.downloadTask.groupBy({ by: ["teamId"], where: { status: { in: terminalStatuses.download } } })
        : await prisma.deploymentRun.groupBy({ by: ["teamId"], where: { status: { in: terminalStatuses.deployment } } });
      for (const { teamId } of groups) tenants.add(teamId);
    } catch (error) { recordError(source, error); }
  }
  for (const teamId of tenants) {
    options.signal?.throwIfAborted();
    try {
      const committed = await prisma.$transaction(async tx => {
        const result = [];
        for (const source of sources) {
          options.signal?.throwIfAborted();
          result.push({ source, ...await pruneTenantSource(tx, source, teamId, keepLatest, olderThan, options.signal) });
        }
        options.signal?.throwIfAborted();
        return result;
      }, { isolationLevel: "RepeatableRead" });
      for (const { source, scanned, deleted } of committed) {
        perSource[source]!.scanned += scanned;
        perSource[source]!.deleted += deleted;
      }
    } catch (error) {
      options.signal?.throwIfAborted();
      for (const source of sources) recordError(source, error);
    }
  }

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
