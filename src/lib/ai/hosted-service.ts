import { createHash } from "node:crypto";
import { createdBeforeCursor } from "@/lib/http/page-cursor";
/**
 * AI 托管服务 — 处理 AI 发起的 VPS 操作
 *
 * 流程：
 * 1. AI 返回 tool_call → 解析工具名和参数
 * 2. 安全操作（autoApproved）→ 直接执行 → 返回结果给 AI
 * 3. 变更操作 → 依据会话模式（ASSISTED/AUTO/FULL_AUTO）与平台审批策略：
 *    - AUTO / FULL_AUTO 允许时内联创建 CommandRequest 并执行回传真实结果
 *    - 否则在 /ai 展示确认卡片；用户确认后按权限与策略内联执行或转 /requests 审批
 */

import { assertChatGeneration } from "./chat-generation";
import { withHostedServerSnapshot } from "./hosted-snapshot";
import type { AiAutomationMode, Prisma } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { verifiedBearerTokenId } from "@/lib/auth/bearer-token";
import type { RoleKey } from "@/lib/auth/rbac";
import { activeCustomerTeamWhere, playbookTeamWhere, serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { auditUserAction } from "@/lib/audit/service";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import type { PlaybookStep } from "@/lib/playbook/types";
import { createCommandRequest } from "@/lib/command/service";
import { createCommandSchema } from "@/lib/command/schema";
import { decideCommandApproval, type CommandDecisionSource } from "@/lib/command/approval-policy";
import { getApprovalPolicySettings } from "@/lib/command/approval-policy-settings";
import { mayReviewCommandRequest, maySelfReviewCommands } from "@/lib/command/review-scope";
import { classifyCommandRisk, maxRiskLevel, type CommandRiskLevel } from "@/lib/command/risk-classifier";
import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { buildSshParamsFromServer, execRemoteCommand } from "@/lib/ssh/client";
import { deserializeDialect } from "@/lib/ssh/os-dialect";
import { executeCommandWithAgent } from "@/lib/server/agent-service";
import { applyHostedCronChange } from "./hosted-cron";
import { buildCommand } from "./hosted-command-builder";
export { buildCommand } from "./hosted-command-builder";
import { getToolByName, HOSTED_TOOLS, toolAvailableInMode, type HostedTool } from "./hosted-tools";
import { executeServerlessQuery } from "./hosted-safe-queries";
import { decideAiAutoExecution, MODE_RANK, resolveEffectiveAutomationMode } from "./execution-mode";
import { projectCommandOutcomeToHostedAction } from "./hosted-outcome";
import { t } from "@/lib/i18n/service-translations";
import { executeAutomationProposal, materializeAutomationProposal, scheduledAutomationTaskId } from "./automation-service";
import { firstSchemaSentence } from "@/lib/i18n/schema-copy";

import {
  buildAssistantCommandRequestPayload,
  isHostedActionType,
  missingHostedPermission,
  permissionDeniedMessage,
  requiredPermissionForAction,
  resolvePlaybookId,
  resolveServerId,
  SERVERLESS_ACTION_TYPES,
  sessionForTeamScope,
  type HostedActionExecutionContext,
  type HostedActionSession,
} from "./hosted-helpers";

export type { HostedActionSession } from "./hosted-helpers";

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

interface ParsedToolCall {
  toolCallId: string;
  tool: HostedTool;
  args: Record<string, unknown>;
}

// ── 解析 tool_call ────────────────────────────────────────

export function parseToolCall(tc: ToolCall): ParsedToolCall | null {
  const tool = getToolByName(tc.function.name);
  if (!tool) return null;

  let args: Record<string, unknown>;
  try {
    args = JSON.parse(tc.function.arguments);
  } catch {
    return null;
  }

  if (!args || typeof args !== "object" || Array.isArray(args)) return null;
  return { toolCallId: tc.id, tool, args };
}

/**
 * The playbook is chosen when the action is proposed, not when it is confirmed: the card names the playbook that will
 * run (it used to carry whatever name the model wrote, matched loosely at confirm time to the most recently updated
 * one), and a name that fits none or several comes back to the model as an error to correct.
 */
function playbookTargets(steps: Prisma.JsonValue) {
  if (!Array.isArray(steps)) return [];
  return [...new Set(steps.flatMap((step) => {
    if (!step || typeof step !== "object" || Array.isArray(step) || step.type !== "run_command") return [];
    const config = step.config;
    if (!config || typeof config !== "object" || Array.isArray(config) || !Array.isArray(config.serverIds)) return [];
    return config.serverIds.filter((id): id is string => typeof id === "string");
  }))].sort();
}

async function materializePlaybookProposal(
  args: Record<string, unknown>,
  session: HostedActionSession,
): Promise<{ params: Record<string, unknown>; maxRisk: CommandRiskLevel; riskReasons: string[] }> {
  const playbook = await resolvePlaybookId(args, session);
  if (!playbook?.enabled || !Array.isArray(playbook.steps)) throw new BusinessError(t("backend.ai.playbookNotFoundOrOutsideTeamScope"));
  const { assertPlaybookCommandStepsInScope } = await import("@/lib/playbook/service");
  const steps = playbook.steps as unknown as PlaybookStep[];
  await assertPlaybookCommandStepsInScope(steps, sessionForTeamScope(session));
  let maxRisk: CommandRiskLevel = "medium";
  const reasons = new Set<string>();
  for (const step of steps) {
    if (step.type === "run_command" && typeof step.config?.command === "string") {
      const assessment = classifyCommandRisk(step.config.command);
      maxRisk = maxRiskLevel(maxRisk, assessment.level);
      for (const reason of assessment.reasons) reasons.add(reason);
    }
  }
  return {
    params: { ...args, playbookId: playbook.id, playbookName: playbook.name, targetServerIds: playbookTargets(playbook.steps) },
    maxRisk,
    riskReasons: [...reasons],
  };
}

// ── 创建托管操作记录 ──────────────────────────────────────

function withHostedActionMode<T>(
  conversationId: string,
  actionType: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
  session?: HostedActionSession,
) {
  return prisma.$transaction(async (tx) => {
    // A mode switch (or platform ceiling change) and the creation or claim of a card must agree on their order.
    // Hold the conversation row only for this write, before any external execution.
    const [conversation] = await tx.$queryRaw<
      Array<{ hostingEnabled: boolean; automationMode: AiAutomationMode; automationModeExpiresAt?: Date | null }>
    >`SELECT "hostingEnabled", "automationMode", "automationModeExpiresAt" FROM ai_conversations WHERE id = ${conversationId} FOR SHARE`;
    if (!conversation) throw new NotFoundError(t("backend.ai.conversationNotFound"));
    if (!conversation.hostingEnabled) throw new BusinessError(t("backend.ai.hostingDisabled"));
    const tool = HOSTED_TOOLS.find((entry) => entry.actionType === actionType);
    if (!tool) throw new BusinessError(t("backend.ai.unsupportedActionType"));
    const livePolicies = await getApprovalPolicySettings({ fresh: true });
    const resolved = resolveEffectiveAutomationMode({
      requestedMode: conversation.automationMode,
      expiresAt: conversation.automationModeExpiresAt ?? null,
      policies: livePolicies,
      session: session ?? { userId: "", roles: [] },
      viaToken: session ? Boolean(verifiedBearerTokenId(session)) : false,
    });
    if (!toolAvailableInMode(tool, resolved.effectiveMode)) {
      throw new BusinessError(t("apiAiChat.toolUnavailableInPlanMode", { name: tool.name }));
    }
    return write(tx);
  });
}

export async function createHostedAction(input: {
  conversationId: string;
  messageId: string;
  userMessageId?: string;
  leaseToken?: string;
  toolCallId: string;
  tool: HostedTool;
  args: Record<string, unknown>;
  userId: string;
  revalidate?: () => Promise<void>;
  signal?: AbortSignal;
  /** Optional session for team-scoped server resolution. */
  session?: HostedActionSession | null;
}) {
  const { conversationId, messageId, tool, userId } = input;
  const session =
    input.session ??
    ({
      userId,
      roles: [] as RoleKey[],
      currentTeamId: null,
    } satisfies HostedActionSession);
  input.signal?.throwIfAborted();
  const missing = missingHostedPermission(session, tool.actionType);
  if (missing) throw new ForbiddenError(t("backend.ai.permissionDenied.required", { permission: missing }));
  const definition = HOSTED_TOOLS.find((entry) => entry.actionType === tool.actionType)!;
  const properties = definition.parameters.properties as Record<string, { type: string; enum?: string[]; minimum?: number; maximum?: number }>;
  const required = (definition.parameters.required ?? []) as string[];
  if (required.some((key) => !Object.hasOwn(input.args, key)) || Object.entries(input.args).some(([key, value]) => {
    if (!Object.hasOwn(properties, key)) return true;
    const field = properties[key]!;
    const type = Array.isArray(value) ? "array" : typeof value;
    if (field.type === "integer") return typeof value !== "number" || !Number.isSafeInteger(value) || value < (field.minimum ?? -Infinity) || value > (field.maximum ?? Infinity);
    return value === null || type !== field.type || (field.enum && !field.enum.includes(String(value)));
  })) throw new BusinessError(t("backend.ai.invalidActionParameters"));
  const automation = tool.actionType === "create_automation_task"
    ? await materializeAutomationProposal(input.args, session)
    : null;
  const playbookProposal = tool.actionType === "run_playbook"
    ? await materializePlaybookProposal(input.args, session)
    : null;
  const args = automation ?? (playbookProposal ? playbookProposal.params : input.args);
  const needsServer = !SERVERLESS_ACTION_TYPES.has(tool.actionType);
  const serverId = needsServer ? await resolveServerId(args, session) : null;
  const resolvedServer = serverId ? await prisma.server.findFirst({
    where: { id: serverId, enabled: true, AND: [serverTeamWhere(sessionForTeamScope(session)!, "connect")] },
    select: { id: true, name: true, host: true, teamId: true, operatingSystem: true },
  }) : null;
  if (needsServer && !resolvedServer) throw new BusinessError(t("backend.ai.noServerSpecified"));
  const snapshot = resolvedServer && { id: resolvedServer.id, name: resolvedServer.name, host: resolvedServer.host };
  const teamId = automation ? automation.teamId : resolvedServer ? resolvedServer.teamId : session.currentTeamId ?? null;
  const params = { ...args, ...(serverId ? { serverId, serverSnapshot: snapshot } : {}) };
  let effectiveRisk: CommandRiskLevel = tool.riskLevel;
  let riskReasons: string[] = [];
  let denylisted = false;
  if (playbookProposal) {
    effectiveRisk = maxRiskLevel(tool.riskLevel, playbookProposal.maxRisk);
    riskReasons = playbookProposal.riskReasons;
  } else if (automation && typeof automation.command === "string") {
    const assessment = classifyCommandRisk(automation.command);
    effectiveRisk = maxRiskLevel(tool.riskLevel, assessment.level);
    riskReasons = assessment.reasons;
    denylisted = assessment.denylisted;
  }
  // A change that could never become a command request (parameters the command builder refuses, a config file
  // too long for one request) was only found out when the person confirmed it. Refused here, it is an answer the
  // model can correct, and nobody is asked to confirm something that cannot run.
  if (serverId && !tool.autoApproved && !SERVERLESS_ACTION_TYPES.has(tool.actionType)) {
    const payload = await buildAssistantCommandRequestPayload({ tool, args: params, userId, serverId, teamId: resolvedServer?.teamId ?? null });
    const parsed = createCommandSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BusinessError(firstSchemaSentence(parsed.error) ?? t("backend.ai.invalidActionParameters"));
    }
    const assessment = classifyCommandRisk(
      parsed.data.command,
      typeof resolvedServer?.operatingSystem === "string" ? resolvedServer.operatingSystem : "LINUX",
    );
    effectiveRisk = maxRiskLevel(tool.riskLevel, assessment.level);
    riskReasons = assessment.reasons;
    denylisted = assessment.denylisted;
  }
  // Resolving a proposal may page through many targets before the card can be written.
  await input.revalidate?.();
  return withHostedActionMode(conversationId, tool.actionType, async (tx) => {
    if (input.userMessageId) await assertChatGeneration(tx, conversationId, input.userMessageId, input.leaseToken);
    input.signal?.throwIfAborted();
    let frozenTask;
    if (tool.actionType === "manage_cron") {
      frozenTask = await tx.scheduledTask.findFirst({
        where: { id: String(input.args.taskId).trim(), ...activeCustomerTeamWhere(sessionForTeamScope(session)!) },
        select: { id: true, teamId: true, approvalRequired: true },
      });
      if (!frozenTask) throw new NotFoundError(t("backend.scheduled-task.scheduledTaskNotFound"));
      if (input.args.action === "resume" && frozenTask.approvalRequired === false) {
        effectiveRisk = maxRiskLevel(effectiveRisk, "high");
        riskReasons = Array.from(new Set([...riskReasons, "high.resume_unattended_schedule"]));
      }
    }
    const action = await tx.aiHostedAction.create({
      data: {
        conversationId,
        messageId,
        toolCallId: input.toolCallId,
        serverId,
        teamId: frozenTask ? frozenTask.teamId : teamId,
        actionType: tool.actionType,
        actionName: tool.actionName,
        params: JSON.stringify(frozenTask ? { ...params, taskId: frozenTask.id, teamId: frozenTask.teamId } : params),
        riskLevel: tool.riskLevel,
        effectiveRisk,
        ...(riskReasons.length > 0 ? { riskReasons } : {}),
        autoApproved: tool.autoApproved,
        status: tool.autoApproved ? "APPROVED" : "PENDING_APPROVAL",
        requesterId: userId,
        approvedAt: tool.autoApproved ? new Date() : null,
      },
    });
    if (!tool.autoApproved) {
      await tx.aiMessage.create({ data: {
        id: action.id, conversationId, role: "tool", toolCallId: input.toolCallId,
        content: JSON.stringify({ actionId: action.id, status: "PENDING_APPROVAL", pendingApproval: true }),
      } });
    }
    input.signal?.throwIfAborted();
    return { ...action, server: snapshot, effectiveRisk, riskReasons, denylisted };
  }, session);
}

