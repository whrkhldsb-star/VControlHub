import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";
import { DB_UTC_CLOCK_NOW } from "@/lib/db/utc-now";

export type DownloadClaim = { id: string; workerId: string; attempts: number };

export async function lockDownloadClaim(tx: Prisma.TransactionClient, claim?: DownloadClaim) {
  if (!claim) return;
  const owned = await tx.$queryRaw<{ id: string }[]>`
    SELECT id FROM jobs WHERE id = ${claim.id} AND "workerId" = ${claim.workerId}
      AND attempts = ${claim.attempts} AND status = 'RUNNING' AND "leaseExpiresAt" > ${DB_UTC_CLOCK_NOW} FOR UPDATE`;
  if (!owned.length) throw new LeaseLostError(claim.id);
}

/** Lock the attempt and transition the business row before allowing any terminal side effect. */
export function updateClaimedDownload(claim: DownloadClaim | undefined, signal: AbortSignal | undefined, args: Prisma.DownloadTaskUpdateManyArgs) {
  signal?.throwIfAborted();
  if (!claim) return prisma.downloadTask.updateMany(args);
  return prisma.$transaction(async tx => {
    await lockDownloadClaim(tx, claim);
    signal?.throwIfAborted();
    return tx.downloadTask.updateMany(args);
  });
}
