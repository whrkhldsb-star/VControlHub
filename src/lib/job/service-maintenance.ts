import { reconcileTerminalPlaybookJobs } from "@/lib/playbook/service";
import { scrubQuickServiceJobPayloadSecrets } from "@/lib/quick-service/payload-scrub";
import { JobStatus, Prisma } from "@prisma/client";
import { getRuntimeSettingNumberStrict } from "@/lib/runtime-settings/service";

import { prisma } from "@/lib/db";
import { logError } from "@/lib/logging";
import { t } from "@/lib/i18n/service-translations";
import {
  futureFrom,
  type PruneCompletedJobsByTypeOptions,
  type PruneTerminalJobsByTypeOptions,
  type PruneTerminalJobsOptions,
} from "./service-internals";

// Persist stable English machine/audit strings while sourcing them from i18n.
const REQUEUED_ERROR = t("backend.job.executorHeartbeatExpiredRequeued", "en");
const EXHAUSTED_ERROR = t("backend.job.executorHeartbeatExpiredAttemptsExhausted", "en");

export async function recoverStaleRunningJobs(options: {
  staleBefore: Date;
  heartbeatStaleBefore?: Date;
  retryAfterMs?: number;
  now?: Date;
}): Promise<{ count: number; recovered: string[]; failed: string[] }> {
  const now = options.now ?? new Date();
  const heartbeatStaleBefore = options.heartbeatStaleBefore ?? options.staleBefore;
  const staleWhere = {
    status: JobStatus.RUNNING,
    OR: [
      { leaseExpiresAt: { lt: options.staleBefore } },
      {
        leaseExpiresAt: null,
        workerHeartbeatAt: { lt: heartbeatStaleBefore },
      },
    ],
  };
  const selection = { id: true, type: true, title: true, attempts: true, maxAttempts: true } as const;
  const recovered = await prisma.job.updateManyAndReturn({
    where: { ...staleWhere, attempts: { lt: prisma.job.fields.maxAttempts } },
    data: { status: JobStatus.PENDING, availableAt: futureFrom(now, options.retryAfterMs ?? 0),
      workerId: null, workerHeartbeatAt: null, leaseExpiresAt: null, errorMessage: REQUEUED_ERROR },
    select: selection,
  });
  const exhausted = await prisma.$transaction(async tx => {
    const jobs = await tx.job.updateManyAndReturn({
      where: { ...staleWhere, attempts: { gte: tx.job.fields.maxAttempts } },
      data: { status: JobStatus.FAILED, completedAt: now,
        workerId: null, workerHeartbeatAt: null, leaseExpiresAt: null, errorMessage: EXHAUSTED_ERROR },
      select: { ...selection, payload: true },
    });
    for (const job of jobs) {
      if (job.type === "playbook.run") await reconcileTerminalPlaybookJobs(tx, { jobId: job.id });
      if (job.type === "quick_service.lifecycle") await scrubQuickServiceJobPayloadSecrets(job.id, tx);
    }
    return jobs;
  });
  const events = [
    ...recovered.map(job => ({ job, type: "recovered", level: "warn", message: "Background executor heartbeat expired; re-enqueued" })),
    ...exhausted.map(job => ({ job, type: "failed", level: "error", message: "Background executor heartbeat expired after exhausting attempts" })),
  ];
  if (events.length) {
    await prisma.jobEvent.createMany({ data: events.map(({ job, type, level, message }) => ({
      jobId: job.id, type, level, message, workerId: null,
      payload: { type: job.type, title: job.title, attempts: job.attempts, maxAttempts: job.maxAttempts },
    })) }).catch(() => undefined);
  }
  for (const job of exhausted) {
    if (job.type !== "download.execute" || !job.payload || typeof job.payload !== "object" || Array.isArray(job.payload)) continue;
    const taskId = job.payload.taskId;
    if (typeof taskId !== "string") continue;
    try {
      const task = await prisma.downloadTask.findFirst({ where: { id: taskId, status: "RUNNING",
        OR: [{ relayMode: true }, { aria2Gid: { not: null } }, { agentStorageNodeId: { not: null } }] } });
      if (task) {
        const { failRelayTask } = await import("@/lib/downloads/reconcile");
        await failRelayTask(task, EXHAUSTED_ERROR);
      }
    } catch (error) {
      logError(`[DownloadReconcile] Expired job ${job.id} will be retried by the terminal sweep:`, error);
    }
  }
  return {
    count: recovered.length + exhausted.length,
    recovered: recovered.map(job => job.id),
    failed: exhausted.map(job => job.id),
  };
}