// ── 执行安全操作（Agent 优先，SSH 回退） ───────────────────

export async function executeSafeAction(
  action: {
    actionType: string;
    serverId: string | null;
    teamId: string | null;
    params: Record<string, unknown>;
  },
  context?: HostedActionExecutionContext,
): Promise<{ success: boolean; data: unknown; error?: string }> {
  const locale = context?.locale ?? "zh";
  if (context && !sessionHasPermission(context.session, context.requiredPermission ?? requiredPermissionForAction(action.actionType))) {
    return { success: false, data: null, error: permissionDeniedMessage(action.actionType, context.locale) };
  }

  context?.signal?.throwIfAborted();
  if (SERVERLESS_ACTION_TYPES.has(action.actionType)) {
    await context?.revalidate?.();
    context?.signal?.throwIfAborted();
  }
  const serverlessResult = await executeServerlessQuery(
    { actionType: action.actionType, params: action.params },
    sessionForTeamScope(context?.session),
    context?.locale,
    context?.knowledgeBudget,
  );
  if (serverlessResult) return serverlessResult;

  if (action.actionType === "run_playbook") {
    // Dangerous: never auto-execute. Confirm path queues a Playbook run after user approval.
    return {
      success: false,
      data: null,
      error: t( "backend.ai.runPlaybookRequiresConfirmation", locale),
    };
  }

  if (!action.serverId || action.teamId === undefined) {
    return { success: false, data: null, error: t( "backend.ai.noServerSpecified", locale), };
  }

  // Team-scoped server load (IDOR: never SSH into out-of-team hosts).
  const scope = sessionForTeamScope(context?.session);
  const access = scope ? serverTeamWhere(scope, "connect") : { teamId: null };
  const server = await prisma.server.findFirst({
    where: { id: action.serverId, enabled: true, teamId: action.teamId, AND: [access] },
    include: { sshKey: true },
  });

  if (!server) {
    return { success: false, data: null, error: t( "backend.ai.serverNotFound", locale), };
  }

  try {
    if (!isHostedActionType(action.actionType)) {
      return { success: false, data: null, error: t("backend.ai.unsupportedActionType", locale) };
    }
    const dialect = server.osDialect ? deserializeDialect(server.osDialect) : undefined;
    const command = buildCommand(action.actionType, action.params, dialect, server.operatingSystem);
    if (!command) {
      const error = server.operatingSystem === "WINDOWS"
        ? t("backend.ai.windowsHostedCommandUnsupported", locale)
        : t("backend.ai.unsupportedActionType", locale);
      return { success: false, data: null, error };
    }

    let transport: "agent" | "ssh" = server.managementMode === "AGENT" ? "agent" : "ssh";
    let result: { stdout: string; stderr: string; exitCode: number | null } | null = null;
    if (server.managementMode === "AGENT") {
      await context?.revalidate?.();
      context?.signal?.throwIfAborted();
      result = await executeCommandWithAgent({
        serverId: server.id, command, timeoutMs: 60_000,
        signal: context?.signal,
        expectedIdentity: { tokenHash: server.agentTokenHash, teamId: action.teamId, endpoint: server },
      });
    }
    if (!result) {
      transport = "ssh";
      const hasSshCredential = server.connectionType === "SSH_KEY"
        ? Boolean(server.sshKey?.privateKey)
        : Boolean(server.password);
      if (!hasSshCredential) {
        return {
          success: false,
          data: null,
          error: t("backend.ai.agentOfflineNoSshFallback"),
        };
      }
      if (!server.hostKeySha256?.trim()) {
        return { success: false, data: null, error: t("backend.ssh.hostKeyNotPinned", locale) };
      }
      if (server.managementMode === "AGENT") {
        // The Agent wait can outlive a credential rotation, transfer or access revocation.
        const current = await prisma.server.findFirst({
          where: {
            id: server.id, enabled: true, AND: [access], teamId: server.teamId,
            operatingSystem: server.operatingSystem, managementMode: server.managementMode,
            agentTokenHash: server.agentTokenHash, host: server.host, port: server.port,
            username: server.username, hostKeySha256: server.hostKeySha256,
            connectionType: server.connectionType, password: server.password, sshKeyId: server.sshKeyId,
            ...(server.sshKey ? { sshKey: { is: { updatedAt: server.sshKey.updatedAt } } } : {}),
          },
          select: { id: true },
        });
        if (!current) return { success: false, data: null, error: t("backend.command.connectionChanged", locale) };
      }
      const ssh = await buildSshParamsFromServer(server, server.sshKey, action.teamId);
      await context?.revalidate?.();
      context?.signal?.throwIfAborted();
      result = await execRemoteCommand({ ...ssh, command, timeout: 60_000, signal: context?.signal });
    }
    if (!result) {
      return { success: false, data: null, error: t("backend.ai.executionFailed", locale, { error: "No execution result" }) };
    }
    const code = result.exitCode ?? 255;
    return {
      success: code === 0,
      data: {
        stdout: result.stdout.slice(-5000),
        stderr: result.stderr.slice(-2000),
        exitCode: code,
        transport,
      },
      error: code !== 0
        ? t("backend.ai.commandExecutionFailed", locale, { code })
        : undefined,
    };
  } catch (err) {
    context?.signal?.throwIfAborted();
    if (err instanceof ForbiddenError) throw err;
    return {
      success: false,
      data: null,
      error: t("backend.ai.executionFailed", locale, {
        error: err instanceof Error
          ? err.message
          : t("backend.ai.unknownError", locale),
      }),
    };
  }
}


