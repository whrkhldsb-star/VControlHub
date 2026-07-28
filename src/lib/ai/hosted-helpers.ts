/**
 * Permission mapping and server/playbook resolution helpers for AI hosted actions.
 *
 * Extracted from hosted-service.ts so the main module focuses on the action
 * lifecycle (create -> execute -> approve/confirm/reject).
 */

import type { Permission, RoleKey } from "@/lib/auth/rbac";
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { deserializeDialect } from "@/lib/ssh/os-dialect";

import type { HostedActionType, HostedTool } from "./hosted-tools";

export type HostedActionSession = {
  userId: string;
  roles: RoleKey[];
  currentTeamId?: string | null;
};

export type HostedActionExecutionContext = {
  session: HostedActionSession;
  requiredPermission?: Permission;
};

export function sessionForTeamScope(
  session?: HostedActionSession | null,
): Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null {
  if (!session) return null;
  return { userId: session.userId, roles: session.roles, currentTeamId: session.currentTeamId ?? null };
}

export function requiredPermissionForAction(actionType: string): Permission {
  if (actionType === "list_servers") return "server:read";
  if (actionType === "list_backups") return "backup:read";
  if (actionType === "run_playbook") return "playbook:run";
  if (actionType === "query_traffic") return "health:read";
  if (actionType === "manage_cron") return "command:create";
  if (actionType === "search_knowledge") return "ai:chat";
  if (actionType === "list_files" || actionType === "search_files" || actionType === "read_file") return "storage:read";
  return "server:ssh";
}

export function permissionDeniedMessage(actionType: string): string {
  const perm = requiredPermissionForAction(actionType);
  if (actionType === "list_servers") return "You do not have server read permission";
  if (actionType === "list_backups") return "You do not have backup read permission";
  if (actionType === "run_playbook") return "You do not have playbook run permission";
  if (actionType === "query_traffic") return "You do not have health/traffic read permission";
  if (actionType === "manage_cron") return "You do not have scheduled-task manage permission (command:create)";
  if (actionType === "search_knowledge") return "You do not have AI chat permission";
  if (actionType === "list_files" || actionType === "search_files" || actionType === "read_file") return "You do not have storage read permission";
  return `You do not have required permission (${perm})`;
}

export const SERVERLESS_ACTION_TYPES = new Set<string>(["list_servers","list_backups","query_traffic","manage_cron","search_knowledge","run_playbook"]);

const HOSTED_ACTION_TYPES = new Set<HostedActionType>(["list_servers","get_status","read_logs","list_docker_containers","check_service_status","execute_command","restart_service","modify_config","deploy_docker","list_backups","run_playbook","query_traffic","manage_cron","list_files","search_files","read_file","get_docker_logs","search_knowledge"]);

export function isHostedActionType(actionType: string): actionType is HostedActionType {
  return HOSTED_ACTION_TYPES.has(actionType as HostedActionType);
}

export async function resolveServerId(args: Record<string, unknown>, session?: HostedActionSession | null): Promise<string | null> {
  const explicitId = typeof args.serverId === "string" ? args.serverId.trim() : "";
  const scope = sessionForTeamScope(session);
  const teamFilter = scope ? teamWhere(scope) : {};
  if (explicitId) {
    const owned = await prisma.server.findFirst({ where: { id: explicitId, ...teamFilter }, select: { id: true } });
    return owned?.id ?? null;
  }
  const query = typeof args.serverQuery === "string" ? args.serverQuery.trim() : "";
  if (!query) return null;
  const server = await prisma.server.findFirst({
    where: { AND: [teamFilter, { OR: [{ id: query }, { name: { contains: query } }, { host: { contains: query } }] }] },
    select: { id: true, name: true, host: true },
  });
  return server?.id ?? null;
}

export async function resolvePlaybookId(args: Record<string, unknown>, session?: HostedActionSession | null): Promise<{ id: string; name: string } | null> {
  const scope = sessionForTeamScope(session);
  const teamFilter = scope ? teamWhere(scope) : {};
  const explicitId = typeof args.playbookId === "string" ? args.playbookId.trim() : "";
  if (explicitId) {
    return prisma.playbook.findFirst({ where: { id: explicitId, ...teamFilter }, select: { id: true, name: true } });
  }
  const name = typeof args.playbookName === "string" ? args.playbookName.trim() : "";
  if (!name) return null;
  return prisma.playbook.findFirst({ where: { AND: [teamFilter, { OR: [{ id: name }, { name: { contains: name } }] }] }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" } });
}

export async function buildAssistantCommandRequestPayload(input: {
  tool: HostedTool; args: Record<string, unknown>; userId: string; serverId: string; teamId?: string | null;
}) {
  const server = await prisma.server.findUnique({ where: { id: input.serverId }, select: { osDialect: true, teamId: true } });
  const dialect = server?.osDialect ? deserializeDialect(server.osDialect) : undefined;
  const { buildCommand } = await import("./hosted-command-builder");
  const command = buildCommand(input.tool.actionType, input.args, dialect);
  if (!command) throw new Error("AI action parameters are invalid; cannot generate a command");
  const reason = typeof input.args.reason === "string" && input.args.reason.trim() ? input.args.reason.trim() : "AI assistant initiated from web session; will execute after manual approval.";
  const teamId = input.teamId !== undefined && input.teamId !== null ? input.teamId : (server?.teamId ?? null);
  return { title: `AI Assistant: ${input.tool.actionName}`, command, reason, requesterId: input.userId, serverIds: [input.serverId], submissionMode: "assistant" as const, teamId };
}
