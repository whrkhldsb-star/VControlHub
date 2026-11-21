/**
 * AI 托管服务 — 处理 AI 发起的 VPS 操作
 *
 * 流程：
 * 1. AI 返回 tool_call → 解析工具名和参数
 * 2. 安全操作（autoApproved）→ 直接执行 → 返回结果给 AI
 * 3. 危险操作 → 创建审批请求 → 等待用户审批 → 执行 → 返回结果
 */

import type { AiAutomationMode, Prisma } from "@prisma/client";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { RoleKey } from "@/lib/auth/rbac";
import { serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { createCommandRequest } from "@/lib/command/service";
import { createCommandSchema } from "@/lib/command/schema";
import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { buildSshParamsFromServer, execRemoteCommand } from "@/lib/ssh/client";
import { deserializeDialect } from "@/lib/ssh/os-dialect";
import { executeCommandWithAgent } from "@/lib/server/agent-service";
import { buildCommand } from "./hosted-command-builder";
export { buildCommand } from "./hosted-command-builder";
import { getToolByName, HOSTED_TOOLS, toolAvailableInMode, type HostedTool } from "./hosted-tools";
import { executeServerlessQuery } from "./hosted-safe-queries";
import { t } from "@/lib/i18n/service-translations";
import { executeAutomationProposal, materializeAutomationProposal, scheduledAutomationTaskId } from "./automation-service";
import { firstSchemaSentence } from "@/lib/i18n/schema-copy";

import {
  buildAssistantCommandRequestPayload,
  isHostedActionType,
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
    // Malformed JSON arguments — default to empty so the tool call can still be surfaced.
    args = {};
  }

  return { toolCallId: tc.id, tool, args };
}

/**
 * The playbook is chosen when the action is proposed, not when it is confirmed: the card names the playbook that will
 * run (it used to carry whatever name the model wrote, matched loosely at confirm time to the most recently updated
 * one), and a name that fits none or several comes back to the model as an error to correct.
 */
async function materializePlaybookProposal(
  args: Record<string, unknown>,
  session: HostedActionSession,
): Promise<Record<string, unknown>> {
  const playbook = await resolvePlaybookId(args, session);
  if (!playbook) throw new BusinessError(t("backend.ai.playbookNotFoundOrOutsideTeamScope"));
  return { ...args, playbookId: playbook.id, playbookName: playbook.name };
}

// ── 创建托管操作记录 ──────────────────────────────────────

function withHostedActionMode<T>(
  conversationId: string,
  actionType: string,
  write: (tx: Prisma.TransactionClient) => Promise<T>,
) {
  return prisma.$transaction(async (tx) => {
    // A mode switch and the creation or claim of a card must agree on their order.
    // Hold the conversation row only for this write, before any external execution.
    const [conversation] = await tx.$queryRaw<Array<{ hostingEnabled: boolean; automationMode: AiAutomationMode }>>`
      SELECT "hostingEnabled", "automationMode" FROM ai_conversations WHERE id = ${conversationId} FOR SHARE`;
    if (!conversation) throw new NotFoundError(t("backend.ai.conversationNotFound"));
    if (!conversation.hostingEnabled) throw new BusinessError(t("backend.ai.hostingDisabled"));
    const tool = HOSTED_TOOLS.find((entry) => entry.actionType === actionType);
    if (!tool) throw new BusinessError(t("backend.ai.unsupportedActionType"));
    if (!toolAvailableInMode(tool, conversation.automationMode)) {
      throw new BusinessError(t("apiAiChat.toolUnavailableInPlanMode", { name: tool.name }));
    }
    return write(tx);
  });
}

