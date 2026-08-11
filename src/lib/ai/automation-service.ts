import { z } from "zod";

import { sessionHasPermission } from "@/lib/auth/authorization";
import { serverTeamWhere } from "@/lib/auth/team-scope";
import { createCommandRequest } from "@/lib/command/service";
import {
  commandTemplateScopeWhere,
  extractTemplateVariables,
  renderCommand,
} from "@/lib/command-template/service";
import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, ValidationError } from "@/lib/errors";
import { serviceT } from "@/lib/i18n/service-locale";
import { createScheduledTask } from "@/lib/scheduled-task/service";

import type { HostedActionSession } from "./hosted-helpers";

function createAutomationSchema(
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  return z.object({
  name: z.string().trim().min(1).max(200),
  plan: z.string().trim().min(1).max(10_000),
  reason: z.string().trim().min(1).max(2_000),
  executionMode: z.enum(["now", "once", "daily"]),
  targetScope: z.enum(["all", "selected"]),
  serverIds: z.array(z.string().trim().min(1)).max(500).optional(),
  templateId: z.string().trim().min(1).nullable().optional(),
  templateName: z.string().trim().min(1).nullable().optional(),
  variables: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  command: z.string().trim().min(1).max(10_000).optional(),
  verificationCommand: z.string().trim().max(10_000).nullable().optional(),
  rollbackCommand: z.string().trim().max(10_000).nullable().optional(),
  runAt: z.string().trim().optional(),
  dailyTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional(),
  approvalMode: z.enum(["approve_once", "every_run"]),
  }).superRefine((value, ctx) => {
  if (value.targetScope === "selected" && !value.serverIds?.length) {
    ctx.addIssue({ code: "custom", path: ["serverIds"], message: t("backend.ai.automationSelectedScopeRequiresTargets") });
  }
  if (!value.templateId && !value.templateName && !value.command) {
    ctx.addIssue({ code: "custom", path: ["command"], message: t("backend.ai.automationTemplateOrCommandRequired") });
  }
  if (value.executionMode === "once" && !value.runAt) {
    ctx.addIssue({ code: "custom", path: ["runAt"], message: t("backend.ai.automationRunAtRequired") });
  }
  if (value.executionMode === "daily" && !value.dailyTime) {
    ctx.addIssue({ code: "custom", path: ["dailyTime"], message: t("backend.ai.automationDailyTimeRequired") });
  }
  });
}

function unique(values: string[]) {
  return [...new Set(values)];
}

function validateBuiltinVariables(
  template: { isBuiltin?: boolean; name: string; variables: string[] } | null,
  variables: Record<string, string>,
  t: (key: string, vars?: Record<string, string | number>) => string,
) {
  if (!template?.isBuiltin) return;
  for (const [name, value] of Object.entries(variables)) {
    if (["days", "count", "port"].includes(name) && !/^\d{1,6}$/.test(value)) {
      throw new ValidationError(t("backend.ai.automationVariableNumeric", { name }));
    }
    if (["service", "container"].includes(name) && !/^[A-Za-z0-9_.@-]+$/.test(value)) {
      throw new ValidationError(t("backend.ai.automationVariableUnsupported", { name }));
    }
    if (name === "project_dir" && (!/^\/[A-Za-z0-9_./-]+$/.test(value) || value.split("/").includes(".."))) {
      throw new ValidationError(t("backend.ai.automationProjectDirSafe"));
    }
  }
  if (variables.public_key !== undefined) {
    const key = variables.public_key ?? "";
    if (!/^(ssh-(rsa|ed25519)|ecdsa-sha2-nistp\d+|sk-(ssh-ed25519|ecdsa-sha2-nistp256)@openssh\.com) [A-Za-z0-9+/=]+(?: [^\r\n]+)?$/.test(key)) {
      throw new ValidationError(t("backend.ai.automationPublicKeyValid"));
    }
  }
}

