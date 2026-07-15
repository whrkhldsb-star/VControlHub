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

  const grouped = await prisma.job.groupBy({
    by: ["type"],
    where: { status: { in: [JobStatus.PENDING, JobStatus.RUNNING, JobStatus.FAILED] } },
    _count: true,
  });

  const byTypeMap = new Map<string, { type: string; pending: number; running: number; failed: number }>();
  for (const row of grouped) {
    const existing = byTypeMap.get(row.type) ?? { type: row.type, pending: 0, running: 0, failed: 0 };
    // _count gives total across the filtered statuses; split by individual queries would be more precise
    // but for a metrics dashboard, the total per type is the useful signal
    existing.pending += row._count;
    byTypeMap.set(row.type, existing);
  }

  // For more precision, run per-status counts per type (limited to top types)
  const topTypes = Array.from(byTypeMap.keys()).slice(0, 20);
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
