/**
 * TR-006: 跨来源统一长期保留策略。
 *
 * 背景：任务中心视图是 7 个来源 (job / command / scheduled / download /
 * sync / backup / deployment) 的并集。alert.evaluate 已经有自己的
 * pruneCompletedJobsByType 兜底（见 alert-worker.ts），其他 6 个来源
 * 在大型实例会持续增长没有清理入口。本模块提供：
 *
 *   - pruneOperationTaskHistory(): 对 5 个非-job / 非-scheduled 来源统一执行
 *     "completed-status 保留最新 N 条 + 早于 X 天的更早记录全删" 策略
 *
 * 设计原则：
 *   - skip `scheduled` 源：ScheduledTaskStatus 只有 ACTIVE / PAUSED / DISABLED，
 *     没有"已完成"终态，是长期持久记录不是历史，不应清理
 *   - skip `job` 源：由 alert-worker 的 pruneCompletedJobsByType 负责
 *     (alert.evaluate) + Job 系统自身 (其他 type) 共同管理
 *   - 单表 prune 用 "findMany ID 排序 + take N → deleteMany where id notIn"，
 *     跟 alert-worker 的 pruneCompletedJobsByType 同范式
 *   - 全部包 try/catch + logger.warn，任一来源失败不影响其他来源继续
 *   - 默认 90 天 / 100 条，可由参数覆盖
 */
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const logger = createLogger("operation-task-retention");

export const OPERATION_TASK_RETENTION_JOB_TYPE = "operation-task.retention";

/** 默认保留天数：早于这个天数的 completed 记录会被裁剪（只保留 keepLatest） */
export const DEFAULT_OPERATION_TASK_RETENTION_DAYS = 90;

/** 默认保留最新条数：每来源 completed 状态至少保留这么多条 */
export const DEFAULT_OPERATION_TASK_RETENTION_KEEP_LATEST = 100;

export type OperationTaskRetentionOptions = {
  /** 早于这个时间的 completed 记录才会被裁剪（默认 = now - 90 days） */
  olderThan?: Date;
  /** 每来源至少保留最新多少条（默认 100） */
  keepLatest?: number;
  /** 跑时 now 注入（测试用） */
  now?: Date;
};

export type OperationTaskRetentionPerSourceResult = {
  scanned: number;
  deleted: number;
  error?: string;
};

export type OperationTaskRetentionResult = {
  olderThan: string;
  keepLatest: number;
  totalDeleted: number;
  perSource: Record<string, OperationTaskRetentionPerSourceResult>;
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

async function pruneCommand(keepLatest: number, olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  const retained = await prisma.commandRequest.findMany({
    where: { status: { in: ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"] } },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
    take: keepLatest,
  });
  const retainedIds = retained.map((row) => row.id);
  const result = await prisma.commandRequest.deleteMany({
    where: {
      status: { in: ["COMPLETED", "FAILED", "REJECTED", "CANCELLED"] },
      createdAt: { lt: olderThan },
      ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
    },
  });
  return { scanned: retained.length, deleted: result.count };
}

async function pruneDownload(keepLatest: number, olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  const retained = await prisma.downloadTask.findMany({
    where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED"] } },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
    take: keepLatest,
  });
  const retainedIds = retained.map((row) => row.id);
  const result = await prisma.downloadTask.deleteMany({
    where: {
      status: { in: ["COMPLETED", "FAILED", "CANCELLED"] },
      createdAt: { lt: olderThan },
      ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
    },
  });
  return { scanned: retained.length, deleted: result.count };
}

async function pruneSync(keepLatest: number, olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  // sync 用 lastSyncAt 字段 (不是 createdAt) 判断"最后一次同步时间"
  const retained = await prisma.syncJob.findMany({
    where: { status: { in: ["IDLE", "ERROR"] } },
    orderBy: [{ lastSyncAt: "desc" }],
    select: { id: true },
    take: keepLatest,
  });
  const retainedIds = retained.map((row) => row.id);
  const result = await prisma.syncJob.deleteMany({
    where: {
      status: { in: ["IDLE", "ERROR"] },
      lastSyncAt: { lt: olderThan },
      ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
    },
  });
  return { scanned: retained.length, deleted: result.count };
}

async function pruneBackup(keepLatest: number, olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  // backup 的 status 是 String 字段, 用字面量比较 (跟 service.ts mapOperationStatus 对齐)
  const retained = await prisma.backupRecord.findMany({
    where: { status: { in: ["COMPLETED", "FAILED"] } },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
    take: keepLatest,
  });
  const retainedIds = retained.map((row) => row.id);
  const result = await prisma.backupRecord.deleteMany({
    where: {
      status: { in: ["COMPLETED", "FAILED"] },
      createdAt: { lt: olderThan },
      ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
    },
  });
  return { scanned: retained.length, deleted: result.count };
}

async function pruneDeployment(keepLatest: number, olderThan: Date): Promise<OperationTaskRetentionPerSourceResult> {
  // DeploymentRun 的 status 也是 String, 终态 = COMPLETED / FAILED / CANCELLED / ROLLED_BACK
  const retained = await prisma.deploymentRun.findMany({
    where: { status: { in: ["COMPLETED", "FAILED", "CANCELLED", "ROLLED_BACK"] } },
    orderBy: [{ createdAt: "desc" }],
    select: { id: true },
    take: keepLatest,
  });
  const retainedIds = retained.map((row) => row.id);
  const result = await prisma.deploymentRun.deleteMany({
    where: {
      status: { in: ["COMPLETED", "FAILED", "CANCELLED", "ROLLED_BACK"] },
      createdAt: { lt: olderThan },
      ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
    },
  });
  return { scanned: retained.length, deleted: result.count };
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
  const durationMs = Date.now() - startedAt;

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
    durationMs,
  };
}
