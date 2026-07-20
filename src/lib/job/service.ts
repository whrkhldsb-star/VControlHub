import { JobStatus, Prisma } from "@prisma/client";

import type { RoleKey } from "@/lib/auth/rbac";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";

type JobSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };
import { config } from "@/lib/config/env";
import { createLogger } from "@/lib/logging";
import { recordJobEvent } from "./events";

const logger = createLogger("job:service");

function safeRecordJobEvent(input: Parameters<typeof recordJobEvent>[0]) {
  recordJobEvent(input).catch((err) => logger.error("recordJobEvent failed", err));
}

export type JobPayload = Prisma.InputJsonValue;
export type JobResult = Prisma.InputJsonValue;

export type EnqueueJobInput = {
  type: string;
  title: string;
  payload?: JobPayload;
  createdBy?: string | null;
  teamId?: string | null;
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
      teamId: input.teamId ?? null,
      priority: input.priority ?? 0,
      maxAttempts: sanitizeAttempts(input.maxAttempts),
      availableAt: input.availableAt ?? new Date(),
      targetStorageNodeId: input.targetStorageNodeId ?? null,
    },
  });
  // TR-001 T13a: surface an "enqueued" event so the timeline starts at the
  // moment the job was scheduled (not only when a worker later claims it).
  safeRecordJobEvent({
    jobId: job.id,
    type: "enqueued",
    message: `Task enqueued (type=${job.type}, priority=${job.priority})`,
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

export async function getJob(
  jobId: string,
  session?: JobSession | null,
) {
  if (!session) {
    return prisma.job.findUnique({ where: { id: jobId } });
  }
  const teamScope = teamWhere(session);
  // Admin / unscoped session: full access by id.
  if (Object.keys(teamScope).length === 0) {
    return prisma.job.findUnique({ where: { id: jobId } });
  }
  // Team match (incl. legacy null via teamWhere OR) OR created by self.
  return prisma.job.findFirst({
    where: {
      id: jobId,
      OR: [teamScope, { createdBy: session.userId }],
    },
  });
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

    // Prefer SKIP LOCKED so concurrent claimers do not stampede the same row.
    // Fall back to findFirst if raw SQL is unavailable (tests / non-pg adapters).
    let candidate: Awaited<ReturnType<typeof tx.job.findFirst>> = null;
    try {
      const typeClause =
        options.types && options.types.length > 0
          ? Prisma.sql`AND type IN (${Prisma.join(options.types)})`
          : Prisma.empty;
      const rows = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM jobs
        WHERE attempts < "maxAttempts"
          AND (
            (status = 'PENDING' AND "availableAt" <= ${now})
            OR (status = 'RUNNING' AND "leaseExpiresAt" < ${now})
          )
          ${typeClause}
        ORDER BY priority DESC, "availableAt" ASC, "createdAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      `;
      const id = rows[0]?.id;
      if (id) {
        candidate = await tx.job.findUnique({ where: { id } });
      }
    } catch {
      candidate = await tx.job.findFirst({
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
    }

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
    safeRecordJobEvent({
      jobId: claimedJob.id,
      type: "claimed",
      message: `Background executor ${options.workerId} claimed task`,
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
    safeRecordJobEvent({
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
    safeRecordJobEvent({
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

/**
 * Mark a RUNNING job as FAILED without requeue, even if attempts < maxAttempts.
 * Use for terminal business outcomes (playbook step failed, command FAILED) where
 * retry would re-dispatch side effects.
 */
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
      ...(options.result
        ? { payload: options.result as Prisma.InputJsonValue }
        : {}),
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
    safeRecordJobEvent({
      jobId,
      type: "cancelled",
      message: "Task cancelled",
    });
  }
  return updated;
}

export async function recoverStaleRunningJobs(options: {
  staleBefore: Date;
  retryAfterMs?: number;
  now?: Date;
}): Promise<{ count: number; recovered: string[]; failed: string[] }> {
  const now = options.now ?? new Date();
  const staleWhere = {
    status: JobStatus.RUNNING,
    OR: [
      { leaseExpiresAt: { lt: options.staleBefore } },
      { workerHeartbeatAt: { lt: options.staleBefore } },
    ],
  };

  // Retryable: lease expired and attempts remain → re-queue as PENDING so
  // claimNextJob can pick them up again.
  const retryable = await prisma.job.findMany({
    where: {
      ...staleWhere,
      attempts: { lt: prisma.job.fields.maxAttempts },
    },
    select: { id: true, type: true, title: true, attempts: true, maxAttempts: true },
    take: 1000, // P2: 单次 sweep 的 stale 任务数,>1k 即异常告警
  });

  // Exhausted: lease expired AND attempts already consumed the budget.
  // claimNextJob also filters `attempts < maxAttempts`, so these rows would
  // otherwise stay RUNNING forever and permanently occupy concurrency slots
  // (and leave playbook.run / similar work "running" with no consumer).
  const exhausted = await prisma.job.findMany({
    where: {
      ...staleWhere,
      attempts: { gte: prisma.job.fields.maxAttempts },
    },
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

  let recoveredCount = 0;
  let failedCount = 0;

  if (retryable.length > 0) {
    // CAS: only reclaim if still RUNNING and still stale at update time
    // (late heartbeat/complete from a live worker must win).
    const result = await prisma.job.updateMany({
      where: {
        id: { in: retryable.map((j) => j.id) },
        status: JobStatus.RUNNING,
        OR: [
          { leaseExpiresAt: { lt: options.staleBefore } },
          { workerHeartbeatAt: { lt: options.staleBefore } },
        ],
      },
      data: {
        status: JobStatus.PENDING,
        availableAt: futureFrom(now, options.retryAfterMs ?? 0),
        workerId: null,
        workerHeartbeatAt: null,
        leaseExpiresAt: null,
        errorMessage: "Backend executor heartbeat expired, re-queued",
      },
    });
    recoveredCount = result.count;

    // Surface one "recovered" event per recovered job so the timeline shows
    // the moment the worker regained ownership. Batch-insert instead of
    // sequential create to avoid N round-trips.
    const message = "Background executor heartbeat expired; re-enqueued";
    await prisma.jobEvent
      .createMany({
        data: retryable.map((job) => ({
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
      })
      .catch(() => {
        // Recording must never break the caller's flow (mirrors recordJobEvent's catch).
      });
  }

  if (exhausted.length > 0) {
    const result = await prisma.job.updateMany({
      where: {
        id: { in: exhausted.map((j) => j.id) },
        status: JobStatus.RUNNING,
        OR: [
          { leaseExpiresAt: { lt: options.staleBefore } },
          { workerHeartbeatAt: { lt: options.staleBefore } },
        ],
      },
      data: {
        status: JobStatus.FAILED,
        completedAt: now,
        workerId: null,
        workerHeartbeatAt: null,
        leaseExpiresAt: null,
        errorMessage: "Backend executor heartbeat expired after exhausting attempts",
      },
    });
    failedCount = result.count;

    await prisma.jobEvent
      .createMany({
        data: exhausted.map((job) => ({
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
      })
      .catch(() => {
        // Recording must never break the caller's flow.
      });

    // Best-effort: finalize linked playbook runs that would otherwise stay
    // "running" forever when the parent durable job is terminal-failed.
    const playbookRunIds = exhausted
      .filter((job) => job.type === "playbook.run")
      .map((job) => {
        const payload = job.payload;
        if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
        const runId = (payload as { runId?: unknown }).runId;
        return typeof runId === "string" && runId.trim() ? runId.trim() : null;
      })
      .filter((id): id is string => Boolean(id));

    if (playbookRunIds.length > 0) {
      await prisma.playbookRun
        .updateMany({
          where: { id: { in: playbookRunIds }, status: { in: ["queued", "running"] } },
          data: {
            status: "failed",
            errorMessage: "Parent durable job exhausted attempts after executor heartbeat expired",
            completedAt: now,
          },
        })
        .catch(() => {
          // Domain cleanup is best-effort; job terminal state already committed.
        });
    }
  }

  return {
    count: recoveredCount + failedCount,
    recovered: retryable.map((j) => j.id),
    failed: exhausted.map((j) => j.id),
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
