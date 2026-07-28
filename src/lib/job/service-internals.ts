import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { recordJobEvent } from "./events";

const logger = createLogger("job:service");

export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export function futureFrom(now: Date, ms: number) {
  return new Date(now.getTime() + ms);
}

export function safeRecordJobEvent(input: Parameters<typeof recordJobEvent>[0]) {
  recordJobEvent(input).catch((err) => logger.error("recordJobEvent failed", err));
}

/**
 * Transaction-aware variant of {@link safeRecordJobEvent}.
 *
 * When the caller created the job row inside a transaction, the row is not yet
 * visible to other connections, so a fire-and-forget write through the global
 * client fails the `job_events_jobId_fkey` foreign key and the event is lost
 * forever. In that case the event must be written with the same transaction
 * client and awaited before the transaction callback returns (the tx client is
 * unusable afterwards).
 *
 * Outside a transaction we keep the original non-blocking behaviour so the
 * hot enqueue path is not slowed down by the event write.
 */
export async function recordJobEventWithClient(
  input: Parameters<typeof recordJobEvent>[0],
  client: Parameters<typeof recordJobEvent>[1],
) {
  if (!client || client === prisma) {
    safeRecordJobEvent(input);
    return;
  }
  try {
    await recordJobEvent(input, client);
  } catch (err) {
    logger.error("recordJobEvent failed inside transaction", err);
  }
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
