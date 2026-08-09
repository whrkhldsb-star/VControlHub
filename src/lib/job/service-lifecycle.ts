import { JobStatus, Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import {
  DEFAULT_LEASE_MS,
  futureFrom,
  safeRecordJobEvent,
  type JobResult,
} from "./service-internals";

export async function heartbeatJob(
  jobId: string,
  workerId: string,
  options: { leaseMs?: number; progress?: string | null; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING, workerId },
    data: {
      workerHeartbeatAt: now,
      leaseExpiresAt: futureFrom(now, options.leaseMs ?? DEFAULT_LEASE_MS),
      ...(options.progress !== undefined ? { progress: options.progress } : {}),
    },
  });
  if (result.count > 0 && options.progress) {
    safeRecordJobEvent({ jobId, type: "heartbeat", message: options.progress, workerId });
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
  if (updated.count > 0) {
    safeRecordJobEvent({
      jobId,
      type: "completed",
      message: "Task completed",
      workerId,
      ...(result ? { payload: result as Prisma.InputJsonValue } : {}),
    });
  }
  return updated;
}

export async function failJob(
  jobId: string,
  workerId: string,
  errorMessage: string,
  options: { retryAfterMs?: number; now?: Date } = {},
) {
  const now = options.now ?? new Date();
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    select: { attempts: true, maxAttempts: true },
  });
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
  if (updated.count > 0) {
    safeRecordJobEvent({
      jobId,
      type: canRetry ? "retrying" : "failed",
      message: errorMessage.slice(0, 2000),
      level: canRetry ? "warn" : "error",
      workerId,
      payload: { attempts: job.attempts, maxAttempts: job.maxAttempts },
    });
  }
  return updated;
}

export async function failJobTerminal(
  jobId: string,
  workerId: string,
  errorMessage: string,
  options: { now?: Date; result?: unknown } = {},
) {
  const now = options.now ?? new Date();
  const updated = await prisma.job.updateMany({
    where: { id: jobId, status: JobStatus.RUNNING, workerId },
    data: {
      status: JobStatus.FAILED,
      errorMessage: errorMessage.slice(0, 2000),
      completedAt: now,
      workerId: null,
      workerHeartbeatAt: null,
      leaseExpiresAt: null,
      progress: null,
    },
  });
  if (updated.count > 0) {
    safeRecordJobEvent({
      jobId,
      type: "failed",
      message: errorMessage.slice(0, 2000),
      level: "error",
      workerId,
      ...(options.result ? { payload: options.result as Prisma.InputJsonValue } : {}),
    });
  }
  return updated;
}

export async function cancelJob(
  jobId: string,
  session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
) {
  const now = new Date();
  const updated = await prisma.job.updateMany({
    where: {
      id: jobId,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
      ...teamWhere(session),
    },
    data: {
      status: JobStatus.CANCELLED,
      cancelledAt: now,
      completedAt: now,
      progress: null,
      workerId: null,
      workerHeartbeatAt: null,
      leaseExpiresAt: null,
    },
  });
  if (updated.count > 0) {
    safeRecordJobEvent({ jobId, type: "cancelled", message: "Task cancelled" });
  }
  return updated;
}