export async function materializeAutomationProposal(
  raw: Record<string, unknown>,
  actor: HostedActionSession,
) {
  const t = await serviceT();
  const input = createAutomationSchema(t).parse(raw);
	const session = { userId: actor.userId, roles: actor.roles, currentTeamId: actor.currentTeamId ?? null };
  if (!sessionHasPermission(actor, "command:create")) {
    throw new ForbiddenError(t("backend.ai.missingPermissionCommandCreate"));
  }
  if (!sessionHasPermission(actor, "server:ssh")) {
    throw new ForbiddenError(t("backend.ai.missingPermissionServerSsh"));
  }
  if (input.approvalMode === "approve_once" && !sessionHasPermission(actor, "command:approve")) {
    throw new ForbiddenError(t("backend.ai.automationUnattendedRequiresApprove"));
  }

  const templateId = input.templateId ?? undefined;
  const templateName = input.templateName ?? undefined;
  const template = templateId || templateName
    ? await prisma.commandTemplate.findFirst({
        where: {
		  ...commandTemplateScopeWhere(session),
          ...(templateId
            ? { id: templateId }
            : { name: { equals: templateName!, mode: "insensitive" } }),
        },
      })
    : null;
  if ((templateId || templateName) && !template) {
    throw new BusinessError(t("backend.ai.automationTemplateNotFound"));
  }

  const variables = Object.fromEntries(
    Object.entries(input.variables ?? {}).map(([key, value]) => [key, String(value)]),
  );
  const templateCommand = template?.command ?? input.command!;
  const requiredVariables = extractTemplateVariables(templateCommand, template?.rollbackCommand);
  const missingVariables = requiredVariables.filter((name) => variables[name] === undefined);
  if (missingVariables.length) {
    throw new ValidationError(t("backend.ai.automationMissingVariables", {
      variables: missingVariables.join(", "),
    }));
  }
	validateBuiltinVariables(template, variables, t);
  const command = renderCommand(templateCommand, variables);
  const rollbackCommand = input.rollbackCommand
    ?? (template?.rollbackCommand ? renderCommand(template.rollbackCommand, variables) : undefined);
  if (/\{\{\w+\}\}/.test(command) || (rollbackCommand && /\{\{\w+\}\}/.test(rollbackCommand))) {
    throw new ValidationError(t("backend.ai.automationUnresolvedVariables"));
  }

  const requestedIds = unique(input.serverIds ?? []);
  const servers = await prisma.server.findMany({
    where: {
      enabled: true,
	  ...serverTeamWhere(session),
      ...(input.targetScope === "selected" ? { id: { in: requestedIds } } : {}),
    },
    select: { id: true, name: true, host: true, teamId: true },
    orderBy: { name: "asc" },
    take: 500,
  });
  if (!servers.length) throw new BusinessError(t("backend.ai.automationNoEnabledTargets"));
  if (input.targetScope === "selected" && servers.length !== requestedIds.length) {
    throw new BusinessError(t("backend.ai.automationSelectedTargetsUnavailable"));
  }
  const teamIds = unique(servers.map((server) => server.teamId ?? ""));
  if (teamIds.length !== 1) {
    throw new BusinessError(t("backend.ai.automationSingleWorkspace"));
  }

  return {
    ...input,
    command,
    rollbackCommand: rollbackCommand ?? null,
    verificationCommand: input.verificationCommand ?? null,
    templateId: template?.id ?? null,
    templateName: template?.name ?? null,
    serverIds: servers.map((server) => server.id),
    servers: servers.map(({ id, name, host }) => ({ id, name, host })),
    teamId: servers[0]!.teamId,
    approvalRequired: input.approvalMode === "every_run",
    timeZone: "UTC",
  };
}

export async function executeAutomationProposal(
  raw: Record<string, unknown>,
  actor: HostedActionSession,
  hostedActionId: string,
) {
  const proposal = await materializeAutomationProposal(raw, actor);
	const session = { userId: actor.userId, roles: actor.roles, currentTeamId: actor.currentTeamId ?? null };
  if (proposal.executionMode === "now") {
    const request = await createCommandRequest({
      title: `AI automation: ${proposal.name}`,
      command: proposal.command,
      reason: proposal.reason,
      requesterId: actor.userId,
      serverIds: proposal.serverIds,
      submissionMode: "assistant",
      approvalRequired: proposal.approvalRequired,
      teamId: proposal.teamId,
      idempotencyKey: `ai-automation:${hostedActionId}`,
    }, session);
    return {
      kind: "command_request",
      commandRequestId: request.id,
      requiresApproval: request.requiresApproval,
      targetCount: proposal.serverIds.length,
      command: proposal.command,
    };
  }

  const [hour, minute] = proposal.dailyTime?.split(":") ?? [];
  const task = await createScheduledTask({
    name: proposal.name,
    scheduleType: proposal.executionMode === "once" ? "ONCE" : "CRON",
    runAt: proposal.executionMode === "once" ? proposal.runAt : null,
    cronExpression: proposal.executionMode === "daily" ? `${Number(minute)} ${Number(hour)} * * *` : undefined,
    command: proposal.command,
    reason: proposal.reason,
    plan: proposal.plan,
    verificationCommand: proposal.verificationCommand ?? undefined,
    rollbackCommand: proposal.rollbackCommand ?? undefined,
    approvalRequired: proposal.approvalRequired,
    source: "AI",
    templateId: proposal.templateId,
    serverIds: proposal.serverIds,
    createdById: actor.userId,
    teamId: proposal.teamId,
  }, session);
  return {
    kind: "scheduled_task",
    scheduledTaskId: task.id,
    scheduleType: task.scheduleType,
    nextRunAt: task.nextRunAt?.toISOString() ?? null,
    requiresApprovalEveryRun: task.approvalRequired,
    targetCount: proposal.serverIds.length,
    command: proposal.command,
    timeZone: "UTC",
  };
}
