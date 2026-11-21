import { sessionHasPermission } from "@/lib/auth/authorization";
import { isGlobalTeamManager, type TeamSession } from "@/lib/auth/team-scope";

type StatusSession = TeamSession & { mustChangePassword?: boolean };

export function canReadInternalStatus(session: StatusSession | null | undefined): session is StatusSession {
	return Boolean(session && !session.mustChangePassword && sessionHasPermission(session, "server:read"));
}

export function canPreviewClosedBoard(session: StatusSession | null | undefined): boolean {
	return canReadInternalStatus(session) && isGlobalTeamManager(session);
}
