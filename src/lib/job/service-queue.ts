import { JobStatus, Prisma } from "@prisma/client";

import type { RoleKey } from "@/lib/auth/rbac";
import { teamWhere } from "@/lib/auth/team-scope";
import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";

import {
  DEFAULT_LEASE_MS,
  futureFrom,
  recordJobEventWithClient,
  safeRecordJobEvent,
  type ClaimJobOptions,
  type EnqueueJobInput,
} from "./service-internals";

type JobSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };

function sanitizeAttempts(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return config.job.defaultMaxAttempts;
  return Math.max(1, Math.floor(value));
}

export async function enqueueJob(
  input: EnqueueJobInput,
  client: Prisma.TransactionClient | typeof prisma = prisma,
) {
  const job = await client.job.create({
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
  // The event must be written with the SAME client that created the job row.
  // When `client` is a transaction, the job row is invisible to other
  // connections until commit, so a fire-and-forget write through the global
  // prisma client violates `job_events_jobId_fkey` and the "enqueued" event is
  // silently lost (observed on scheduled-task.tick, which enqueues inside a
  // transaction: 4081 jobs but only 1501 enqueued events).
  await recordJobEventWithClient(
    {
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
    },
    client,
  );
  return job;
}

export async function getJob(jobId: string, session?: JobSession | null) {
  if (!session) return prisma.job.findUnique({ where: { id: jobId } });
  const teamScope = teamWhere(session);
  if (Object.keys(teamScope).length === 0) {
    return prisma.job.findUnique({ where: { id: jobId } });
  }
  return prisma.job.findFirst({
    where: { id: jobId, OR: [teamScope, { createdBy: session.userId }] },
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
    if (maxGlobal > 0) {
      const inFlight = await tx.job.count({ where: { status: JobStatus.RUNNING } });
      if (inFlight >= maxGlobal) return null;
    }
    const candidates: Array<NonNullable<Awaited<ReturnType<typeof tx.job.findFirst>>>> = [];
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
        LIMIT 8
      `;
      for (const row of rows) {
        const full = await tx.job.findUnique({ where: { id: row.id } });
        if (full) candidates.push(full);
      }
    } catch {
      const one = await tx.job.findFirst({
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
      if (one) candidates.push(one);
    }

    for (const candidate of candidates) {
      if (maxPerUser > 0 && candidate.createdBy) {
        const inFlightForUser = await tx.job.count({
          where: { status: JobStatus.RUNNING, createdBy: candidate.createdBy },
        });
        if (inFlightForUser >= maxPerUser) continue;
      }
      if (maxPerNode > 0 && candidate.targetStorageNodeId) {
        const inFlightForNode = await tx.job.count({
          where: {
            status: JobStatus.RUNNING,
            targetStorageNodeId: candidate.targetStorageNodeId,
          },
        });
        if (inFlightForNode >= maxPerNode) continue;
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
      if (claimed.count === 0) continue;
      const claimedJob = await tx.job.findUniqueOrThrow({ where: { id: candidate.id } });
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
    }
    return null;
  });
}
