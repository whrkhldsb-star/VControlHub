/**
 * Permission mapping and server/playbook resolution helpers for AI hosted actions.
 *
 * Extracted from hosted-service.ts so the main module focuses on the action
 * lifecycle (create -> execute -> approve/confirm/reject).
 */

import type { Permission } from "@/lib/auth/rbac";
import type { SessionPayload } from "@/lib/auth/session";
import { playbookTeamWhere, serverTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { escapeLikeLiteral } from "@/lib/db/like-pattern";
import { BusinessError } from "@/lib/errors";
import { t, type Locale } from "@/lib/i18n/service-translations";
import { deserializeDialect } from "@/lib/ssh/os-dialect";
import { COMMAND_REASON_MAX_LENGTH } from "@/lib/command/schema";

import type { HostedActionType, HostedTool } from "./hosted-tools";

export type HostedActionSession = Pick<SessionPayload, "userId" | "roles"> &
  Partial<Pick<SessionPayload, "permissions" | "currentTeamId">>;

export type HostedActionExecutionContext = {
  session: HostedActionSession;
  requiredPermission?: Permission;
  locale?: Locale;
};

export function sessionForTeamScope(
  session?: HostedActionSession | null,
): TeamSession | null {
  if (!session) return null;
  return { ...session, currentTeamId: session.currentTeamId ?? null };
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
  // list_files / search_files / read_file run find/grep/tail on arbitrary
  // absolute paths of the VPS as its SSH user — nothing like the storage nodes
  // that storage:read scopes — so they need the same permission as read_logs.
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
  return t("backend.ai.permissionDenied.required", locale, {
    permission: perm,
  });
}

export const SERVERLESS_ACTION_TYPES = new Set<string>(["list_servers","list_backups","query_traffic","list_scheduled_tasks","manage_cron","list_command_templates","create_automation_task","search_knowledge","run_playbook"]);

const HOSTED_ACTION_TYPES = new Set<HostedActionType>(["list_servers","get_status","read_logs","list_docker_containers","check_service_status","execute_command","restart_service","modify_config","deploy_docker","list_backups","run_playbook","query_traffic","list_scheduled_tasks","manage_cron","list_command_templates","create_automation_task","list_files","search_files","read_file","get_docker_logs","search_knowledge"]);

export function isHostedActionType(actionType: string): actionType is HostedActionType {
  return HOSTED_ACTION_TYPES.has(actionType as HostedActionType);
}

/** Servers named back to the model when a name or address fits several. */
const SERVER_QUERY_CANDIDATES = 6;

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
  // A name or address picks one server or none, as a playbook name does below. It used to take whichever
  // server the database returned first among all that contained the text ("web" with web-1 and web-2, and "%"
  // matched every server), so a status was read from, or a change proposed for, a server nobody had named.
  const select = { id: true, name: true, host: true } as const;
  const exact = await prisma.server.findMany({
    where: { AND: [teamFilter, { OR: [{ id: query }, { name: query }, { host: query }] }] },
    select,
    orderBy: { name: "asc" },
    take: SERVER_QUERY_CANDIDATES,
  });
  if (exact.length === 1) return exact[0]!.id;
  const literal = escapeLikeLiteral(query);
  const candidates = exact.length > 1 ? exact : await prisma.server.findMany({
    where: { AND: [teamFilter, { OR: [{ name: { contains: literal, mode: "insensitive" } }, { host: { contains: literal, mode: "insensitive" } }] }] },
    select,
    orderBy: { name: "asc" },
    take: SERVER_QUERY_CANDIDATES,
  });
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0]!.id;
  // Told to the model, which can then ask the user or pass the id of the one that is meant.
  throw new BusinessError(t("backend.ai.serverQueryAmbiguous", {
    query,
    servers: candidates.map((server) => `${server.name} (${server.host}, id ${server.id})`).join("; "),
  }));
}

export async function resolvePlaybookId(args: Record<string, unknown>, session?: HostedActionSession | null): Promise<{ id: string; name: string } | null> {
  const scope = sessionForTeamScope(session);
  // Strict: the assistant resolves a playbook in order to run it, and a
  // `teamId: null` playbook replays frozen server ids the caller may not own.
  const teamFilter = scope ? playbookTeamWhere(scope) : {};
  const explicitId = typeof args.playbookId === "string" ? args.playbookId.trim() : "";
  if (explicitId) {
    return prisma.playbook.findFirst({ where: { id: explicitId, ...teamFilter }, select: { id: true, name: true } });
  }
  const name = typeof args.playbookName === "string" ? args.playbookName.trim() : "";
  if (!name) return null;
  // A name picks one playbook or none. It used to take the most recently updated of everything that contained the
  // text (and "%" matched them all), so what the user confirmed by name could be another playbook than the one run.
  const select = { id: true, name: true } as const;
  const named = await prisma.playbook.findMany({ where: { AND: [teamFilter, { OR: [{ id: name }, { name }] }] }, select, take: 2 });
  if (named.length > 0) return named.length === 1 ? named[0]! : null;
  const similar = await prisma.playbook.findMany({
    where: { AND: [teamFilter, { name: { contains: escapeLikeLiteral(name) } }] },
    select,
    orderBy: { updatedAt: "desc" },
    take: 2,
  });
  return similar.length === 1 ? similar[0]! : null;
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
  // The model's own words, cut to what a command request takes: a longer reason failed the request after the
  // person had confirmed the action.
  const reason = (typeof input.args.reason === "string" && input.args.reason.trim()
    ? input.args.reason.trim()
    : t("backend.ai.assistantRequestReason")).slice(0, COMMAND_REASON_MAX_LENGTH);
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
