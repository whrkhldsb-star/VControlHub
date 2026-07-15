import { JobStatus } from "@prisma/client";

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

export async function getJobBacklogMetrics(): Promise<JobBacklogMetrics> {
  const now = new Date();

  const [pending, running, expiredLease, failed, completed] = await Promise.all([
    prisma.job.count({ where: { status: JobStatus.PENDING } }),
    prisma.job.count({ where: { status: JobStatus.RUNNING } }),
    prisma.job.count({ where: { status: JobStatus.RUNNING, leaseExpiresAt: { lt: now } } }),
    prisma.job.count({ where: { status: JobStatus.FAILED } }),
    prisma.job.count({ where: { status: JobStatus.COMPLETED } }),
  ]);

  const oldestPending = await prisma.job.findFirst({
    where: { status: JobStatus.PENDING },
    orderBy: { availableAt: "asc" },
    select: { availableAt: true },
  });

  const oldestPendingMs = oldestPending
    ? Math.max(0, now.getTime() - oldestPending.availableAt.getTime())
    : null;

  // Group by type to find the top job types, then run per-status counts for each
  const grouped = await prisma.job.groupBy({
    by: ["type"],
    where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.FAILED] } },
    _count: true,
  });

  const topTypes = grouped.sort((a, b) => b._count - a._count).slice(0, 20).map((r) => r.type);
  const byType: Array<{ type: string; pending: number; running: number; failed: number }> = [];
  for (const type of topTypes) {
    const [p, r, f] = await Promise.all([
      prisma.job.count({ where: { type, status: JobStatus.PENDING } }),
      prisma.job.count({ where: { type, status: JobStatus.RUNNING } }),
      prisma.job.count({ where: { type, status: JobStatus.FAILED } }),
    ]);
    byType.push({ type, pending: p, running: r, failed: f });
  }
  byType.sort((a, b) => (b.pending + b.running + b.failed) - (a.pending + a.running + a.failed));

  const total = pending + running + failed + completed;
  logger.debug("job backlog metrics collected", { pending, running, expiredLease, failed, total });
  return { pending, running, expiredLease, failed, completed, total, oldestPendingMs, byType };
}
