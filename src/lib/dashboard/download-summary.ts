import type { SessionPayload } from "@/lib/auth/session";
import { serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";
import { resolveTaskDrive } from "@/lib/downloads/destination";
import { canAccessDownloadTask } from "@/lib/downloads/route-helpers";

const drive = { select: { id: true, basePath: true } } as const;
const PAGE_SIZE = 100;

/** Apply the downloads list's server predicate, selected drive and path ACL before counting. */
export async function downloadSummary(session: SessionPayload, since?: Date) {
  const totals: Record<string, number> = {};
  const days = new Map<string, { completed: number; failed: number; running: number; pending: number }>();
  for (let after: string | undefined; ;) {
    const rows = await prisma.downloadTask.findMany({
      where: {
        ...teamWhere(session), server: serverTeamWhere(session),
        ...(since ? { createdAt: { gte: since } } : {}), ...(after ? { id: { gt: after } } : {}),
      },
      select: {
        id: true, status: true, createdAt: true, agentStorageNodeId: true, directStorageNodeId: true, targetPath: true,
        server: { select: { storageNode: drive, agentFileShares: { select: { node: drive } } } },
      },
      orderBy: { id: "asc" }, take: PAGE_SIZE,
    });
    const allowed = await Promise.all(rows.map((row) => canAccessDownloadTask({ session, task: resolveTaskDrive(row), operation: "read" })));
    for (const [index, row] of rows.entries()) {
      if (!allowed[index]) continue;
      totals[row.status] = (totals[row.status] ?? 0) + 1;
      if (!since) continue;
      const date = appTimeZoneDateKey(row.createdAt);
      const bucket = days.get(date) ?? { completed: 0, failed: 0, running: 0, pending: 0 };
      if (row.status === "COMPLETED") bucket.completed++;
      if (row.status === "FAILED") bucket.failed++;
      if (row.status === "RUNNING") bucket.running++;
      if (row.status === "PENDING") bucket.pending++;
      days.set(date, bucket);
    }
    if (rows.length < PAGE_SIZE) break;
    after = rows[rows.length - 1]!.id;
  }
  return { totals, days: [...days.keys()].sort().map((date) => ({ date, ...days.get(date)! })) };
}