// ── 审批操作 ──────────────────────────────────────────────

/**
 * The tool wrapper approveHostedAction / confirmHostedAction both hand to
 * buildAssistantCommandRequestPayload (TR: duplicated verbatim in both tails).
 * Every field except name/description/parameters comes straight off the action
 * row so the assistant-issued metadata survives the approval hop.
 */
function hostedActionTool(action: {
  actionType: string;
  actionName: string;
  riskLevel: string;
  autoApproved: boolean;
}): HostedTool {
  return {
    name: action.actionType,
    description: "",
    parameters: {},
    riskLevel: action.riskLevel as HostedTool["riskLevel"],
    autoApproved: action.autoApproved,
    // Both call sites have passed isHostedActionType() before reaching here.
    actionType: action.actionType as HostedTool["actionType"],
    actionName: action.actionName,
  };
}

type HostedActionRef = { id: string; conversationId: string; toolCallId: string | null };
type HostedArtifact = {
  status: "APPROVED" | "EXECUTING" | "COMPLETED";
  result: Record<string, unknown>;
  toolResult: Record<string, unknown>;
  commandRequestId?: string;
  /** True only for actions that have truly finished (cron, playbook queued, scheduled task created); false while a CommandRequest awaits review or runs. */
  terminal: boolean;
};

function commandArtifact(command: { id: string; requiresApproval: boolean }): HostedArtifact {
  if (command.requiresApproval) {
    const result = { commandRequestId: command.id, requiresApproval: true, executed: false };
    return {
      status: "APPROVED",
      result,
      toolResult: {
        success: false,
        executed: false,
        retryable: false,
        status: "AWAITING_REVIEW",
        commandRequestId: command.id,
        requiresApproval: true,
      },
      commandRequestId: command.id,
      terminal: false,
    };
  }
  const result = { commandRequestId: command.id, requiresApproval: false, executed: true };
  return {
    status: "EXECUTING",
    result,
    toolResult: {
      success: false,
      executed: true,
      pending: true,
      retryable: false,
      status: "EXECUTING",
      commandRequestId: command.id,
      requiresApproval: false,
    },
    commandRequestId: command.id,
    terminal: false,
  };
}

function automationArtifact(result: Record<string, unknown>): HostedArtifact {
  const commandRequestId = typeof result.commandRequestId === "string" ? result.commandRequestId : undefined;
  if (result.kind === "command_request" && commandRequestId) {
    const pendingCommand = result.requiresApproval === true;
    return {
      status: pendingCommand ? "APPROVED" : "EXECUTING",
      result,
      toolResult: pendingCommand
        ? { success: false, executed: false, retryable: false, status: "AWAITING_REVIEW", data: result }
        : { success: false, executed: true, pending: true, retryable: false, status: "EXECUTING", data: result },
      commandRequestId,
      terminal: false,
    };
  }
  return {
    status: "COMPLETED",
    result,
    toolResult: { success: true, status: "COMPLETED", data: result },
    commandRequestId,
    terminal: true,
  };
}

function playbookArtifact(playbookId: string, playbookName: string | undefined, run: { id: string; status: string }): HostedArtifact {
  return {
    status: "COMPLETED",
    result: { playbookId, playbookName, runId: run.id, status: run.status },
    toolResult: { success: true, status: "COMPLETED", playbookId, runId: run.id, runStatus: run.status },
    terminal: true,
  };
}

function hostedArtifactUpdate(artifact: HostedArtifact, now: Date) {
  return {
    status: artifact.status,
    result: JSON.stringify(artifact.result),
    errorMessage: null,
    ...(artifact.commandRequestId ? { commandRequestId: artifact.commandRequestId } : {}),
    ...(artifact.status === "EXECUTING" ? { executedAt: now } : {}),
    completedAt: artifact.terminal ? now : null,
  };
}

