/**
 * AI 托管服务 — 处理 AI 发起的 VPS 操作
 * 
 * 流程：
 * 1. AI 返回 tool_call → 解析工具名和参数
 * 2. 安全操作（autoApproved）→ 直接执行 → 返回结果给 AI
 * 3. 危险操作 → 创建审批请求 → 等待用户审批 → 执行 → 返回结果
 */

import { sessionHasPermission } from "@/lib/auth/authorization";
import type { RoleKey } from "@/lib/auth/rbac";
import { serverTeamWhere, teamWhere } from "@/lib/auth/team-scope";
import { createCommandRequest } from "@/lib/command/service";
import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createVerifiedSshConfig } from "@/lib/ssh/client";
import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { deserializeDialect } from "@/lib/ssh/os-dialect";
import { buildCommand } from "./hosted-command-builder";
export { buildCommand } from "./hosted-command-builder";
import { getToolByName, type HostedTool } from "./hosted-tools";
import { executeServerlessQuery } from "./hosted-safe-queries";
import { t } from "@/lib/i18n/service-translations";
import { executeAutomationProposal, materializeAutomationProposal } from "./automation-service";

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

// ── 创建托管操作记录 ──────────────────────────────────────

export async function createHostedAction(input: {
  conversationId: string;
  messageId: string;
  toolCallId: string;
  tool: HostedTool;
  args: Record<string, unknown>;
  userId: string;
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
  const args = tool.actionType === "create_automation_task"
    ? await materializeAutomationProposal(input.args, session)
    : input.args;
  const serverId = await resolveServerId(args, session);
  const resolvedServer = serverId
    ? await prisma.server.findUnique({ where: { id: serverId }, select: { teamId: true } })
    : null;
  const teamId = session.currentTeamId ?? resolvedServer?.teamId ?? null;
  const params = { ...args, ...(serverId ? { serverId } : {}) };
  return prisma.aiHostedAction.create({
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
  });
}

// ── 执行安全操作（通过 SSH） ───────────────────────────────

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
  const server = await prisma.server.findFirst({
    where: {
      id: action.serverId,
      ...(scope ? serverTeamWhere(scope) : { teamId: null }),
    },
    include: { sshKey: true },
  });

  if (!server) {
    return { success: false, data: null, error: t( "backend.ai.serverNotFound", locale), };
  }

  try {
    const { Client } = await import("ssh2");
    const sshClient = new Client();

    return new Promise((resolve) => {
      const connectConfig = createVerifiedSshConfig({
        host: server.host,
        port: server.port,
        username: server.username,
        hostKeySha256: server.hostKeySha256,
        ...(server.sshKey?.privateKey
          ? { privateKey: decryptSshPrivateKey(server.sshKey.privateKey) }
          : server.password
            ? { password: decryptServerPassword(server.password) }
            : {}),
      });
      connectConfig.readyTimeout = 10000;

      sshClient.on("ready", () => {
        if (!isHostedActionType(action.actionType)) {
          sshClient.end();
          resolve({ success: false, data: null, error: t("backend.ai.unsupportedActionType", locale) });
          return;
        }
        const dialect = server.osDialect ? deserializeDialect(server.osDialect) : undefined;
        const command = buildCommand(action.actionType, action.params, dialect);
        if (!command) {
          sshClient.end();
          resolve({ success: false, data: null, error: t("backend.ai.unsupportedActionType", locale) });
          return;
        }

        sshClient.exec(command, { pty: false }, (err, stream) => {
          if (err) {
            sshClient.end();
            resolve({ success: false, data: null, error: err.message });
            return;
          }

          let stdout = "";
          let stderr = "";
          stream.on("data", (data: Buffer) => { stdout += data.toString(); });
          stream.stderr.on("data", (data: Buffer) => { stderr += data.toString(); });
          stream.on("close", (code: number) => {
            sshClient.end();
            resolve({
              success: code === 0,
              data: { stdout: stdout.slice(-5000), stderr: stderr.slice(-2000), exitCode: code },
              error: code !== 0
                ? t("backend.ai.commandExecutionFailed", locale, { code })
                : undefined,
            });
          });
        });
      });

      sshClient.on("error", (err) => {
        sshClient.end();
        resolve({
          success: false,
          data: null,
          error: t("backend.ai.sshConnectionFailed", locale, {
            error: err.message,
          }),
        });
      });

      sshClient.connect(connectConfig);
    });
  } catch (err) {
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

async function persistHostedToolOutcome(
  action: {
    id: string;
    conversationId: string;
    toolCallId: string | null;
  },
  outcome: Record<string, unknown>,
) {
  if (!action.toolCallId) return;
  const content = JSON.stringify({ actionId: action.id, ...outcome });
  const updated = await prisma.aiMessage.updateMany({
    where: {
      conversationId: action.conversationId,
      role: "tool",
      toolCallId: action.toolCallId,
    },
    data: { content },
  });
  if (updated.count > 0) return;
  await prisma.aiMessage.create({
    data: {
      conversationId: action.conversationId,
      role: "tool",
      toolCallId: action.toolCallId,
      content,
    },
  });
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
) {
  const permission = requiredPermissionForAction(action.actionType);
  if (!sessionHasPermission(actor, permission)) {
    throw new ForbiddenError(permissionDeniedMessage(action.actionType));
  }

  const claimed = await prisma.aiHostedAction.updateMany({
    where: { id: action.id, status: "PENDING_APPROVAL" },
    data: {
      status: "EXECUTING",
      approverId: actor.userId,
      approvedAt: new Date(),
      executedAt: new Date(),
    },
  });
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
  action: {
    id: string;
    conversationId: string;
    toolCallId: string | null;
    actionType: string;
    params: string;
  },
  actor: HostedActionSession,
) {
  const claimed = await prisma.aiHostedAction.updateMany({
    where: { id: action.id, status: "PENDING_APPROVAL" },
    data: {
      status: "EXECUTING",
      approverId: actor.userId,
      approvedAt: new Date(),
      executedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
  }

  try {
    const result = await executeAutomationProposal(
      JSON.parse(action.params) as Record<string, unknown>,
      actor,
      action.id,
    );
    await prisma.aiHostedAction.update({
      where: { id: action.id },
      data: {
        status: "COMPLETED",
        result: JSON.stringify(result),
        completedAt: new Date(),
      },
    });
    await persistHostedToolOutcome(action, { success: true, status: "COMPLETED", data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : t("backend.ai.unknownError");
    await prisma.aiHostedAction.update({
      where: { id: action.id },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
    });
    await persistHostedToolOutcome(action, { success: false, status: "FAILED", error: message });
  }
}

export async function approveHostedAction(actionId: string, approver: HostedActionSession) {
  if (!sessionHasPermission(approver, "ai:action:approve")) throw new ForbiddenError(t("backend.ai.missingPermissionAiActionApprove"));

  // An approver acts inside the selected workspace. Platform managers with no
  // selected workspace retain the explicit global recovery path for legacy rows.
  const approvalScope = approver.currentTeamId
    ? { teamId: approver.currentTeamId }
    : teamWhere(sessionForTeamScope(approver)!);
  const action = await prisma.aiHostedAction.findFirst({
    where: { id: actionId, ...approvalScope },
  });
  if (!action) throw new NotFoundError(t("backend.ai.actionNotFoundOrNotAuthorizedToApprove"));
  if (action.status !== "PENDING_APPROVAL") throw new BusinessError(t("backend.ai.actionIsNotPendingApproval"));
  if (!isHostedActionType(action.actionType)) throw new BusinessError(t("backend.ai.unsupportedActionType"));
  if (action.actionType === "create_automation_task") {
    await executeConfirmedAutomationAction(action, approver);
    return;
  }
  if (action.actionType === "manage_cron") {
    await executeConfirmedServerlessAction(action, approver);
    return;
  }
  if (SERVERLESS_ACTION_TYPES.has(action.actionType)) {
    throw new BusinessError(t("backend.ai.listQueryToolsDoNotRequireCreatingA"));
  }
  if (!sessionHasPermission(approver, "server:ssh")) throw new ForbiddenError(t("backend.ai.missingPermissionServerSsh"));
  if (!action.serverId) throw new BusinessError(t("backend.ai.noTargetVpsBoundCannotCreateCommandRequest"));

  const params = JSON.parse(action.params) as Record<string, unknown>;
  const commandRequestPayload = await buildAssistantCommandRequestPayload({
    tool: {
      name: action.actionType,
      description: "",
      parameters: {},
      riskLevel: action.riskLevel as HostedTool["riskLevel"],
      autoApproved: action.autoApproved,
      actionType: action.actionType,
      actionName: action.actionName,
    },
    args: params,
    userId: action.requesterId,
    serverId: action.serverId,
    teamId: action.teamId ?? approver.currentTeamId ?? null,
  });

  // Stable idempotency bridges retries/races to one durable CommandRequest.
  const request = await createCommandRequest(
    { ...commandRequestPayload, idempotencyKey: `ai-hosted-action:${actionId}` },
    {
      userId: approver.userId,
      roles: approver.roles,
      currentTeamId: approver.currentTeamId ?? null,
    },
  );

  // Atomic compare-and-swap: only transition this workspace's pending action.
  const claimed = await prisma.aiHostedAction.updateMany({
    where: { id: actionId, status: "PENDING_APPROVAL", ...approvalScope },
    data: { status: "APPROVED", approverId: approver.userId, approvedAt: new Date() },
  });
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingApproval"));
  }

  await prisma.aiHostedAction.update({
    where: { id: actionId },
    data: {
      result: JSON.stringify({
        commandRequestId: request.id,
        requiresApproval: request.requiresApproval,
      }),
    },
  });
  await persistHostedToolOutcome(action, {
    success: true,
    status: "APPROVED",
    commandRequestId: request.id,
    requiresApproval: request.requiresApproval,
  });
}

export async function confirmHostedAction(actionId: string, requester: HostedActionSession) {
  const action = await prisma.aiHostedAction.findFirst({ where: { id: actionId, requesterId: requester.userId } });
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
    await executeConfirmedAutomationAction(action, requester);
    return;
  }

  if (action.actionType === "manage_cron") {
    await executeConfirmedServerlessAction(action, requester);
    return;
  }

  // Cross-module: run_playbook queues a real Playbook run (not an SSH CommandRequest).
  if (action.actionType === "run_playbook") {
    if (!sessionHasPermission(requester, "playbook:run")) {
      throw new ForbiddenError(t("backend.ai.missingPermissionPlaybookRun"));
    }
    const playbook = await resolvePlaybookId(params, requester);
    if (!playbook) throw new BusinessError(t("backend.ai.playbookNotFoundOrOutsideTeamScope"));

    const claimed = await prisma.aiHostedAction.updateMany({
      where: { id: actionId, status: "PENDING_APPROVAL" },
      data: {
        status: "APPROVED",
        approverId: requester.userId,
        approvedAt: new Date(),
      },
    });
    if (claimed.count === 0) {
      throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
    }

    const { runPlaybook } = await import("@/lib/playbook/service");
    const run = await runPlaybook({
      playbookId: playbook.id,
      dryRun: false,
      createdById: requester.userId,
      session: {
        userId: requester.userId,
        roles: requester.roles,
        currentTeamId: requester.currentTeamId ?? null,
      },
      triggerContext: {
        source: "ai_hosted_action",
        hostedActionId: actionId,
        serverId: typeof params.serverId === "string" ? params.serverId : action.serverId,
      },
    });

    await prisma.aiHostedAction.update({
      where: { id: actionId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        result: JSON.stringify({
          playbookId: playbook.id,
          playbookName: playbook.name,
          runId: run.id,
          status: run.status,
        }),
      },
    });
    await persistHostedToolOutcome(action, {
      success: true,
      status: "COMPLETED",
      playbookId: playbook.id,
      runId: run.id,
      runStatus: run.status,
    });
    return;
  }

  if (!sessionHasPermission(requester, "server:ssh")) throw new ForbiddenError(t("backend.ai.missingPermissionServerSsh"));
  if (!action.serverId) throw new BusinessError(t("backend.ai.noTargetVpsBoundCannotCreateCommandRequest"));

  const commandRequestPayload = await buildAssistantCommandRequestPayload({
    tool: {
      name: action.actionType,
      description: "",
      parameters: {},
      riskLevel: action.riskLevel as HostedTool["riskLevel"],
      autoApproved: action.autoApproved,
      actionType: action.actionType,
      actionName: action.actionName,
    },
    args: params,
    userId: requester.userId,
    serverId: action.serverId,
    teamId: action.teamId ?? requester.currentTeamId ?? null,
  });

  // Atomic compare-and-swap: prevent two concurrent confirmations from
  // both creating a command request and overwriting APPROVED state.
  const claimed = await prisma.aiHostedAction.updateMany({
    where: { id: actionId, status: "PENDING_APPROVAL" },
    data: {
      status: "APPROVED",
      approverId: requester.userId,
      approvedAt: new Date(),
    },
  });
  if (claimed.count === 0) {
    throw new BusinessError(t("backend.ai.actionIsNotPendingConfirmationMayHaveJust"));
  }

  const request = await createCommandRequest(commandRequestPayload, {
    userId: requester.userId,
    roles: requester.roles,
    currentTeamId: requester.currentTeamId ?? null,
  });
  const commandRequest = { commandRequestId: request.id, requiresApproval: request.requiresApproval };

  await prisma.aiHostedAction.update({
    where: { id: actionId },
    data: { result: JSON.stringify(commandRequest) },
  });
  await persistHostedToolOutcome(action, {
    success: true,
    status: "APPROVED",
    ...commandRequest,
  });
}

export async function rejectHostedAction(actionId: string, actor: HostedActionSession, reason?: string) {
  const canApprove = sessionHasPermission(actor, "ai:action:approve");
  const approvalScope = actor.currentTeamId
    ? { teamId: actor.currentTeamId }
    : teamWhere(sessionForTeamScope(actor)!);
  // Scope approvers to the selected workspace; requesters may only cancel self.
  const where = canApprove
    ? { id: actionId, status: "PENDING_APPROVAL" as const, ...approvalScope }
    : { id: actionId, status: "PENDING_APPROVAL" as const, requesterId: actor.userId };
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

export async function getPendingActions(userId: string) {
  return prisma.aiHostedAction.findMany({
    where: { status: "PENDING_APPROVAL", requesterId: userId },
    include: { server: { select: { id: true, name: true, host: true } }, message: true },
    orderBy: { createdAt: "desc" },
    take: 200, // P2: 单用户 PENDING 操作数有限
  });
}
