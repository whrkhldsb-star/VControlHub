import { serverTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";

export const RECENT_COMMAND_LOG_LIMIT = 3;

export function canReadCommandBody(viewerId: string, requesterId: string | null, canApprove: boolean) {
  return canApprove || requesterId === viewerId;
}

/** ExecutionLog stores a serverId without a Server relation. Check its target
 * in the original request's team, independently of the paginated target preview. */
export async function withVisibleCommandLogs<Request extends {
  id: string;
  teamId: string | null;
  executionLogs: { serverId: string | null }[];
}>(requests: Request[], session?: TeamSession | null): Promise<Request[]> {
  const candidates = requests.flatMap(({ id, teamId, executionLogs }) => {
    const serverIds = (executionLogs ?? []).flatMap(log => log.serverId ? [log.serverId] : []);
    return serverIds.length ? [{ commandRequestId: id, serverId: { in: serverIds }, server: { teamId } }] : [];
  });
  const targets = candidates.length ? await prisma.commandTarget.findMany({
    where: { OR: candidates, ...(session ? { server: serverTeamWhere(session) } : {}) },
    select: { commandRequestId: true, serverId: true },
  }) : [];
  const visibleServers = new Map<string, Set<string>>();
  for (const { commandRequestId, serverId } of targets) {
    const ids = visibleServers.get(commandRequestId) ?? new Set<string>();
    ids.add(serverId);
    visibleServers.set(commandRequestId, ids);
  }

  const allowUnboundLogs = !session || session.roles.includes("admin");
  return requests.map(request => ({
    ...request,
    executionLogs: (request.executionLogs ?? []).filter(log => log.serverId === null
      ? allowUnboundLogs : visibleServers.get(request.id)?.has(log.serverId)),
  }));
}
