import type { ScheduledTask } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { TeamSession } from "@/lib/auth/team-scope";
import { canReadCommandBody } from "@/lib/command/visibility";

export function projectScheduledTask<T extends Pick<ScheduledTask, "command" | "createdById" | "reason" | "plan" | "verificationCommand" | "rollbackCommand" | "lastResult">>(task: T, session: TeamSession) {
	const canRead = sessionHasPermission(session, "command:read")
		|| (Boolean(session.userId) && task.createdById === session.userId && sessionHasPermission(session, "command:create"));
	if (canRead && canReadCommandBody(session.userId, task.createdById, sessionHasPermission(session, "command:approve"))) return task;
	return { ...task, command: "", reason: null, plan: null, verificationCommand: null, rollbackCommand: null, lastResult: null };
}
