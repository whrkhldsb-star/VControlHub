import { loadApiTokenOwnerSession } from "@/lib/api-token/authorization";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";

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
  serverId?: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const accountSession = await loadApiTokenOwnerSession(requesterId);
  if (!accountSession) {
    return { ok: false, reason: "command requester is disabled or no longer valid" };
  }
  const platformAdmin = sessionHasPermission(accountSession, "team:manage");
  if (!platformAdmin && !teamId) {
    return { ok: false, reason: "command target has no active workspace" };
  }
  const teamSession = platformAdmin ? accountSession : await loadApiTokenOwnerSession(requesterId, teamId!);
  if (!teamSession) {
    return { ok: false, reason: "command requester is no longer a member of the target team" };
  }
  if (!sessionHasPermission(teamSession, "command:execute")) {
    return { ok: false, reason: platformAdmin ? "command requester lacks command:execute permission" : "command requester lacks command:execute permission in the target team" };
  }
  if (serverId && !await prisma.server.findFirst({
    where: { AND: [{ id: serverId, enabled: true }, serverTeamWhere(teamSession, "connect")] },
    select: { id: true },
  })) {
    return { ok: false, reason: "command target is disabled or no longer accessible to the requester" };
  }
  return { ok: true };
}
