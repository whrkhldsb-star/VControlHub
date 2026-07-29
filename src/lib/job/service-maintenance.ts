import { JobStatus } from "@prisma/client";

import { prisma } from "@/lib/db";
import { t } from "@/lib/i18n/translations";
import { futureFrom, type PruneCompletedJobsByTypeOptions } from "./service-internals";

// Persist stable English machine/audit strings while sourcing them from i18n.
const REQUEUED_ERROR = t("backend.job.executorHeartbeatExpiredRequeued", "en");
const EXHAUSTED_ERROR = t("backend.job.executorHeartbeatExpiredAttemptsExhausted", "en");
const PLAYBOOK_EXHAUSTED_ERROR = t("backend.job.parentDurableJobAttemptsExhausted", "en");

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
  const retryable = await prisma.job.findMany({
    where: { ...staleWhere, attempts: { lt: prisma.job.fields.maxAttempts } },
    select: { id: true, type: true, title: true, attempts: true, maxAttempts: true },
    take: 1000,
  });
  const exhausted = await prisma.job.findMany({
    where: { ...staleWhere, attempts: { gte: prisma.job.fields.maxAttempts } },
    select: {
      id: true,
      type: true,
      title: true,
      attempts: true,
      maxAttempts: true,
      payload: true,
    },
    take: 1000,
  });
  if (retryable.length === 0 && exhausted.length === 0) {
    return { count: 0, recovered: [], failed: [] };
  }
  const recoveredIds: string[] = [];
  const failedIds: string[] = [];
  if (retryable.length > 0) {
    const result = await prisma.job.updateMany({
      where: {
        id: { in: retryable.map((j) => j.id) },
        status: JobStatus.RUNNING,
        OR: [
          { leaseExpiresAt: { lt: options.staleBefore } },
          {
            leaseExpiresAt: null,
            workerHeartbeatAt: { lt: heartbeatStaleBefore },
          },
        ],
      },
      data: {
        status: JobStatus.PENDING,
        availableAt: futureFrom(now, options.retryAfterMs ?? 0),
        workerId: null,
        workerHeartbeatAt: null,
        leaseExpiresAt: null,
        errorMessage: REQUEUED_ERROR,
      },
    });
    if (result.count >= retryable.length) recoveredIds.push(...retryable.map((j) => j.id));
    else if (result.count > 0) {
      const moved = await prisma.job.findMany({
        where: {
          id: { in: retryable.map((j) => j.id) },
          status: JobStatus.PENDING,
          errorMessage: REQUEUED_ERROR,
        },
        select: { id: true },
        take: retryable.length,
      });
      recoveredIds.push(...moved.map((j) => j.id));
    }
    if (recoveredIds.length > 0) {
      const recoveredSet = new Set(recoveredIds);
      await prisma.jobEvent.createMany({
        data: retryable
          .filter((job) => recoveredSet.has(job.id))
          .map((job) => ({
            jobId: job.id,
            type: "recovered",
            level: "warn",
            message: "Background executor heartbeat expired; re-enqueued",
            workerId: null,
            payload: {
              type: job.type,
              title: job.title,
              attempts: job.attempts,
              maxAttempts: job.maxAttempts,
            },
          })),
      }).catch(() => undefined);
    }
  }
  if (exhausted.length > 0) {
    const result = await prisma.job.updateMany({
      where: {
        id: { in: exhausted.map((j) => j.id) },
        status: JobStatus.RUNNING,
        OR: [
          { leaseExpiresAt: { lt: options.staleBefore } },
          {
            leaseExpiresAt: null,
            workerHeartbeatAt: { lt: heartbeatStaleBefore },
          },
        ],
      },
      data: {
        status: JobStatus.FAILED,
        completedAt: now,
        workerId: null,
        workerHeartbeatAt: null,
        leaseExpiresAt: null,
        errorMessage: EXHAUSTED_ERROR,
      },
    });
    if (result.count >= exhausted.length) failedIds.push(...exhausted.map((j) => j.id));
    else if (result.count > 0) {
      const moved = await prisma.job.findMany({
        where: {
          id: { in: exhausted.map((j) => j.id) },
          status: JobStatus.FAILED,
          errorMessage: EXHAUSTED_ERROR,
        },
        select: { id: true },
        take: exhausted.length,
      });
      failedIds.push(...moved.map((j) => j.id));
    }
    if (failedIds.length > 0) {
      const failedSet = new Set(failedIds);
      await prisma.jobEvent.createMany({
        data: exhausted
          .filter((job) => failedSet.has(job.id))
          .map((job) => ({
            jobId: job.id,
            type: "failed",
            level: "error",
            message: "Background executor heartbeat expired after exhausting attempts",
            workerId: null,
            payload: {
              type: job.type,
              title: job.title,
              attempts: job.attempts,
              maxAttempts: job.maxAttempts,
            },
          })),
      }).catch(() => undefined);
      const playbookRunIds = exhausted
        .filter((job) => failedSet.has(job.id) && job.type === "playbook.run")
        .map((job) => {
          const payload = job.payload;
          if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
          const runId = (payload as { runId?: unknown }).runId;
          return typeof runId === "string" && runId.trim() ? runId.trim() : null;
        })
        .filter((id): id is string => Boolean(id));
      if (playbookRunIds.length > 0) {
        await prisma.playbookRun.updateMany({
          where: { id: { in: playbookRunIds }, status: { in: ["queued", "running"] } },
          data: {
            status: "failed",
            errorMessage: PLAYBOOK_EXHAUSTED_ERROR,
            completedAt: now,
          },
        }).catch(() => undefined);
      }
    }
  }
  return {
    count: recoveredIds.length + failedIds.length,
    recovered: recoveredIds,
    failed: failedIds,
  };
}

export async function pruneCompletedJobsByType(options: PruneCompletedJobsByTypeOptions) {
  const type = options.type.trim();
  if (!type) return { count: 0 };
  const keepLatest = Math.max(1, Math.floor(options.keepLatest ?? 25));
  const retained = await prisma.job.findMany({
    where: { type, status: JobStatus.COMPLETED },
    select: { id: true },
    orderBy: [{ completedAt: "desc" }, { createdAt: "desc" }],
    take: keepLatest,
  });
  const retainedIds = retained.map((job) => job.id);
  return prisma.job.deleteMany({
    where: {
      type,
      status: JobStatus.COMPLETED,
      ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
      ...(options.olderThan ? { completedAt: { lt: options.olderThan } } : {}),
    },
  });
}
