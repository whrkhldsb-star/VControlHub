import { sessionHasPermission } from "@/lib/auth/authorization";
import { imageTeamWhere, type TeamSession } from "@/lib/auth/team-scope";

export function imageStatisticsWhere(session: TeamSession) {
  const team = imageTeamWhere(session);
  return sessionHasPermission(session, "team:manage") || sessionHasPermission(session, "media:manage")
    ? team : { ...team, userId: session.userId };
}
