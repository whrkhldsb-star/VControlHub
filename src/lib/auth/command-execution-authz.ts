import { prisma } from "@/lib/db";
import { loadApiTokenOwnerSession } from "@/lib/api-token/authorization";
import { sessionHasPermission } from "@/lib/auth/authorization";

/**
 * Shared live authorization re-check for background workers that execute
 * commands on behalf of a stored `requesterId` with no live session
 * (playbook runs, scheduled-task dispatch, …).
 *
 * A stored requester id is not proof of current privilege: the user may have
 * been disabled, demoted (lost command:execute), put into
 * must-change-password, or removed from the target team since the automation
 * was created. Re-derive everything from the DB at execution time:
 *   1. user exists, is enabled, not in must-change-password
 *      (loadApiTokenOwnerSession returns null otherwise),
 *   2. currently holds command:execute,
 *   3. is a member of the target team (unless team:manage-global).
 *
 * Kept as the single source of truth so the playbook and scheduled-task paths
 * cannot drift apart (they previously had only one of the two guarded).
 */
export async function assertRequesterMayExecuteCommand(
  requesterId: string,
  teamId: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ownerSession = await loadApiTokenOwnerSession(requesterId);
  if (!ownerSession) {
    return { ok: false, reason: "command requester is disabled or no longer valid" };
  }
  if (!sessionHasPermission(ownerSession, "command:execute")) {
    return { ok: false, reason: "command requester lacks command:execute permission" };
  }
  if (teamId) {
    // team:manage (global) members are not bound to per-team membership rows.
    if (!sessionHasPermission(ownerSession, "team:manage")) {
      const membership = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: requesterId } },
        select: { userId: true },
      });
      if (!membership) {
        return { ok: false, reason: "command requester is no longer a member of the target team" };
      }
    }
  }
  return { ok: true };
}
