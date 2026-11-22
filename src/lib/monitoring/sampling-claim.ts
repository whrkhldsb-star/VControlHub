import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";

export type SamplingClaim = { jobId: string; workerId: string; attempts: number; signal: AbortSignal };

export function sampleId(...parts: string[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}

/** Hold the claim row through the short write so a concurrent reclaim serializes with it. */
export async function checkSamplingClaim(tx: Prisma.TransactionClient, claim?: SamplingClaim) {
  if (!claim) return;
  claim.signal.throwIfAborted();
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM jobs WHERE id = ${claim.jobId}
    AND status = 'RUNNING' AND "workerId" = ${claim.workerId} AND attempts = ${claim.attempts}
    AND "leaseExpiresAt" > clock_timestamp() FOR SHARE`;
  if (!rows.length) throw new LeaseLostError(claim.jobId);
  claim.signal.throwIfAborted();
}

export function withSamplingClaim<T>(claim: SamplingClaim | undefined, write: (tx: Prisma.TransactionClient) => Promise<T>, requireTransaction = false) {
  if (!claim && !requireTransaction) return write(prisma);
  return prisma.$transaction(async (tx) => {
    await checkSamplingClaim(tx, claim);
    const result = await write(tx);
    await checkSamplingClaim(tx, claim);
    return result;
  }, { timeout: 30_000 });
}
