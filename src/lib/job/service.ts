import { JobStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";

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
  if (typeof value !== "number" || !Number.isFinite(value)) return 3;
  return Math.max(1, Math.floor(value));
}

export async function enqueueJob(input: EnqueueJobInput) {
  return prisma.job.create({
    data: {
      type: input.type.trim(),
      title: input.title.trim(),
      payload: input.payload ?? {},
      createdBy: input.createdBy ?? null,
      priority: input.priority ?? 0,
      maxAttempts: sanitizeAttempts(input.maxAttempts),
      availableAt: input.availableAt ?? new Date(),
    },
  });
}

export async function getJob(jobId: string) {
  return prisma.job.findUnique({ where: { id: jobId } });
}

export async function claimNextJob(options: ClaimJobOptions) {
  const now = options.now ?? new Date();
  const leaseExpiresAt = futureFrom(now, options.leaseMs ?? DEFAULT_LEASE_MS);
  const typeFilter = options.types?.length ? { type: { in: options.types } } : {};

  return prisma.$transaction(async (tx) => {
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
    return tx.job.findUniqueOrThrow({ where: { id: candidate.id } });
  });
}

export async function heartbeatJob(jobId: string, workerId: string, options: { leaseMs?: number; progress?: string | null; now?: Date } = {}) {
  const now = options.now ?? new Date();
  return prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING, workerId },
    data: {
      workerHeartbeatAt: now,
      leaseExpiresAt: futureFrom(now, options.leaseMs ?? DEFAULT_LEASE_MS),
      ...(options.progress !== undefined ? { progress: options.progress } : {}),
    },
  });
}

export async function completeJob(jobId: string, workerId: string, result?: JobResult) {
  const now = new Date();
  return prisma.job.updateMany({
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
}

export async function failJob(jobId: string, workerId: string, errorMessage: string, options: { retryAfterMs?: number; now?: Date } = {}) {
  const now = options.now ?? new Date();
  const job = await prisma.job.findUnique({ where: { id: jobId }, select: { attempts: true, maxAttempts: true } });
  if (!job) return { count: 0 };

  const canRetry = job.attempts < job.maxAttempts;
  return prisma.job.updateMany({
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
}

export async function cancelJob(jobId: string) {
  return prisma.job.updateMany({
    where: { id: jobId, status: { in: [JobStatus.PENDING, JobStatus.RUNNING] } },
    data: {
      status: JobStatus.CANCELLED,
      cancelledAt: new Date(),
      workerId: null,
      workerHeartbeatAt: null,
      leaseExpiresAt: null,
    },
  });
}

export async function recoverStaleRunningJobs(options: { staleBefore: Date; retryAfterMs?: number; now?: Date }) {
  const now = options.now ?? new Date();
  return prisma.job.updateMany({
    where: {
      status: JobStatus.RUNNING,
      OR: [{ leaseExpiresAt: { lt: options.staleBefore } }, { workerHeartbeatAt: { lt: options.staleBefore } }],
      attempts: { lt: prisma.job.fields.maxAttempts },
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
