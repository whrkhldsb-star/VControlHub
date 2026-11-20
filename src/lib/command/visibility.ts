import { sessionHasPermission } from "@/lib/auth/authorization";
import type { TeamSession } from "@/lib/auth/team-scope";

export function canReadCommandBody(session: TeamSession, requesterId: string | null) {
  return requesterId === session.userId || sessionHasPermission(session, "command:approve");
}