export async function createHostedAction(input: {
  conversationId: string;
  messageId: string;
  toolCallId: string;
  tool: HostedTool;
  args: Record<string, unknown>;
  userId: string;
  revalidate?: () => Promise<void>;
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
  const automation = tool.actionType === "create_automation_task"
    ? await materializeAutomationProposal(input.args, session)
    : null;
  const args = automation ?? (tool.actionType === "run_playbook"
      ? await materializePlaybookProposal(input.args, session)
      : input.args);
  const serverId = await resolveServerId(args, session);
  const resolvedServer = serverId
    ? await prisma.server.findUnique({ where: { id: serverId }, select: { teamId: true } })
    : null;
  // The server decides the customer (A7-03): an administrator viewing customer A
  // who asks about customer B's server created an action B could never confirm.
  const teamId = automation ? automation.teamId : resolvedServer?.teamId ?? session.currentTeamId ?? null;
  const params = { ...args, ...(serverId ? { serverId } : {}) };
  // A change that could never become a command request (parameters the command builder refuses, a config file
  // too long for one request) was only found out when the person confirmed it. Refused here, it is an answer the
  // model can correct, and nobody is asked to confirm something that cannot run.
  if (serverId && !tool.autoApproved && !SERVERLESS_ACTION_TYPES.has(tool.actionType)) {
    const payload = await buildAssistantCommandRequestPayload({ tool, args: params, userId, serverId, teamId: resolvedServer?.teamId ?? null });
    const parsed = createCommandSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BusinessError(firstSchemaSentence(parsed.error) ?? t("backend.ai.invalidActionParameters"));
    }
  }
  // Resolving a proposal may page through many targets before the card can be written.
  await input.revalidate?.();
  return withHostedActionMode(conversationId, tool.actionType, (tx) => tx.aiHostedAction.create({
    data: {
      conversationId,
      messageId,
      toolCallId: input.toolCallId,
      serverId,
      teamId,
      actionType: tool.actionType,
      actionName: tool.actionName,
      params: JSON.stringify(params),
      riskLevel: tool.riskLevel,
      autoApproved: tool.autoApproved,
      status: tool.autoApproved ? "APPROVED" : "PENDING_APPROVAL",
      requesterId: userId,
      approvedAt: tool.autoApproved ? new Date() : null,
    },
    // The confirmation card names the server; without this it had only the id.
    include: { server: { select: { id: true, name: true, host: true } } },
  }));
}

// ── 执行安全操作（Agent 优先，SSH 回退） ───────────────────

