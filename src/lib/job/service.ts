import { JobStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { config } from "@/lib/config/env";

import { recordJobEvent } from "./events";

export type JobPayload = Prisma.InputJsonValue;
export type JobResult = Prisma.InputJsonValue;

export type EnqueueJobInput = {
  type: string;
  title: string;
  payload?: JobPayload;
  createdBy?: string | null;
  priority?: number;
  maxAttempts?: number;
  availableAt?: Date;
  /**
   * TR-001 T13b: optional storage-node target for the per-node concurrency
   * cap. Only command + download enqueue paths set this today; jobs
   * without a node (alert.evaluate, scheduled-task.tick, quick-service
   * lifecycle, etc.) leave it null and skip the per-node check entirely.
   */
  targetStorageNodeId?: string | null;
};

export type ClaimJobOptions = {
  workerId: string;
  types?: string[];
  leaseMs?: number;
  now?: Date;
};

export type PruneCompletedJobsByTypeOptions = {
  type: string;
  keepLatest?: number;
  olderThan?: Date;
};

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

function futureFrom(now: Date, ms: number) {
  return new Date(now.getTime() + ms);
}

function sanitizeAttempts(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return config.job.defaultMaxAttempts;
  return Math.max(1, Math.floor(value));
}

export async function enqueueJob(input: EnqueueJobInput) {
  const job = await prisma.job.create({
    data: {
      type: input.type.trim(),
      title: input.title.trim(),
      payload: input.payload ?? {},
      createdBy: input.createdBy ?? null,
      priority: input.priority ?? 0,
      maxAttempts: sanitizeAttempts(input.maxAttempts),
      availableAt: input.availableAt ?? new Date(),
      targetStorageNodeId: input.targetStorageNodeId ?? null,
    },
  });
  // TR-001 T13a: surface an "enqueued" event so the timeline starts at the
  // moment the job was scheduled (not only when a worker later claims it).
  void recordJobEvent({
    jobId: job.id,
    type: "enqueued",
    message: `任务入队 (type=${job.type}, priority=${job.priority})`,
    level: "info",
    workerId: null,
    payload: {
      type: job.type,
      title: job.title,
      priority: job.priority,
      createdBy: job.createdBy,
    },
  });
  return job;
}

export async function getJob(jobId: string) {
  return prisma.job.findUnique({ where: { id: jobId } });
}

export async function claimNextJob(options: ClaimJobOptions) {
  const now = options.now ?? new Date();
  const leaseExpiresAt = futureFrom(now, options.leaseMs ?? DEFAULT_LEASE_MS);
  const typeFilter = options.types?.length ? { type: { in: options.types } } : {};
  const maxGlobal = config.job.maxConcurrentGlobal;
  const maxPerUser = config.job.maxConcurrentPerUser;
  const maxPerNode = config.job.maxConcurrentPerNode;

  return prisma.$transaction(async (tx) => {
    // TR-001 T13b: soft guard for the global in-flight cap. We count inside
    // the same transaction as the claim so a freshly-completed job becomes
    // a "free slot" only after `completeJob` commits — but two workers that
    // start their claim at the same instant can each see a count of
    // `cap - 1` and both claim, briefly overshooting the cap by one. The
    // trade-off is intentional: a strict lock would serialise every claim
    // across the entire cluster for a cap that is supposed to be a safety
    // valve, not a hard quota. If we ever need a hard quota, swap the
    // count for a `SELECT ... FOR UPDATE` on a dedicated "slots" table.
    if (maxGlobal > 0) {
      const inFlight = await tx.job.count({ where: { status: JobStatus.RUNNING } });
      if (inFlight >= maxGlobal) return null;
    }

    const candidate = await tx.job.findFirst({
      where: {
        ...typeFilter,
        OR: [
          { status: JobStatus.PENDING, availableAt: { lte: now } },
          { status: JobStatus.RUNNING, leaseExpiresAt: { lt: now } },
        ],
        attempts: { lt: prisma.job.fields.maxAttempts },
      },
      orderBy: [{ priority: "desc" }, { availableAt: "asc" }, { createdAt: "asc" }],
    });

    if (!candidate) return null;

    // Per-user cap: skip the check when the candidate has no `createdBy`
    // (system jobs like alert.evaluate, scheduled-task.tick) — they have
    // no single user to charge the slot against, so the global cap is
    // the only one that applies.
    if (maxPerUser > 0 && candidate.createdBy) {
      const inFlightForUser = await tx.job.count({
        where: { status: JobStatus.RUNNING, createdBy: candidate.createdBy },
      });
      if (inFlightForUser >= maxPerUser) return null;
    }

    // Per-node cap: same skip-rule for jobs without a node target. The
    // `@@index([targetStorageNodeId, status])` migration keeps this count
    // query sub-millisecond even when the jobs table is large.
    if (maxPerNode > 0 && candidate.targetStorageNodeId) {
      const inFlightForNode = await tx.job.count({
        where: {
          status: JobStatus.RUNNING,
          targetStorageNodeId: candidate.targetStorageNodeId,
        },
      });
      if (inFlightForNode >= maxPerNode) return null;
    }

    const claimed = await tx.job.updateMany({
      where: {
        id: candidate.id,
        OR: [
          { status: JobStatus.PENDING, availableAt: { lte: now } },
          { status: JobStatus.RUNNING, leaseExpiresAt: { lt: now } },
        ],
      },
      data: {
        status: JobStatus.RUNNING,
        attempts: { increment: 1 },
        startedAt: candidate.startedAt ?? now,
        workerId: options.workerId,
        workerHeartbeatAt: now,
        leaseExpiresAt,
        errorMessage: null,
      },
    });

    if (claimed.count === 0) return null;
    const claimedJob = await tx.job.findUniqueOrThrow({ where: { id: candidate.id } });

    // TR-001 T13a: persist a "claimed" event so the operation-tasks center can
    // surface when a worker picked up the job. Recorded outside the transaction
    // so an event-write failure can't roll back the actual claim.
    void recordJobEvent({
      jobId: claimedJob.id,
      type: "claimed",
      message: `后台执行器 ${options.workerId} 认领任务`,
      workerId: options.workerId,
      payload: {
        type: claimedJob.type,
        title: claimedJob.title,
        priority: claimedJob.priority,
        attempts: claimedJob.attempts,
      },
    });

    return claimedJob;
  });
}

export async function heartbeatJob(jobId: string, workerId: string, options: { leaseMs?: number; progress?: string | null; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING, workerId },
    data: {
      workerHeartbeatAt: now,
      leaseExpiresAt: futureFrom(now, options.leaseMs ?? DEFAULT_LEASE_MS),
      ...(options.progress !== undefined ? { progress: options.progress } : {}),
    },
  });
  // TR-001 T13a: only emit a heartbeat event when the caller actually changed
  // the progress string — silent lease extensions (the common case) stay quiet
  // to avoid burying the timeline under duplicate rows.
  if (result.count > 0 && options.progress) {
    void recordJobEvent({
      jobId,
      type: "heartbeat",
      message: options.progress,
      workerId,
    });
  }
  return result;
}

