import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";

export type DownloadClaim = { id: string; workerId: string; attempts: number };

/** Lock the attempt and transition the business row before allowing any terminal side effect. */
export function updateClaimedDownload(claim: DownloadClaim | undefined, signal: AbortSignal | undefined, args: Prisma.DownloadTaskUpdateManyArgs) {
  signal?.throwIfAborted();
  if (!claim) return prisma.downloadTask.updateMany(args);
  return prisma.$transaction(async tx => {
    const owned = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM jobs WHERE id = ${claim.id} AND "workerId" = ${claim.workerId}
        AND attempts = ${claim.attempts} AND status = 'RUNNING' AND "leaseExpiresAt" > clock_timestamp() FOR UPDATE`;
    if (!owned.length) throw new LeaseLostError(claim.id);
    signal?.throwIfAborted();
    return tx.downloadTask.updateMany(args);
  });
}
