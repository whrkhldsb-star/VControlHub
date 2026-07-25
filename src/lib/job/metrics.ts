import { JobStatus } from "@prisma/client";

import { teamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";

const logger = createLogger("job:metrics");

export type JobBacklogMetrics = {
  pending: number;
  running: number;
  expiredLease: number;
  failed: number;
  completed: number;
  total: number;
  oldestPendingMs: number | null;
  byType: Array<{ type: string; pending: number; running: number; failed: number }>;
};

/**
 * Aggregate job backlog counters. When `session` is provided, applies
 * {@link teamWhere} so non-global callers only see their team (+ legacy null).
 * Omitting session keeps the previous global view (workers / internal use).
 */
export async function getJobBacklogMetrics(
  session?: TeamSession | null,
): Promise<JobBacklogMetrics> {
  const now = new Date();
  const scope = session ? teamWhere(session) : {};

  const [pending, running, expiredLease, failed, completed] = await Promise.all([
    prisma.job.count({ where: { ...scope, status: JobStatus.PENDING } }),
    prisma.job.count({ where: { ...scope, status: JobStatus.RUNNING } }),
    prisma.job.count({ where: { ...scope, status: JobStatus.RUNNING, leaseExpiresAt: { lt: now } } }),
    prisma.job.count({ where: { ...scope, status: JobStatus.FAILED } }),
    prisma.job.count({ where: { ...scope, status: JobStatus.COMPLETED } }),
  ]);

  const oldestPending = await prisma.job.findFirst({
    where: { ...scope, status: JobStatus.PENDING },
    orderBy: { availableAt: "asc" },
    select: { availableAt: true },
  });

  const oldestPendingMs = oldestPending
    ? Math.max(0, now.getTime() - oldestPending.availableAt.getTime())
    : null;

  // Single groupBy on (type, status) — avoids N×3 count queries for top types.
  const groupedByTypeStatus = await prisma.job.groupBy({
    by: ["type", "status"],
    where: {
      ...scope,
      status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.FAILED] },
    },
    _count: true,
  });

  const byTypeMap = new Map<string, { type: string; pending: number; running: number; failed: number }>();
  for (const row of groupedByTypeStatus) {
    const entry = byTypeMap.get(row.type) ?? { type: row.type, pending: 0, running: 0, failed: 0 };
    if (row.status === JobStatus.PENDING) entry.pending = row._count;
    else if (row.status === JobStatus.RUNNING) entry.running = row._count;
    else if (row.status === JobStatus.FAILED) entry.failed = row._count;
    byTypeMap.set(row.type, entry);
  }
  const byType = Array.from(byTypeMap.values())
    .sort((a, b) => (b.pending + b.running + b.failed) - (a.pending + a.running + a.failed))
    .slice(0, 20);

  const total = pending + running + failed + completed;
  logger.debug("job backlog metrics collected", { pending, running, expiredLease, failed, total });
  return { pending, running, expiredLease, failed, completed, total, oldestPendingMs, byType };
}