export async function completeJob(jobId: string, workerId: string, result?: JobResult) {
  const now = new Date();
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING, workerId },
    data: {
      status: JobStatus.COMPLETED,
      result: result ?? Prisma.JsonNull,
      completedAt: now,
      workerHeartbeatAt: now,
      leaseExpiresAt: null,
      progress: "100%",
    },
  });
  // TR-001 T13a: surface a "completed" event for the timeline.
  if (updated.count > 0) {
    void recordJobEvent({
      jobId,
      type: "completed",
      message: "任务已完成",
      workerId,
      ...(result ? { payload: result as Prisma.InputJsonValue } : {}),
    });
  }
  return updated;
}

export async function failJob(jobId: string, workerId: string, errorMessage: string, options: { retryAfterMs?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { attempts: true, maxAttempts: true } });
  if (!job) return { count: 0 };

  const canRetry = job.attempts < job.maxAttempts;
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING, workerId },
    data: {
      status: canRetry ? JobStatus.PENDING : JobStatus.FAILED,
      errorMessage,
      availableAt: canRetry ? futureFrom(now, options.retryAfterMs ?? 30_000) : undefined,
      completedAt: canRetry ? null : now,
      workerId: null,
      workerHeartbeatAt: null,
      leaseExpiresAt: null,
    },
  });
  // TR-001 T13a: surface a "failed" / "retrying" event for the timeline.
  if (updated.count > 0) {
    void recordJobEvent({
      jobId,
      type: canRetry ? "retrying" : "failed",
      message: errorMessage.slice(0, 2000),
      level: canRetry ? "warn" : "error",
      workerId,
      payload: {
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      },
    });
  }
  return updated;
}

export async function cancelJob(jobId: string) {
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
    data: {
      status: JobStatus.CANCELLED,
      cancelledAt: new Date(),
      workerId: null,
      workerHeartbeatAt: null,
      leaseExpiresAt: null,
    },
  });
  // TR-001 T13a: surface a "cancelled" event when the cancellation actually
  // moved the row out of PENDING/RUNNING.
  if (updated.count > 0) {
    void recordJobEvent({
      jobId,
      type: "cancelled",
      message: "任务已取消",
    });
  }
  return updated;
}

export async function recoverStaleRunningJobs(options: { staleBefore: Date; retryAfterMs?: number; now?: Date }) {
  const now = options.now ?? new Date();
  // TR-001 T13a: find stale jobs first so we can emit a "recovered" event per
  // job after the update commits (updateMany doesn't return rows).
  const staleJobs = await prisma.job.findMany({
    where: {
      status: JobStatus.RUNNING,
      OR: [{ leaseExpiresAt: { lt: options.staleBefore } }, { workerHeartbeatAt: { lt: options.staleBefore } }],
      attempts: { lt: prisma.job.fields.maxAttempts },
    },
    select: { id: true, type: true, title: true, attempts: true, maxAttempts: true },
    take: 1000, // P2: 单次 sweep 的 stale 任务数,>1k 即异常告警
  });
  if (staleJobs.length === 0) return { count: 0, recovered: [] };

  const result = await prisma.job.updateMany({
    where: {
      id: { in: staleJobs.map((j) => j.id) },
      status: JobStatus.RUNNING,
    },
    data: {
      status: JobStatus.PENDING,
      availableAt: futureFrom(now, options.retryAfterMs ?? 0),
      workerId: null,
      workerHeartbeatAt: null,
      leaseExpiresAt: null,
      errorMessage: "后台执行器心跳过期，已重新入队",
    },
  });

  // Surface one "recovered" event per recovered job so the timeline shows
  // the moment the worker regained ownership. Batch-insert instead of
  // sequential create to avoid N round-trips.
  const message = "后台执行器心跳过期，已重新入队";
  await prisma.jobEvent.createMany({
    data: staleJobs.map((job) => ({
      jobId: job.id,
      type: "recovered",
      level: "warn",
      message,
      workerId: null,
      payload: {
        type: job.type,
        title: job.title,
        attempts: job.attempts,
        maxAttempts: job.maxAttempts,
      },
    })),
  }).catch(() => {
    // Recording must never break the caller's flow (mirrors recordJobEvent's catch).
  });

  return { count: result.count, recovered: staleJobs.map((j) => j.id) };
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
