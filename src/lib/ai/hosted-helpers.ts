/**
 * Permission mapping and server/playbook resolution helpers for AI hosted actions.
 *
 * Extracted from hosted-service.ts so the main module focuses on the action
 * lifecycle (create -> execute -> approve/confirm/reject).
 */

import type { Permission, RoleKey } from "@/lib/auth/rbac";
import type { SessionPayload } from "@/lib/auth/session";
import { serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { t, type Locale } from "@/lib/i18n/service-translations";
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
  locale?: Locale;
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
  if (actionType === "list_scheduled_tasks") return "command:read";
  if (actionType === "list_command_templates") return "command:read";
  if (actionType === "create_automation_task") return "command:create";
  if (actionType === "manage_cron") return "command:create";
  if (actionType === "search_knowledge") return "ai:chat";
  if (actionType === "list_files" || actionType === "search_files" || actionType === "read_file") return "storage:read";
  return "server:ssh";
}

export function permissionDeniedMessage(
  actionType: string,
  locale: Locale = "zh",
): string {
  const perm = requiredPermissionForAction(actionType);
  if (actionType === "list_servers")
    return t("backend.ai.permissionDenied.serverRead", locale);
  if (actionType === "list_backups")
    return t("backend.ai.permissionDenied.backupRead", locale);
  if (actionType === "run_playbook")
    return t("backend.ai.permissionDenied.playbookRun", locale);
  if (actionType === "query_traffic")
    return t("backend.ai.permissionDenied.healthRead", locale);
  if (actionType === "list_scheduled_tasks" || actionType === "manage_cron")
    return t("backend.ai.permissionDenied.scheduledTaskManage", locale);
  if (actionType === "search_knowledge")
    return t("backend.ai.permissionDenied.aiChat", locale);
  if (
    actionType === "list_files" ||
    actionType === "search_files" ||
    actionType === "read_file"
  )
    return t("backend.ai.permissionDenied.storageRead", locale);
  return t("backend.ai.permissionDenied.required", locale, {
    permission: perm,
  });
}

export const SERVERLESS_ACTION_TYPES = new Set<string>(["list_servers","list_backups","query_traffic","list_scheduled_tasks","manage_cron","list_command_templates","create_automation_task","search_knowledge","run_playbook"]);

const HOSTED_ACTION_TYPES = new Set<HostedActionType>(["list_servers","get_status","read_logs","list_docker_containers","check_service_status","execute_command","restart_service","modify_config","deploy_docker","list_backups","run_playbook","query_traffic","list_scheduled_tasks","manage_cron","list_command_templates","create_automation_task","list_files","search_files","read_file","get_docker_logs","search_knowledge"]);

export function isHostedActionType(actionType: string): actionType is HostedActionType {
  return HOSTED_ACTION_TYPES.has(actionType as HostedActionType);
}

export async function resolveServerId(args: Record<string, unknown>, session?: HostedActionSession | null): Promise<string | null> {
  const explicitId = typeof args.serverId === "string" ? args.serverId.trim() : "";
  const scope = sessionForTeamScope(session);
  const teamFilter = scope ? serverTeamWhere(scope) : { teamId: null };
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
  tool: HostedTool;
  args: Record<string, unknown>;
  userId: string;
  serverId: string;
  teamId?: string | null;
}) {
  const server = await prisma.server.findFirst({
    where: { id: input.serverId, teamId: input.teamId ?? null },
    select: { osDialect: true, teamId: true },
  });
  if (!server) throw new Error(t("backend.ai.serverNotFoundOrOutsideTeamScope"));
  const dialect = server.osDialect ? deserializeDialect(server.osDialect) : undefined;
  const { buildCommand } = await import("./hosted-command-builder");
  const command = buildCommand(input.tool.actionType, input.args, dialect);
  if (!command) throw new Error(t("backend.ai.invalidActionParameters"));
  const reason = typeof input.args.reason === "string" && input.args.reason.trim()
    ? input.args.reason.trim()
    : t("backend.ai.assistantRequestReason");
  const teamId = input.teamId ?? server.teamId;
  return {
    title: t("backend.ai.assistantRequestTitle", {
      action: input.tool.actionName,
    }),
    command,
    reason,
    requesterId: input.userId,
    serverIds: [input.serverId],
    submissionMode: "assistant" as const,
    teamId,
  };
}