async function persistHostedArtifact(action: HostedActionRef, artifact: HostedArtifact) {
  const now = new Date();
  if (!artifact.terminal) {
    // Non-terminal handoff (CommandRequest awaiting review or executing inline):
    // perform the conditional non-terminal update AND placeholder tool reply in ONE
    // transaction using the same parent-then-action lock order as `projectCommandOutcomeToHostedAction`
    // so a late placeholder can never overwrite a committed terminal outcome.
    await withHostedToolWrite(action.id, async (tx) => {
      const claimed = await tx.aiHostedAction.updateMany({
        where: { id: action.id, status: { in: ["PENDING_APPROVAL", "APPROVED", "EXECUTING"] } },
        data: hostedArtifactUpdate(artifact, now),
      });
      if (claimed.count > 0 && action.toolCallId) {
        await persistHostedToolOutcome(action, artifact.toolResult, tx);
      }
    });
    if (artifact.commandRequestId) {
      await projectCommandOutcomeToHostedAction(artifact.commandRequestId);
    }
    return;
  }
  await recordHostedOutcome(action, hostedArtifactUpdate(artifact, now), artifact.toolResult);
}

// A legacy reply may need inserting. Acquire its parent's FK lock before locking the action,
// in the same order as a clear or cascading conversation deletion.
function withHostedToolWrite<T>(actionId: string, write: (tx: Prisma.TransactionClient) => Promise<T>) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT c.id FROM ai_conversations c JOIN ai_hosted_actions a ON a."conversationId" = c.id
      WHERE a.id = ${actionId} FOR SHARE OF c`;
    return write(tx);
  });
}

async function recordHostedOutcome(
  action: HostedActionRef,
  data: Prisma.AiHostedActionUncheckedUpdateInput,
  outcome: Record<string, unknown>,
) {
  const completedAt = new Date();
  await prisma.aiHostedAction.update({ where: { id: action.id }, data: { ...data, completedAt: action.toolCallId ? null : completedAt } });
  if (!action.toolCallId) return;
  // A committed result with no completion timestamp is a durable request for the maintenance sweep.
  try {
    await withHostedToolWrite(action.id, async (tx) => {
      const pending = await tx.aiHostedAction.updateMany({ where: { id: action.id, completedAt: null }, data: { completedAt } });
      if (pending.count) await persistHostedToolOutcome(action, outcome, tx);
    });
  } catch {
    // Recovery retries just this projection. Never re-run the external operation.
  }
}


async function persistHostedToolOutcome(
  action: HostedActionRef,
  outcome: Record<string, unknown>,
  db: Prisma.TransactionClient,
) {
  if (!action.toolCallId) return;
  const content = JSON.stringify({ actionId: action.id, ...outcome });
  const where = { conversationId: action.conversationId, role: "tool", toolCallId: action.toolCallId };
  const updated = await db.aiMessage.updateMany({ where: { ...where, id: action.id }, data: { content } });
  if (updated.count) return;
  // Keep the original position of pre-upgrade approval messages. Several placeholders can
  // share a provider call ID, so only the server-written actionId identifies a legacy reply.
  const legacy = await db.aiMessage.findMany({
    where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: { id: true, content: true, createdAt: true },
  });
  const linked = legacy.filter((message) => storedRecord(message.content).actionId === action.id);
  await db.aiMessage.upsert({
    where: { id: action.id }, update: { content },
    create: { ...where, id: action.id, content, createdAt: linked[0]?.createdAt },
  });
  if (linked.length) await db.aiMessage.deleteMany({ where: { ...where, id: { in: linked.map((message) => message.id) } } });
}

async function persistHostedActionFailure(
  action: HostedActionRef,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : t("backend.ai.unknownError");
  await recordHostedOutcome(action, { status: "FAILED", errorMessage: message }, { success: false, status: "FAILED", error: message });
}

type ClaimedAction = HostedActionRef & { actionType: string; params: string; teamId: string | null };

function storedRecord(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const value: unknown = JSON.parse(raw);
    if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  } catch {
    // A damaged params string must not block reconciliation of this batch.
  }
  return {};
}

function isScheduledProposal(params: Record<string, unknown>) {
  return params.executionMode === "once" || params.executionMode === "daily";
}

function createsHostedArtifact(actionType: string) {
  if (actionType === "create_automation_task" || actionType === "run_playbook") return true;
  return !SERVERLESS_ACTION_TYPES.has(actionType) && HOSTED_TOOLS.some((tool) => tool.actionType === actionType && !tool.autoApproved);
}

async function findHostedArtifact(action: ClaimedAction, params: Record<string, unknown>): Promise<HostedArtifact | null> {
  if (!createsHostedArtifact(action.actionType)) return null;
  if (action.actionType === "run_playbook") {
    const run = await prisma.playbookRun.findFirst({
      where: { AND: [
        { triggerContext: { path: ["source"], equals: "ai_hosted_action" } },
        { triggerContext: { path: ["hostedActionId"], equals: action.id } },
      ] },
      select: { id: true, playbookId: true, status: true },
    });
    return run ? playbookArtifact(run.playbookId, typeof params.playbookName === "string" ? params.playbookName : undefined, run) : null;
  }

  const automation = action.actionType === "create_automation_task";
  if (automation && params.executionMode !== "now") {
    const task = await prisma.scheduledTask.findUnique({
      where: { id: scheduledAutomationTaskId(action.id) },
      select: { id: true, scheduleType: true },
    });
    if (task) return automationArtifact({ kind: "scheduled_task", scheduledTaskId: task.id, scheduleType: task.scheduleType });
    if (isScheduledProposal(params)) return null;
  }
  const command = await prisma.commandRequest.findUnique({
    where: {
      idempotencyKey: automation ? `ai-automation:${action.id}` : `ai-hosted-action:${action.id}`,
      // Before proposal cards were team-stamped, their target team was already
      // serialized in the materialized params.
      teamId: automation && (typeof params.teamId === "string" || params.teamId === null) ? params.teamId : action.teamId,
      initiatedByType: "ASSISTANT",
    },
    select: { id: true, status: true },
  });
  if (!command) return null;
  const requiresApproval = command.status === "PENDING_APPROVAL";
  return automation
    ? automationArtifact({ kind: "command_request", commandRequestId: command.id, requiresApproval })
    : commandArtifact({ id: command.id, requiresApproval });
}

// The creator may have committed before losing its reply. If this lookup also
// fails, leave the claim open so the maintenance worker can try again.
async function recordArtifactCreationError(action: ClaimedAction, error: unknown) {
  const artifact = await findHostedArtifact(action, storedRecord(action.params));
  if (artifact) return persistHostedArtifact(action, artifact);
  await persistHostedActionFailure(action, error);
}

const INTERRUPTED_ACTION_AFTER_MS = 30 * 60_000;
const ARTIFACT_PENDING_RECHECK = JSON.stringify({ verified: false, pendingRecheck: true });

export async function recoverInterruptedHostedActions(now = new Date()) {
  const cutoff = new Date(now.getTime() - INTERRUPTED_ACTION_AFTER_MS);
  const stale = await prisma.aiHostedAction.findMany({
    where: {
      OR: [
        { completedAt: null, OR: [
          { status: { in: ["FAILED", "COMPLETED"] } },
          { status: "EXECUTING", executedAt: { lt: cutoff } },
          { status: "APPROVED", approvedAt: { lt: cutoff } },
          { status: "EXECUTING", executedAt: null, createdAt: { lt: cutoff } },
          { status: "APPROVED", approvedAt: null, createdAt: { lt: cutoff } },
        ] },
        { status: "APPROVED", result: ARTIFACT_PENDING_RECHECK, completedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, teamId: true, conversationId: true, toolCallId: true, actionType: true, params: true, result: true, errorMessage: true, status: true, commandRequestId: true, approvedAt: true, executedAt: true, completedAt: true },
    orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: 50,
  });
  let recovered = 0;
  for (const action of stale) {
    const receipt = storedRecord(action.result);
    const linkedCommandId =
      action.commandRequestId ??
      (action.status === "EXECUTING" && typeof receipt.commandRequestId === "string"
        ? receipt.commandRequestId
        : null);
    if (linkedCommandId && (action.status === "APPROVED" || action.status === "EXECUTING")) {
      const cmd = await prisma.commandRequest.findUnique({
        where: { id: linkedCommandId },
        select: { id: true, status: true },
      });
      if (cmd && ["PENDING_APPROVAL", "APPROVED", "RUNNING", "CANCELLING"].includes(cmd.status)) {
        // Linked CommandRequest is still alive — never overwrite it with a premature interrupted/approved state.
        continue;
      }
      if (cmd && await projectCommandOutcomeToHostedAction(cmd.id)) {
        recovered += 1;
        continue;
      }
    }
    if (!action.completedAt && (action.status === "COMPLETED" || action.status === "FAILED")) {
      const result = storedRecord(action.result);
      const outcome = action.status === "FAILED" ? { success: false, status: "FAILED", error: action.errorMessage }
        : action.actionType === "run_playbook" ? { success: true, status: "COMPLETED", playbookId: result.playbookId, runId: result.runId, runStatus: result.status }
        : { success: true, status: "COMPLETED", data: result };
      const synced = await withHostedToolWrite(action.id, async (tx) => {
        const claimed = await tx.aiHostedAction.updateMany({ where: { id: action.id, status: action.status, result: action.result, completedAt: null }, data: { completedAt: now } });
        if (claimed.count) await persistHostedToolOutcome(action, outcome, tx);
        return claimed.count;
      });
      recovered += synced;
      continue;
    }
    const params = storedRecord(action.params);
    // Earlier releases wrote the command pointer and its tool reply separately.
    // The original receipt remains evidence even if the command has since been deleted.
    const artifact = action.status === "APPROVED" && typeof receipt.commandRequestId === "string" && typeof receipt.requiresApproval === "boolean"
      ? commandArtifact({ id: receipt.commandRequestId, requiresApproval: receipt.requiresApproval })
      : await findHostedArtifact(action, params);
    const error = t("backend.ai.actionInterrupted");
    // A slow writer can still commit after our lookup; legacy timers may have
    // no correlation key. Retain the approval and retry the lookup on a later
    // sweep, after fresh claims. If still absent, leave it for manual review.
    const unverified = createsHostedArtifact(action.actionType) || action.actionType === "manage_cron";
    const rechecked = action.result === ARTIFACT_PENDING_RECHECK;
    const status = unverified ? "APPROVED" as const : "FAILED" as const;
    const data = artifact
      ? hostedArtifactUpdate(artifact, now)
      : {
        status, errorMessage: error, completedAt: now,
        ...(unverified && { result: rechecked ? JSON.stringify({ verified: false }) : ARTIFACT_PENDING_RECHECK }),
      };
    const settled = await withHostedToolWrite(action.id, async (tx) => {
      const claimed = await tx.aiHostedAction.updateMany({
        where: { id: action.id, status: action.status, approvedAt: action.approvedAt, executedAt: action.executedAt, result: action.result, completedAt: action.completedAt },
        data,
      });
      if (claimed.count === 0) return false;
      if (!artifact && rechecked) return false;
      await persistHostedToolOutcome(action, artifact
        ? artifact.toolResult
        : { success: false, status, error }, tx);
      return true;
    });
    if (settled) recovered += 1;
  }
  return { recovered };
}

function claimPendingHostedAction(
  action: { id: string; conversationId: string; actionType: string },
  actor: HostedActionSession,
  actionScope: Record<string, unknown>,
  status: "APPROVED" | "EXECUTING",
  extraData?: Prisma.AiHostedActionUncheckedUpdateManyInput,
) {
  const missing = missingHostedPermission(actor, action.actionType);
  if (missing) throw new ForbiddenError(t("backend.ai.permissionDenied.required", { permission: missing }));
  return withHostedActionMode(action.conversationId, action.actionType, (tx) => tx.aiHostedAction.updateMany({
    where: { id: action.id, status: "PENDING_APPROVAL", ...actionScope },
    data: {
      status,
      approverId: actor.userId,
      approvedAt: new Date(),
      ...(status === "EXECUTING" && { executedAt: new Date() }),
      ...extraData,
    },
  }), actor);
}

function commandDigest(command: string) {
  return {
    commandSha256: createHash("sha256").update(command).digest("hex"),
    commandLength: command.length,
  };
}

export type ConfirmHostedActionOptions = {
  editedCommand?: string;
  acknowledgeCritical?: boolean;
};

export type HostedCommandDecisionResult = {
  executedInline: boolean;
  commandRequestId: string | null;
  requiresApproval: boolean;
  status: string;
};

/**
 * Execute an AI-initiated mutating server action automatically during AUTO /
 * FULL_AUTO streaming, through a durable APPROVED CommandRequest with mode
 * re-verification under FOR SHARE and audit logging.
 */
export async function executeAutoHostedCommandAction(input: {
  action: {
    id: string;
    conversationId: string;
    toolCallId: string | null;
    actionType: string;
    actionName: string;
    riskLevel: string;
    autoApproved: boolean;
    serverId: string | null;
    teamId: string | null;
    params: string;
  };
  session: HostedActionSession;
  streamStartMode: AiAutomationMode;
  streamStartPinnedServerIds?: readonly string[];
  mutatingStepsThisTurn?: number;
  decisionSource: "AI_MODE_AUTO" | "AI_MODE_FULL_AUTO";
  effectiveRisk: CommandRiskLevel;
  riskReasons: string[];
  denylisted?: boolean;
}): Promise<{ commandRequestId: string; requiresApproval: boolean; status: string }> {
  const { action, session } = input;
  if (!action.serverId) throw new BusinessError(t("backend.ai.noTargetVpsBoundCannotCreateCommandRequest"));
  const params = storedRecord(action.params);
  const commandRequestPayload = await buildAssistantCommandRequestPayload({
    tool: hostedActionTool(action),
    args: params,
    userId: session.userId,
    serverId: action.serverId,
    teamId: action.teamId ?? session.currentTeamId ?? null,
  });

  const actionScope = session.currentTeamId
    ? { teamId: session.currentTeamId }
    : teamWhere(sessionForTeamScope(session)!);
  const claimed = await claimPendingHostedAction(action, session, actionScope, "EXECUTING", {
    effectiveRisk: input.effectiveRisk,
    riskReasons: input.riskReasons,
    decisionSource: input.decisionSource,
    modeAtDecision: input.streamStartMode,
  });
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
  }

  const viaToken = Boolean(verifiedBearerTokenId(session));
  const streamPins = Array.isArray(input.streamStartPinnedServerIds)
    ? input.streamStartPinnedServerIds.filter(Boolean)
    : [];
  let request: Awaited<ReturnType<typeof createCommandRequest>>;
  try {
    request = await createCommandRequest(
      { ...commandRequestPayload, approvalRequired: false, idempotencyKey: `ai-hosted-action:${action.id}` },
      { ...session, currentTeamId: session.currentTeamId ?? null },
      undefined,
      async (tx, commandRequestId) => {
        const [conv] = await tx.$queryRaw<
          Array<{
            hostingEnabled: boolean;
            automationMode: AiAutomationMode;
            automationModeExpiresAt?: Date | null;
            pinnedServerIds?: string[] | null;
          }>
        >`SELECT "hostingEnabled", "automationMode", "automationModeExpiresAt", "pinnedServerIds" FROM ai_conversations WHERE id = ${action.conversationId} FOR SHARE`;
        if (!conv?.hostingEnabled) throw new BusinessError(t("backend.ai.hostingDisabled"));
        const livePolicies = await getApprovalPolicySettings({ fresh: true });
        const resolved = resolveEffectiveAutomationMode({
          requestedMode: conv.automationMode,
          expiresAt: conv.automationModeExpiresAt ?? null,
          policies: livePolicies,
          session,
          viaToken,
          streamStartMode: input.streamStartMode,
        });
        const requiredMode: AiAutomationMode = input.decisionSource === "AI_MODE_FULL_AUTO" ? "FULL_AUTO" : "AUTO";
        if (MODE_RANK[resolved.effectiveMode] < MODE_RANK[requiredMode]) {
          throw new BusinessError(t("backend.ai.hostedAuthorizationChanged"));
        }
        // Narrowing pins mid-turn removes unpinned servers; clearing/broadening pins never expands stream-start authority.
        const livePins = Array.isArray(conv.pinnedServerIds) ? conv.pinnedServerIds.filter(Boolean) : [];
        let effectivePinnedServerIds: string[];
        if (streamPins.length > 0 && livePins.length > 0) {
          const narrowed = streamPins.filter((id) => livePins.includes(id));
          effectivePinnedServerIds = narrowed.length > 0 ? narrowed : ["__disjoint_pins__"];
        } else if (streamPins.length > 0) {
          effectivePinnedServerIds = streamPins;
        } else {
          effectivePinnedServerIds = livePins;
        }
        const toolEntry = HOSTED_TOOLS.find((entry) => entry.actionType === action.actionType);
        if (!toolEntry) {
          throw new BusinessError(t("backend.ai.unsupportedActionType"));
        }
        const recheck = decideAiAutoExecution({
          effectiveMode: resolved.effectiveMode,
          actionType: toolEntry.actionType,
          effectiveRisk: input.effectiveRisk,
          denylisted: Boolean(input.denylisted),
          policies: livePolicies,
          submitterMayExecute: sessionHasPermission(session, "command:execute"),
          targetServerId: action.serverId,
          pinnedServerIds: effectivePinnedServerIds,
          hasSelectedCustomer: Boolean(session.currentTeamId),
          mutatingStepsThisTurn: input.mutatingStepsThisTurn ?? 0,
        });
        if (!recheck.autoRun) {
          throw new BusinessError(t("backend.ai.hostedAuthorizationChanged"));
        }
        await tx.aiHostedAction.updateMany({
          where: { id: action.id },
          data: { commandRequestId, modeAtDecision: resolved.effectiveMode },
        });
      },
      { origin: "AI_CHAT", decisionSource: input.decisionSource },
    );
  } catch (error) {
    await recordArtifactCreationError(action, error);
    throw error;
  }

  await auditUserAction(
    session.userId,
    request.requiresApproval ? "ai.hosted-action.submit" : "ai.hosted-action.auto_execute",
    {
      actionId: action.id,
      commandRequestId: request.id,
      actionType: action.actionType,
      effectiveRisk: input.effectiveRisk,
      decisionSource: input.decisionSource,
      modeAtDecision: input.streamStartMode,
      requiresApproval: request.requiresApproval,
      ...commandDigest(commandRequestPayload.command),
    },
    undefined,
    action.teamId ?? session.currentTeamId ?? null,
  );
  await persistHostedArtifact(action, commandArtifact(request));
  return { commandRequestId: request.id, requiresApproval: request.requiresApproval, status: request.status };
}

async function executeConfirmedCronAction(action: ClaimedAction, actor: HostedActionSession, actionScope: Record<string, unknown>) {
  const missing = missingHostedPermission(actor, action.actionType);
  if (missing) throw new ForbiddenError(permissionDeniedMessage(action.actionType));
  await withHostedActionMode(action.conversationId, action.actionType, async (tx) => {
    const now = new Date();
    const claim = await tx.aiHostedAction.updateMany({
      where: { id: action.id, status: "PENDING_APPROVAL", ...actionScope },
      data: { status: "EXECUTING", approverId: actor.userId, approvedAt: now, executedAt: now },
    });
    if (!claim.count) throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
    const params = storedRecord(action.params);
    const data = await applyHostedCronChange(tx, action.teamId, params, actor);
    await tx.aiHostedAction.update({ where: { id: action.id }, data: {
      status: "COMPLETED", completedAt: now, errorMessage: null, result: JSON.stringify(data),
    } });
    await persistHostedToolOutcome(action, { success: true, status: "COMPLETED", data }, tx);
  }, actor);
}

async function executeConfirmedAutomationAction(
  action: ClaimedAction,
  actor: HostedActionSession,
  actionScope: Record<string, unknown>,
) {
  const claimed = await claimPendingHostedAction(action, actor, actionScope, "EXECUTING");
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
  }

  let result: Awaited<ReturnType<typeof executeAutomationProposal>>;
  try {
    result = await executeAutomationProposal(
      JSON.parse(action.params) as Record<string, unknown>,
      actor,
      action.id,
      action.teamId,
    );
  } catch (error) {
    return recordArtifactCreationError(action, error);
  }
  await persistHostedArtifact(action, automationArtifact(result));
}

export async function approveHostedAction(actionId: string, approver: HostedActionSession) {
  if (!sessionHasPermission(approver, "ai:action:approve")) throw new ForbiddenError(t("backend.ai.missingPermissionAiActionApprove"));

  // An approver acts inside the selected customer. Platform administrators with
  // no selected customer retain the explicit global recovery path for legacy rows.
  const approvalScope = approver.currentTeamId
    ? { teamId: approver.currentTeamId }
    : teamWhere(sessionForTeamScope(approver)!);
  const actionScope = approvalScope;
  const action = await prisma.aiHostedAction.findFirst({
    where: { id: actionId, ...actionScope },
  });
  if (!action) throw new NotFoundError(t("backend.ai.actionNotFoundOrNotAuthorizedToApprove"));
  if (action.status !== "PENDING_APPROVAL") throw new BusinessError(t("backend.ai.actionIsNotPendingApproval"));
  if (!isHostedActionType(action.actionType)) throw new BusinessError(t("backend.ai.unsupportedActionType"));
  if (SERVERLESS_ACTION_TYPES.has(action.actionType) && action.actionType !== "create_automation_task" && action.actionType !== "manage_cron" && action.actionType !== "run_playbook") {
    throw new BusinessError(t("backend.ai.listQueryToolsDoNotRequireCreatingA"));
  }
  if (!sessionHasPermission(approver, "command:approve")) {
    throw new ForbiddenError(t("backend.ai.permissionDenied.required", { permission: "command:approve" }));
  }
  const policies = await getApprovalPolicySettings({ fresh: true });
  if (!mayReviewCommandRequest(approver, action.requesterId, null, false, policies.commandSelfReview)) {
    throw new BusinessError(t("backend.command.cannotSelfReview"));
  }
  if (action.actionType === "create_automation_task") {
    if (approver.userId !== action.requesterId) {
      throw new ForbiddenError(t("backend.ai.actionNotFoundOrNotAuthorizedToApprove"));
    }
    await executeConfirmedAutomationAction(action, approver, actionScope);
    return;
  }
  if (action.actionType === "manage_cron") {
    await executeConfirmedCronAction(action, approver, actionScope);
    return;
  }
  if (action.actionType === "run_playbook") {
    if (approver.userId !== action.requesterId) {
      throw new ForbiddenError(t("backend.ai.actionNotFoundOrNotAuthorizedToApprove"));
    }
    await runPlaybookHostedAction(action, approver, actionScope, JSON.parse(action.params) as Record<string, unknown>);
    return;
  }
  const missing = missingHostedPermission(approver, action.actionType);
  if (missing) throw new ForbiddenError(t("backend.ai.permissionDenied.required", { permission: missing }));
  if (!action.serverId) throw new BusinessError(t("backend.ai.noTargetVpsBoundCannotCreateCommandRequest"));

  const params = JSON.parse(action.params) as Record<string, unknown>;
  const commandRequestPayload = await buildAssistantCommandRequestPayload({
    tool: hostedActionTool(action),
    args: params,
    userId: action.requesterId,
    serverId: action.serverId,
    teamId: action.teamId ?? approver.currentTeamId ?? null,
  });

  const reviewDecisionSource: CommandDecisionSource =
    approver.userId === action.requesterId ? "SELF_REVIEW" : "REVIEWER";

  // Atomic compare-and-swap first, as confirmHostedAction does: creating the
  // command before it let a rejection that won the swap leave a command
  // request behind that still ran.
  const claimed = await claimPendingHostedAction(action, approver, actionScope, "EXECUTING", {
    decisionSource: reviewDecisionSource,
  });
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingApproval"));
  }

  // Stable idempotency bridges retries/races to one durable CommandRequest.
  // Cross-user approval records CommandApproval + endpoint receipts atomically
  // so approved AI actions execute immediately instead of triggering a second /requests review.
  let request: Awaited<ReturnType<typeof createCommandRequest>>;
  try {
    request = await createCommandRequest(
      { ...commandRequestPayload, idempotencyKey: `ai-hosted-action:${actionId}` },
      {
        ...approver,
        currentTeamId: approver.currentTeamId ?? null,
      },
      undefined,
      async (tx, commandRequestId) => {
        await tx.aiHostedAction.updateMany({ where: { id: actionId }, data: { commandRequestId } });
      },
      {
        origin: "AI_CHAT",
        approveOnCreate: {
          approverId: approver.userId,
          decisionSource: reviewDecisionSource,
          comment: "Approved AI hosted action",
        },
      },
    );
  } catch (error) {
    return recordArtifactCreationError(action, error);
  }

  await auditUserAction(
    approver.userId,
    "ai.hosted-action.execute",
    {
      actionId,
      commandRequestId: request.id,
      actionType: action.actionType,
      decisionSource: reviewDecisionSource,
      ...commandDigest(commandRequestPayload.command),
    },
    undefined,
    action.teamId ?? approver.currentTeamId ?? null,
  );
  await persistHostedArtifact(action, commandArtifact(request));
}

export async function confirmHostedAction(
  actionId: string,
  requester: HostedActionSession,
  options?: ConfirmHostedActionOptions,
): Promise<HostedCommandDecisionResult | void> {
  const actionScope = requester.currentTeamId
    ? { teamId: requester.currentTeamId }
    : teamWhere(sessionForTeamScope(requester)!);
  const action = await prisma.aiHostedAction.findFirst({
    where: { id: actionId, requesterId: requester.userId, ...actionScope },
  });
  if (!action) throw new NotFoundError(t("backend.ai.actionNotFoundOrNotAuthorizedToConfirm"));
  if (action.status !== "PENDING_APPROVAL") throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmation"));
  if (action.autoApproved) throw new BusinessError(t("backend.ai.autoApprovedActionsDoNotRequireManualConfirmation"));
  if (!isHostedActionType(action.actionType)) throw new BusinessError(t("backend.ai.unsupportedActionType"));
  if (
    SERVERLESS_ACTION_TYPES.has(action.actionType) &&
    action.actionType !== "run_playbook" &&
    action.actionType !== "manage_cron" &&
    action.actionType !== "create_automation_task"
  ) {
    throw new BusinessError(t("backend.ai.listQueryToolsDoNotRequireCreatingA"));
  }

  const rawParams = JSON.parse(action.params) as Record<string, unknown>;

  if (
    (action.actionType === "create_automation_task" ||
      action.actionType === "manage_cron" ||
      action.actionType === "run_playbook") &&
    action.effectiveRisk === "critical" &&
    options?.acknowledgeCritical !== true
  ) {
    throw new BusinessError(t("backend.ai.criticalAckRequired"));
  }

  if (action.actionType === "create_automation_task") {
    await executeConfirmedAutomationAction(action, requester, actionScope);
    return;
  }

  if (action.actionType === "manage_cron") {
    await executeConfirmedCronAction(action, requester, actionScope);
    return;
  }

  // Cross-module: run_playbook queues a real Playbook run (not an SSH CommandRequest).
  if (action.actionType === "run_playbook") {
    await runPlaybookHostedAction(action, requester, actionScope, rawParams);
    return;
  }

  const missing = missingHostedPermission(requester, action.actionType);
  if (missing) throw new ForbiddenError(t("backend.ai.permissionDenied.required", { permission: missing }));
  if (!action.serverId) throw new BusinessError(t("backend.ai.noTargetVpsBoundCannotCreateCommandRequest"));

  // Strict editedCommand handling: execute_command ONLY, immutable serverId/serverQuery/serverSnapshot.
  let effectiveParams = rawParams;
  let edited = false;
  if (options?.editedCommand !== undefined) {
    if (action.actionType !== "execute_command") {
      throw new BusinessError(t("backend.ai.invalidActionParameters"));
    }
    const nextCmd = options.editedCommand.trim();
    if (!nextCmd || nextCmd.length > 10_000 || nextCmd.includes("\0")) {
      throw new BusinessError(t("backend.ai.invalidActionParameters"));
    }
    const originalCommand = typeof rawParams.originalCommand === "string"
      ? rawParams.originalCommand
      : typeof rawParams.command === "string"
        ? rawParams.command
        : "";
    effectiveParams = { ...rawParams, originalCommand, command: nextCmd };
    edited = nextCmd !== originalCommand;
  }

  const commandRequestPayload = await buildAssistantCommandRequestPayload({
    tool: hostedActionTool(action),
    args: effectiveParams,
    userId: requester.userId,
    serverId: action.serverId,
    teamId: action.teamId ?? requester.currentTeamId ?? null,
  });

  const serverRow = await prisma.server.findFirst({
    where: { id: action.serverId, teamId: action.teamId ?? requester.currentTeamId ?? null },
    select: { operatingSystem: true },
  });
  const assessment = classifyCommandRisk(
    commandRequestPayload.command,
    typeof serverRow?.operatingSystem === "string" ? serverRow.operatingSystem : "LINUX",
  );
  const effectiveRisk = maxRiskLevel(action.riskLevel as CommandRiskLevel, assessment.level);
  const policies = await getApprovalPolicySettings({ fresh: true });
  const submitterMayExecute = sessionHasPermission(requester, "command:execute");
  const decision = decideCommandApproval({
    policies,
    origin: "AI_CHAT",
    riskLevel: effectiveRisk,
    denylisted: assessment.denylisted,
    submitterMayExecute,
    requestedReview: false,
  });
  const canSelfApprove = maySelfReviewCommands(requester, policies.commandSelfReview);
  const criticalNeedsAck = (assessment.denylisted || effectiveRisk === "critical") && options?.acknowledgeCritical !== true;
  const runInlineDirect = submitterMayExecute && !decision.requiresApproval && !criticalNeedsAck;
  const runInlineSelfReview = submitterMayExecute && decision.requiresApproval && canSelfApprove && !criticalNeedsAck;
  const willExecuteInline = runInlineDirect || runInlineSelfReview;
  const decisionSource: CommandDecisionSource | undefined = runInlineSelfReview
    ? "SELF_REVIEW"
    : runInlineDirect
      ? "REQUESTER_CONFIRMED"
      : undefined;

  // Atomic compare-and-swap: persist edited command + reclassified risk inside the claim itself.
  const claimed = await claimPendingHostedAction(
    action,
    requester,
    actionScope,
    willExecuteInline ? "EXECUTING" : "APPROVED",
    {
      ...(edited ? { params: JSON.stringify(effectiveParams) } : {}),
      effectiveRisk,
      riskReasons: assessment.reasons,
      ...(decisionSource ? { decisionSource } : {}),
    },
  );
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
  }

  let request: Awaited<ReturnType<typeof createCommandRequest>>;
  try {
    request = await createCommandRequest(
      {
        ...commandRequestPayload,
        approvalRequired: !willExecuteInline,
        idempotencyKey: `ai-hosted-action:${actionId}`,
      },
      { ...requester, currentTeamId: requester.currentTeamId ?? null },
      undefined,
      async (tx, commandRequestId) => {
        await tx.aiHostedAction.updateMany({ where: { id: actionId }, data: { commandRequestId } });
      },
      {
        origin: "AI_CHAT",
        ...(runInlineSelfReview
          ? {
              approveOnCreate: {
                approverId: requester.userId,
                decisionSource: "SELF_REVIEW" as const,
                comment: "Confirmed and self-approved inline on AI assistant",
              },
            }
          : decisionSource
            ? { decisionSource }
            : {}),
      },
    );
  } catch (error) {
    await recordArtifactCreationError(action, error);
    return;
  }

  await auditUserAction(
    requester.userId,
    request.requiresApproval ? "ai.hosted-action.submit" : "ai.hosted-action.execute",
    {
      actionId,
      commandRequestId: request.id,
      actionType: action.actionType,
      effectiveRisk,
      decisionSource: decisionSource ?? null,
      requiresApproval: request.requiresApproval,
      edited,
      ...commandDigest(commandRequestPayload.command),
    },
    undefined,
    action.teamId ?? requester.currentTeamId ?? null,
  );
  await persistHostedArtifact(action, commandArtifact(request));
  return {
    executedInline: !request.requiresApproval,
    commandRequestId: request.id,
    requiresApproval: request.requiresApproval,
    status: request.requiresApproval ? "APPROVED" : "EXECUTING",
  };
}

export async function rejectHostedAction(actionId: string, actor: HostedActionSession, reason?: string) {
  const canApprove = sessionHasPermission(actor, "ai:action:approve");
  const approvalScope = actor.currentTeamId
    ? { teamId: actor.currentTeamId }
    : teamWhere(sessionForTeamScope(actor)!);
  // Scope approvers to the selected customer; requesters may only cancel self.
  const where = canApprove
    ? { id: actionId, status: "PENDING_APPROVAL" as const, ...approvalScope }
    : { id: actionId, status: "PENDING_APPROVAL" as const, requesterId: actor.userId, ...approvalScope };
  return withHostedToolWrite(actionId, async (tx) => {
    const claimed = await tx.aiHostedAction.updateMany({
      where,
      data: {
        status: "REJECTED",
        approverId: actor.userId,
        errorMessage:
          reason ||
          t(
            canApprove
              ? "backend.ai.approvalRejected"
              : "backend.ai.confirmationCancelled",
          ),
      },
    });
    if (claimed.count === 0) {
      const action = await tx.aiHostedAction.findFirst({
        where: canApprove
          ? { id: actionId, ...approvalScope }
          : { id: actionId, requesterId: actor.userId },
      });
      if (!action) {
        if (canApprove) throw new NotFoundError(t("backend.ai.actionNotFoundOrNotAuthorizedToApprove"));
        throw new NotFoundError(t("backend.ai.actionNotFoundOrNotAuthorizedToCancel"));
      }
      throw new BusinessError(canApprove ? t("backend.ai.actionIsNotPendingApproval") : t("backend.ai.actionIsNotPendingConfirmation"));
    }
    const action = await tx.aiHostedAction.findUniqueOrThrow({
      where: { id: actionId },
    });
    await persistHostedToolOutcome(action, {
      success: false,
      status: "REJECTED",
      error: action.errorMessage,
    }, tx);
    return action;
  });
}

// ── 获取待审批操作 ────────────────────────────────────────

function pendingActionScope(session: HostedActionSession) {
  return { status: "PENDING_APPROVAL" as const, requesterId: session.userId,
    conversation: { teamId: session.currentTeamId ?? null }, ...teamWhere(sessionForTeamScope(session)!) };
}

export async function getPendingActions(session: HostedActionSession, page?: { after?: string; take: number }) {
  const scope = pendingActionScope(session);
  const actions = await prisma.aiHostedAction.findMany({
    where: page?.after ? { AND: [scope, createdBeforeCursor(page.after)] } : scope,
    include: { message: { select: { id: true, conversationId: true, role: true, createdAt: true } } },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: page?.take ?? 200,
  });
  return actions.map(withHostedServerSnapshot);
}

export async function getPendingActionPage(session: HostedActionSession, after?: string) {
  const take = 20;
  const [rows, total] = await Promise.all([
    getPendingActions(session, { after, take: take + 1 }),
    prisma.aiHostedAction.count({ where: pendingActionScope(session) }),
  ]);
  const last = rows[take - 1];
  return { actions: rows.slice(0, take), total,
    nextCursor: rows.length > take && last ? last.createdAt.getTime() + "." + last.id : null };
}

/** Hold the saved definition stable from target comparison until its worker snapshot commits. */
async function queueReviewedPlaybook(playbookId: string, targets: unknown, actionId: string, actor: HostedActionSession) {
  const { queuePlaybookRunWithClient } = await import("@/lib/playbook/run-queue");
  const { auditUserAction } = await import("@/lib/audit/service");
  const session = { ...actor, currentTeamId: actor.currentTeamId ?? null };
  const { run, teamId, stepCount } = await prisma.$transaction(async (tx) => {
    await lockForTransaction(tx, "playbook-lifecycle", playbookId);
    await tx.$queryRaw`SELECT id FROM playbooks WHERE id = ${playbookId} FOR SHARE`;
    const playbook = await tx.playbook.findFirst({
      where: { id: playbookId, enabled: true, ...playbookTeamWhere(session) },
      select: { id: true, name: true, steps: true, chainRetry: true, createdById: true, teamId: true },
    });
    if (!playbook || !Array.isArray(playbook.steps)) throw new BusinessError(t("backend.ai.automationProposalChanged"));
    const serverIds = playbookTargets(playbook.steps);
    if (JSON.stringify(targets) !== JSON.stringify(serverIds)) throw new BusinessError(t("backend.ai.automationProposalChanged"));
    const steps = playbook.steps as unknown as PlaybookStep[];
    if (steps.some((step) => step.type === "run_command") && !sessionHasPermission(session, "command:execute")) {
      throw new ForbiddenError(t("backend.ai.permissionDenied.required", { permission: "command:execute" }));
    }
    if (serverIds.length) {
      const count = await tx.server.count({ where: { id: { in: serverIds }, ...serverTeamWhere(session, "connect") } });
      if (count !== serverIds.length) throw new BusinessError(t("backend.ai.automationSelectedTargetsUnavailable"));
    }
    const queued = await queuePlaybookRunWithClient({ client: tx, playbook: { ...playbook, steps }, dryRun: false,
      createdById: actor.userId, triggerKey: "ai-hosted-action:" + actionId, triggerContext: { source: "ai_hosted_action", hostedActionId: actionId } });
    return { run: queued.run, teamId: playbook.teamId, stepCount: steps.length };
  });
  await auditUserAction(actor.userId, "playbook.run", { playbookId, runId: run.id, dryRun: false, status: run.status, stepCount }, undefined, teamId);
  return run;
}

/**
 * Queue the Playbook run a `run_playbook` action asks for. Shared by the
 * requester's confirmation and an approver's approval (A7-03): approval used
 * to refuse the action as a "query tool", so Playbook actions could only ever
 * be self-confirmed.
 */
async function runPlaybookHostedAction(
  action: Awaited<ReturnType<typeof prisma.aiHostedAction.findFirstOrThrow>>,
  actor: HostedActionSession,
  actionScope: Record<string, unknown>,
  params: Record<string, unknown>,
) {
  if (!sessionHasPermission(actor, "playbook:run")) {
    throw new ForbiddenError(t("backend.ai.missingPermissionPlaybookRun"));
  }
  const playbook = await resolvePlaybookId(params, actor);
  if (!playbook) throw new BusinessError(t("backend.ai.playbookNotFoundOrOutsideTeamScope"));

  if (!Array.isArray(params.targetServerIds) && (params.serverId || params.serverQuery || action.serverId)) {
    throw new BusinessError(t("backend.ai.automationProposalChanged"));
  }
  if (params.targetServerIds && JSON.stringify(params.targetServerIds) !== JSON.stringify(playbookTargets(playbook.steps))) {
    throw new BusinessError(t("backend.ai.automationProposalChanged"));
  }
  const claimed = await claimPendingHostedAction(action, actor, actionScope, "APPROVED");
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
  }

  const { runPlaybook } = await import("@/lib/playbook/service");
  let run: { id: string; status: string };
  try {
    run = Array.isArray(params.targetServerIds)
      ? await queueReviewedPlaybook(playbook.id, params.targetServerIds, action.id, actor)
      : await runPlaybook({
      playbookId: playbook.id,
      dryRun: false,
      createdById: actor.userId,
      session: {
        ...actor,
        currentTeamId: actor.currentTeamId ?? null,
      },
      triggerContext: {
        source: "ai_hosted_action",
        hostedActionId: action.id,
      },
    });
  } catch (error) {
    return recordArtifactCreationError(action, error);
  }
  await persistHostedArtifact(action, playbookArtifact(playbook.id, playbook.name, run));
}
