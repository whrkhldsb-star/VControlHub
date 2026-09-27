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
 *   3. has the command permission in the target team (unless platform admin).
 *
 * Kept as the single source of truth so the playbook and scheduled-task paths
 * cannot drift apart (they previously had only one of the two guarded).
 */
export async function assertRequesterMayExecuteCommand(
  requesterId: string,
  teamId: string | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const accountSession = await loadApiTokenOwnerSession(requesterId);
  if (!accountSession) {
    return { ok: false, reason: "command requester is disabled or no longer valid" };
  }
  if (sessionHasPermission(accountSession, "team:manage")) {
    return sessionHasPermission(accountSession, "command:execute")
      ? { ok: true }
      : { ok: false, reason: "command requester lacks command:execute permission" };
  }
  if (!teamId) {
    return { ok: false, reason: "command target has no active workspace" };
  }
  const teamSession = await loadApiTokenOwnerSession(requesterId, teamId);
  if (!teamSession) {
    return { ok: false, reason: "command requester is no longer a member of the target team" };
  }
  return sessionHasPermission(teamSession, "command:execute")
    ? { ok: true }
    : { ok: false, reason: "command requester lacks command:execute permission in the target team" };
}
