import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const logger = createLogger("job-events");

/**
 * TR-001 T13a: append-only event stream for the durable job workers.
 *
 * The events service is the single sink for everything that happens to a
 * durable job — claim, heartbeat, progress, completion, failure, recovery.
 * The operation-tasks center reads from here when the user opens the
 * "view events" dialog on a job row.
 *
 * Recording is best-effort: a failure to persist an event must not break the
 * surrounding business logic. The helper catches errors, logs them, and lets
 * the caller continue.
 */

export type JobEventType =
  | "enqueued"
  | "claimed"
  | "heartbeat"
  | "progress"
  | "completed"
  | "failed"
  | "retrying"
  | "recovered"
  | "cancelled";

export type JobEventLevel = "info" | "warn" | "error";

export type JobEvent = {
  id: string;
  jobId: string;
  type: string;
  level: string;
  message: string;
  workerId: string | null;
  payload: Prisma.JsonValue | null;
  createdAt: Date;
};

export type RecordJobEventInput = {
  jobId: string;
  type: JobEventType | string;
  message: string;
  level?: JobEventLevel;
  workerId?: string | null;
  payload?: Prisma.InputJsonValue;
};

export type ListJobEventsOptions = {
  jobId: string;
  limit?: number;
  beforeId?: string;
};

export type PruneJobEventsOptions = {
  jobId?: string;
  keepLatest?: number;
  olderThan?: Date;
};

const DEFAULT_LIST_LIMIT = 100;
const MAX_LIST_LIMIT = 500;
const DEFAULT_KEEP_LATEST = 200;

function normalizeLimit(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_LIST_LIMIT;
  return Math.max(1, Math.min(MAX_LIST_LIMIT, Math.floor(value)));
}

function normalizeKeepLatest(value: number | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return DEFAULT_KEEP_LATEST;
  return Math.max(1, Math.floor(value));
}

export async function recordJobEvent(input: RecordJobEventInput): Promise<JobEvent | null> {
  if (!input.jobId || !input.type || !input.message) return null;
  try {
    const row = await prisma.jobEvent.create({
      data: {
        jobId: input.jobId,
        type: input.type,
        level: input.level ?? "info",
        message: input.message.slice(0, 2000),
        workerId: input.workerId ?? null,
        payload: input.payload ?? Prisma.JsonNull,
      },
    });
    return {
      id: row.id,
      jobId: row.jobId,
      type: row.type,
      level: row.level,
      message: row.message,
      workerId: row.workerId,
      payload: row.payload ?? null,
      createdAt: row.createdAt,
    };
  } catch (error) {
    // Recording must never break the caller's flow. A failed event write
    // usually means the job row was deleted (CASCADE) or a transient Prisma
    // hiccup; either way, the durable job state is the source of truth.
    logger.warn("failed to record job event", {
      jobId: input.jobId,
      type: input.type,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

export async function listJobEvents(options: ListJobEventsOptions): Promise<JobEvent[]> {
  const limit = normalizeLimit(options.limit);
  return prisma.jobEvent.findMany({
    where: {
      jobId: options.jobId,
      ...(options.beforeId ? { id: { lt: options.beforeId } } : {}),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}

export async function pruneJobEvents(options: PruneJobEventsOptions = {}) {
  const keepLatest = normalizeKeepLatest(options.keepLatest);
  const retained = await prisma.jobEvent.findMany({
    where: options.jobId ? { jobId: options.jobId } : {},
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: keepLatest,
    select: { id: true },
  });
  const retainedIds = retained.map((event) => event.id);
  return prisma.jobEvent.deleteMany({
    where: {
      ...(options.jobId ? { jobId: options.jobId } : {}),
      ...(retainedIds.length > 0 ? { id: { notIn: retainedIds } } : {}),
      ...(options.olderThan ? { createdAt: { lt: options.olderThan } } : {}),
    },
  });
}