export async function executeSafeAction(
  action: {
    actionType: string;
    serverId: string | null;
    params: Record<string, unknown>;
  },
  context?: HostedActionExecutionContext,
): Promise<{ success: boolean; data: unknown; error?: string }> {
  const locale = context?.locale ?? "zh";
  if (context && !sessionHasPermission(context.session, context.requiredPermission ?? requiredPermissionForAction(action.actionType))) {
    return { success: false, data: null, error: permissionDeniedMessage(action.actionType, context.locale) };
  }

  const serverlessResult = await executeServerlessQuery(
    { actionType: action.actionType, params: action.params },
    sessionForTeamScope(context?.session),
    context?.locale,
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

  if (!action.serverId) {
    return { success: false, data: null, error: t( "backend.ai.noServerSpecified", locale), };
  }

  // Team-scoped server load (IDOR: never SSH into out-of-team hosts).
  const scope = sessionForTeamScope(context?.session);
  const access = scope ? serverTeamWhere(scope, "connect") : { teamId: null };
  const server = await prisma.server.findFirst({
    where: { id: action.serverId, enabled: true, AND: [access] },
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
      result = await executeCommandWithAgent({
        serverId: server.id, command, timeoutMs: 60_000,
        expectedIdentity: { tokenHash: server.agentTokenHash, teamId: server.teamId },
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
      const ssh = await buildSshParamsFromServer(server, server.sshKey);
      await context?.revalidate?.();
      result = await execRemoteCommand({ ...ssh, command, timeout: 60_000 });
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
  status: "APPROVED" | "COMPLETED";
  result: Record<string, unknown>;
  toolResult: Record<string, unknown>;
};

function commandArtifact(command: { id: string; requiresApproval: boolean }): HostedArtifact {
  const result = { commandRequestId: command.id, requiresApproval: command.requiresApproval };
  return { status: "APPROVED", result, toolResult: result };
}

function automationArtifact(result: Record<string, unknown>): HostedArtifact {
  return { status: "COMPLETED", result, toolResult: { data: result } };
}

function playbookArtifact(playbookId: string, playbookName: string | undefined, run: { id: string; status: string }): HostedArtifact {
  return {
    status: "COMPLETED",
    result: { playbookId, playbookName, runId: run.id, status: run.status },
    toolResult: { playbookId, runId: run.id, runStatus: run.status },
  };
}

function hostedArtifactUpdate(artifact: HostedArtifact, now: Date) {
  return {
    status: artifact.status,
    result: JSON.stringify(artifact.result),
    errorMessage: null,
    // The hosted handoff is complete even when its CommandRequest awaits review.
    completedAt: now,
  };
}

async function persistHostedArtifact(action: HostedActionRef, artifact: HostedArtifact) {
  await prisma.$transaction(async (tx) => {
    await tx.aiHostedAction.update({
      where: { id: action.id },
      data: hostedArtifactUpdate(artifact, new Date()),
    });
    await persistHostedToolOutcome(action, { success: true, status: artifact.status, ...artifact.toolResult }, tx);
  });
}

async function persistHostedToolOutcome(
  action: HostedActionRef,
  outcome: Record<string, unknown>,
  db: Prisma.TransactionClient = prisma,
) {
  if (!action.toolCallId) return;
  const content = JSON.stringify({ actionId: action.id, ...outcome });
  const updated = await db.aiMessage.updateMany({
    where: {
      conversationId: action.conversationId,
      role: "tool",
      toolCallId: action.toolCallId,
    },
    data: { content },
  });
  if (updated.count > 0) return;
  await db.aiMessage.create({
    data: {
      conversationId: action.conversationId,
      role: "tool",
      toolCallId: action.toolCallId,
      content,
    },
  });
}

async function persistHostedActionFailure(
  action: HostedActionRef,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : t("backend.ai.unknownError");
  await prisma.$transaction(async (tx) => {
    await tx.aiHostedAction.update({
      where: { id: action.id },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
    });
    await persistHostedToolOutcome(action, { success: false, status: "FAILED", error: message }, tx);
  });
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
  if (artifact) await persistHostedArtifact(action, artifact);
  else await persistHostedActionFailure(action, error);
}

const INTERRUPTED_ACTION_AFTER_MS = 30 * 60_000;
const ARTIFACT_PENDING_RECHECK = JSON.stringify({ verified: false, pendingRecheck: true });

export async function recoverInterruptedHostedActions(now = new Date()) {
  const cutoff = new Date(now.getTime() - INTERRUPTED_ACTION_AFTER_MS);
  const stale = await prisma.aiHostedAction.findMany({
    where: {
      OR: [
        { completedAt: null, OR: [
          { status: "EXECUTING", executedAt: { lt: cutoff } },
          { status: "APPROVED", approvedAt: { lt: cutoff } },
          { status: "EXECUTING", executedAt: null, createdAt: { lt: cutoff } },
          { status: "APPROVED", approvedAt: null, createdAt: { lt: cutoff } },
        ] },
        { status: "APPROVED", result: ARTIFACT_PENDING_RECHECK, completedAt: { lt: cutoff } },
      ],
    },
    select: { id: true, teamId: true, conversationId: true, toolCallId: true, actionType: true, params: true, result: true, status: true, approvedAt: true, executedAt: true, completedAt: true },
    orderBy: [{ completedAt: { sort: "asc", nulls: "first" } }, { createdAt: "asc" }],
    take: 50,
  });
  let recovered = 0;
  for (const action of stale) {
    const params = storedRecord(action.params);
    // Earlier releases wrote the command pointer and its tool reply separately.
    // The original receipt remains evidence even if the command has since been deleted.
    const receipt = storedRecord(action.result);
    const artifact = action.status === "APPROVED" && typeof receipt.commandRequestId === "string" && typeof receipt.requiresApproval === "boolean"
      ? commandArtifact({ id: receipt.commandRequestId, requiresApproval: receipt.requiresApproval })
      : await findHostedArtifact(action, params);
    const error = t("backend.ai.actionInterrupted");
    // A slow writer can still commit after our lookup; legacy timers may have
    // no correlation key. Retain the approval and retry the lookup on a later
    // sweep, after fresh claims. If still absent, leave it for manual review.
    const unverified = createsHostedArtifact(action.actionType);
    const rechecked = action.result === ARTIFACT_PENDING_RECHECK;
    const status = unverified ? "APPROVED" as const : "FAILED" as const;
    const data = artifact
      ? hostedArtifactUpdate(artifact, now)
      : {
        status, errorMessage: error, completedAt: now,
        ...(unverified && { result: rechecked ? JSON.stringify({ verified: false }) : ARTIFACT_PENDING_RECHECK }),
      };
    const settled = await prisma.$transaction(async (tx) => {
      const claimed = await tx.aiHostedAction.updateMany({
        where: { id: action.id, status: action.status, approvedAt: action.approvedAt, executedAt: action.executedAt, result: action.result, completedAt: action.completedAt },
        data,
      });
      if (claimed.count === 0) return false;
      if (!artifact && rechecked) return false;
      await persistHostedToolOutcome(action, artifact
        ? { success: true, status: artifact.status, ...artifact.toolResult }
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
) {
  return withHostedActionMode(action.conversationId, action.actionType, (tx) => tx.aiHostedAction.updateMany({
    where: { id: action.id, status: "PENDING_APPROVAL", ...actionScope },
    data: {
      status,
      approverId: actor.userId,
      approvedAt: new Date(),
      ...(status === "EXECUTING" && { executedAt: new Date() }),
    },
  }));
}

async function executeConfirmedServerlessAction(
  action: {
    id: string;
    conversationId: string;
    toolCallId: string | null;
    actionType: string;
    serverId: string | null;
    params: string;
  },
  actor: HostedActionSession,
  actionScope: Record<string, unknown>,
) {
  const permission = requiredPermissionForAction(action.actionType);
  if (!sessionHasPermission(actor, permission)) {
    throw new ForbiddenError(permissionDeniedMessage(action.actionType));
  }

  const claimed = await claimPendingHostedAction(action, actor, actionScope, "EXECUTING");
  if (claimed.count === 0) {
    throw new BusinessError(
      t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"),
    );
  }

  const params = JSON.parse(action.params) as Record<string, unknown>;
  let execution: Awaited<ReturnType<typeof executeSafeAction>>;
  try {
    execution = await executeSafeAction(
      { actionType: action.actionType, serverId: action.serverId, params },
      { session: actor, requiredPermission: permission },
    );
  } catch (error) {
    execution = {
      success: false,
      data: null,
      error:
        error instanceof Error
          ? error.message
          : t("backend.ai.unknownError"),
    };
  }

  await prisma.aiHostedAction.update({
    where: { id: action.id },
    data: {
      status: execution.success ? "COMPLETED" : "FAILED",
      result: JSON.stringify(execution.data ?? null),
      errorMessage: execution.error ?? null,
      completedAt: new Date(),
    },
  });
  await persistHostedToolOutcome(action, {
    success: execution.success,
    status: execution.success ? "COMPLETED" : "FAILED",
    data: execution.data ?? null,
    error: execution.error ?? null,
  });
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
    await recordArtifactCreationError(action, error);
    throw error;
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
  if (action.actionType === "create_automation_task") {
    await executeConfirmedAutomationAction(action, approver, actionScope);
    return;
  }
  if (action.actionType === "manage_cron") {
    await executeConfirmedServerlessAction(action, approver, actionScope);
    return;
  }
  if (action.actionType === "run_playbook") {
    await runPlaybookHostedAction(action, approver, actionScope, JSON.parse(action.params) as Record<string, unknown>);
    return;
  }
  if (SERVERLESS_ACTION_TYPES.has(action.actionType)) {
    throw new BusinessError(t("backend.ai.listQueryToolsDoNotRequireCreatingA"));
  }
  if (!sessionHasPermission(approver, "server:ssh")) throw new ForbiddenError(t("backend.ai.missingPermissionServerSsh"));
  if (!action.serverId) throw new BusinessError(t("backend.ai.noTargetVpsBoundCannotCreateCommandRequest"));

  const params = JSON.parse(action.params) as Record<string, unknown>;
  const commandRequestPayload = await buildAssistantCommandRequestPayload({
    tool: hostedActionTool(action),
    args: params,
    userId: action.requesterId,
    serverId: action.serverId,
    teamId: action.teamId ?? approver.currentTeamId ?? null,
  });

  // Atomic compare-and-swap first, as confirmHostedAction does: creating the
  // command before it let a rejection that won the swap leave a command
  // request behind that still ran.
  const claimed = await claimPendingHostedAction(action, approver, actionScope, "APPROVED");
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingApproval"));
  }

  // Stable idempotency bridges retries/races to one durable CommandRequest.
  let request: Awaited<ReturnType<typeof createCommandRequest>>;
  try {
    request = await createCommandRequest(
      { ...commandRequestPayload, idempotencyKey: `ai-hosted-action:${actionId}` },
      {
        ...approver,
        currentTeamId: approver.currentTeamId ?? null,
      },
    );
  } catch (error) {
    await recordArtifactCreationError(action, error);
    throw error;
  }

  await persistHostedArtifact(action, commandArtifact(request));
}

export async function confirmHostedAction(actionId: string, requester: HostedActionSession) {
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

  const params = JSON.parse(action.params) as Record<string, unknown>;

  if (action.actionType === "create_automation_task") {
    await executeConfirmedAutomationAction(action, requester, actionScope);
    return;
  }

  if (action.actionType === "manage_cron") {
    await executeConfirmedServerlessAction(action, requester, actionScope);
    return;
  }

  // Cross-module: run_playbook queues a real Playbook run (not an SSH CommandRequest).
  if (action.actionType === "run_playbook") {
    await runPlaybookHostedAction(action, requester, actionScope, params);
    return;
  }

  if (!sessionHasPermission(requester, "server:ssh")) throw new ForbiddenError(t("backend.ai.missingPermissionServerSsh"));
  if (!action.serverId) throw new BusinessError(t("backend.ai.noTargetVpsBoundCannotCreateCommandRequest"));

  const commandRequestPayload = await buildAssistantCommandRequestPayload({
    tool: hostedActionTool(action),
    args: params,
    userId: requester.userId,
    serverId: action.serverId,
    teamId: action.teamId ?? requester.currentTeamId ?? null,
  });

  // Atomic compare-and-swap: prevent two concurrent confirmations from
  // both creating a command request and overwriting APPROVED state.
  const claimed = await claimPendingHostedAction(action, requester, actionScope, "APPROVED");
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
  }

  let request: Awaited<ReturnType<typeof createCommandRequest>>;
  try {
    request = await createCommandRequest(
      { ...commandRequestPayload, idempotencyKey: `ai-hosted-action:${actionId}` },
      { ...requester, currentTeamId: requester.currentTeamId ?? null },
    );
  } catch (error) {
    await recordArtifactCreationError(action, error);
    throw error;
  }

  await persistHostedArtifact(action, commandArtifact(request));
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
  const claimed = await prisma.aiHostedAction.updateMany({
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
    const action = await prisma.aiHostedAction.findFirst({
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
  const action = await prisma.aiHostedAction.findUniqueOrThrow({
    where: { id: actionId },
  });
  await persistHostedToolOutcome(action, {
    success: false,
    status: "REJECTED",
    error: action.errorMessage,
  });
  return action;
}

// ── 获取待审批操作 ────────────────────────────────────────

export async function getPendingActions(session: HostedActionSession) {
  return prisma.aiHostedAction.findMany({
    where: { status: "PENDING_APPROVAL", requesterId: session.userId, conversation: { teamId: session.currentTeamId ?? null }, ...teamWhere(sessionForTeamScope(session)!) },
    include: { server: { select: { id: true, name: true, host: true } }, message: true },
    orderBy: { createdAt: "desc" },
    take: 200, // P2: 单用户 PENDING 操作数有限
  });
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

  const claimed = await claimPendingHostedAction(action, actor, actionScope, "APPROVED");
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
  }

  const { runPlaybook } = await import("@/lib/playbook/service");
  let run: Awaited<ReturnType<typeof runPlaybook>>;
  try {
    run = await runPlaybook({
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
        serverId: typeof params.serverId === "string" ? params.serverId : action.serverId,
      },
    });
  } catch (error) {
    await recordArtifactCreationError(action, error);
    throw error;
  }
  await persistHostedArtifact(action, playbookArtifact(playbook.id, playbook.name, run));
}
