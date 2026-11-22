import { sessionHasPermission } from "@/lib/auth/authorization";
import { commandRequestTeamWhere, serverTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";

type Links = { relatedServerId: string | null; relatedCommandId: string | null };

export async function projectTicketLinks<T extends Links>(rows: T[], session: TeamSession) {
  const servers = [...new Set(rows.flatMap(row => row.relatedServerId ? [row.relatedServerId] : []))];
  const commands = [...new Set(rows.flatMap(row => row.relatedCommandId ? [row.relatedCommandId] : []))];
  const [visibleServers, visibleCommands] = await Promise.all([
    servers.length && sessionHasPermission(session, "server:read")
      ? prisma.server.findMany({ where: { id: { in: servers }, ...serverTeamWhere(session) }, select: { id: true } }) : [],
    commands.length && sessionHasPermission(session, "command:read")
      ? prisma.commandRequest.findMany({ where: { id: { in: commands }, ...commandRequestTeamWhere(session) }, select: { id: true } }) : [],
  ]);
  const serverIds = new Set(visibleServers.map(row => row.id));
  const commandIds = new Set(visibleCommands.map(row => row.id));
  return rows.map(row => ({ ...row,
    relatedServerId: row.relatedServerId && serverIds.has(row.relatedServerId) ? row.relatedServerId : null,
    relatedCommandId: row.relatedCommandId && commandIds.has(row.relatedCommandId) ? row.relatedCommandId : null,
  }));
}

export async function projectTicket<T extends Links>(row: T, session: TeamSession) {
  return (await projectTicketLinks([row], session))[0]!;
}
