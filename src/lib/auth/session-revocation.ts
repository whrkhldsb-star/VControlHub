/**
 * Retention for `revoked_session_ids`.
 *
 * A revocation only has to outlive the cookie it names: once that cookie's own
 * `exp` has passed, `verifySessionToken` rejects it as expired without
 * consulting the table. The grace period covers clock skew between the
 * instance running this sweep and the instances still verifying cookies.
 */
import { prisma } from "@/lib/db";

export const REVOCATION_PRUNE_GRACE_MS = 60 * 60_000;

/** Delete revocations whose session expired more than the grace period ago. */
export async function pruneExpiredRevokedSessions(now = new Date()): Promise<{ count: number }> {
  const { count } = await prisma.revokedSession.deleteMany({
    where: { expiresAt: { lt: new Date(now.getTime() - REVOCATION_PRUNE_GRACE_MS) } },
  });
  return { count };
}
