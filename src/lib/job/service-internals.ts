import { Prisma } from "@prisma/client";

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