/** Take the retention decision and delete candidates in one snapshot of a single source and tenant. */
export function pruneHistoryScope(
  retained: (tx: Prisma.TransactionClient) => Promise<{ id: string }[]>,
  remove: (tx: Prisma.TransactionClient, retainedIds: string[]) => Promise<{ count: number }>,
) {
  return prisma.$transaction(async tx => {
    const ids = (await retained(tx)).map(row => row.id);
    const { count } = await remove(tx, ids);
    return { scanned: ids.length, deleted: count };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}

async function pruneJobsInScope(type: string, status: Prisma.JobWhereInput["status"], keepLatest: number, olderThan?: Date) {
  const result = await pruneHistoryScope(
    tx => tx.job.findMany({
      where: { type, status }, select: { id: true }, take: keepLatest,
      orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    }),
    (tx, retainedIds) => tx.job.deleteMany({ where: { type, status,
      ...(retainedIds.length ? { id: { notIn: retainedIds } } : {}),
      ...(olderThan ? { completedAt: { lt: olderThan } } : {}),
    } }),
  );
  return { count: result.deleted };
}

export async function pruneCompletedJobsByType(options: PruneCompletedJobsByTypeOptions) {
  const type = options.type.trim();
  if (!type) return { count: 0 };
  return pruneJobsInScope(type, JobStatus.COMPLETED, Math.max(1, Math.floor(options.keepLatest ?? 25)), options.olderThan);
}

/**
 * Generalised {@link pruneCompletedJobsByType}: prune a job type's terminal
 * rows (COMPLETED / FAILED / CANCELLED as the caller scopes) down to the
 * newest `keepLatest`. Every terminal writer stamps `completedAt`, so the
 * ordering stays well-defined for mixed status sets.
 *
 * Workers whose job volume is high (command execution, downloads, playbook
 * runs, quick-service lifecycle, sftp sync, file operations, backups, cost
 * snapshots, itsm outbound) call this after each handled job — on both the
 * success and failure path — so their history cannot grow unbounded between
 * maintenance ticks.
 */
export async function pruneTerminalJobsByType(options: PruneTerminalJobsByTypeOptions) {
  const type = options.type.trim();
  const statuses = options.statuses.filter((status) =>
    status === JobStatus.COMPLETED
    || status === JobStatus.FAILED
    || status === JobStatus.CANCELLED,
  );
  if (!type || statuses.length === 0) return { count: 0 };
  const keepLatest = Math.max(1, Math.floor(options.keepLatest ?? 25));
  return pruneJobsInScope(type, { in: statuses }, keepLatest, options.olderThan);
}

/** Default retention for terminal job rows, aligned with pruneJobEvents' 30d window. */
export const TERMINAL_JOB_RETENTION_DAYS = 30;
/** Hard cap on rows deleted per round so one sweep cannot lock the table for minutes. */
export const TERMINAL_JOB_PRUNE_BATCH = 5_000;

/**
 * Fleet-wide sweep of terminal job rows (default: FAILED + CANCELLED older
 * than 30 days, every type). `pruneCompletedJobsByType` / in-worker pruning
 * bounds COMPLETED history for high-frequency types, but FAILED/CANCELLED
 * rows of *any* type — including types whose worker cannot self-prune
 * (command.execution, storage.*, backup.*, itsm.outbound, …) — had no
 * cleanup path at all and grew unbounded.
 *
 * deleteMany has no LIMIT in Prisma, so batches are selected by id first and
 * the delete re-asserts the terminal predicate: a row that transitioned back
 * to PENDING (lease recovery) between the two queries is never deleted.
 */
export async function pruneTerminalJobs(
  options?: PruneTerminalJobsOptions,
): Promise<{ count: number }> {
  const now = options?.now ?? new Date();
  const statuses = options?.statuses ?? [JobStatus.FAILED, JobStatus.CANCELLED];
  if (statuses.length === 0) return { count: 0 };
  const retentionDays = await getRuntimeSettingNumberStrict("retention.terminalJobsDays");
  const olderThan =
    options?.olderThan ??
    new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const batchSize = Math.min(Math.max(options?.batchSize ?? TERMINAL_JOB_PRUNE_BATCH, 1), TERMINAL_JOB_PRUNE_BATCH);
  const where = {
    status: { in: statuses },
    updatedAt: { lt: olderThan },
  };
  let count = 0;
  for (;;) {
    const batch = await prisma.job.findMany({
      where,
      select: { id: true },
      orderBy: { updatedAt: "asc" },
      take: batchSize,
    });
    if (batch.length === 0) break;
    const deleted = await prisma.job.deleteMany({
      where: {
        ...where,
        id: { in: batch.map((job) => job.id) },
      },
    });
    count += deleted.count;
    if (batch.length < batchSize) break;
  }
  return { count };
}
