import type { SessionPayload } from "@/lib/auth/session";

/**
 * Whether the caller may see how an incident's notifications were delivered: the channels still pending, the last
 * delivery error and who is on call. Those belong to whoever owns the rule. A customer sees incidents on its own
 * servers raised by the platform's fleet-wide rules too, but their delivery state describes the owner's mail
 * server, bot and administrators.
 */
export function canSeeIncidentDelivery(
  session: Pick<SessionPayload, "roles" | "currentTeamId">,
  rule: { teamId: string | null } | null | undefined,
): boolean {
  if (session.roles?.includes("admin")) return true;
  return Boolean(rule?.teamId) && rule?.teamId === session.currentTeamId;
}
