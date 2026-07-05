/**
 * AI 托管服务 — 处理 AI 发起的 VPS 操作
 * 
 * 流程：
 * 1. AI 返回 tool_call → 解析工具名和参数
 * 2. 安全操作（autoApproved）→ 直接执行 → 返回结果给 AI
 * 3. 危险操作 → 创建审批请求 → 等待用户审批 → 执行 → 返回结果
 */

import { sessionHasPermission } from "@/lib/auth/authorization";
import type { Permission, RoleKey } from "@/lib/auth/rbac";
import { createCommandRequest } from "@/lib/command/service";
import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { createVerifiedSshConfig } from "@/lib/ssh/client";
import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";
import { deserializeDialect } from "@/lib/ssh/os-dialect";
import { buildCommand } from "./hosted-command-builder";
export { buildCommand } from "./hosted-command-builder";
import { getToolByName, type HostedActionType, type HostedTool } from "./hosted-tools";

// ── 类型 ──────────────────────────────────────────────────

interface ToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string; // JSON string
  };
}

type HostedActionSession = {
  userId: string;
  roles: RoleKey[];
};

type HostedActionExecutionContext = {
  session: HostedActionSession;
  requiredPermission?: Permission;
};

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
    args = {};
  }

  return { toolCallId: tc.id, tool, args };
}

// ── VPS 解析与命令审批桥接 ─────────────────────────────────

async function resolveServerId(args: Record<string, unknown>): Promise<string | null> {
  const explicitId = typeof args.serverId === "string" ? args.serverId.trim() : "";
  if (explicitId) return explicitId;

  const query = typeof args.serverQuery === "string" ? args.serverQuery.trim() : "";
  if (!query) return null;

  const server = await prisma.server.findFirst({
    where: {
      OR: [
        { id: query },
        { name: { contains: query } },
        { host: { contains: query } },
      ],
    },
    select: { id: true, name: true, host: true },
  });

  return server?.id ?? null;
}

async function createAssistantCommandRequest(input: {
  tool: HostedTool;
  args: Record<string, unknown>;
  userId: string;
  serverId: string;
}) {
  // TR-041: 加载 server 的 osDialect 以支持方言感知命令生成
  const server = await prisma.server.findUnique({
    where: { id: input.serverId },
    select: { osDialect: true },
  });
  const dialect = server?.osDialect ? deserializeDialect(server.osDialect) : undefined;
  const command = buildCommand(input.tool.actionType, input.args, dialect);
  if (!command) {
    throw new BusinessError("AI 操作参数无效，无法生成可审批命令");
  }

  const reason = typeof input.args.reason === "string" && input.args.reason.trim()
    ? input.args.reason.trim()
    : "AI 助手从网页会话发起，等待人工审批后执行。";

  const request = await createCommandRequest({
    title: `AI 助手：${input.tool.actionName}`,
    command,
    reason,
    requesterId: input.userId,
    serverIds: [input.serverId],
    submissionMode: "assistant",
  });

  return { commandRequestId: request.id, requiresApproval: request.requiresApproval };
}

function requiredPermissionForAction(actionType: string): Permission {
  return actionType === "list_servers" ? "server:read" : "server:ssh";
}

const HOSTED_ACTION_TYPES = new Set<HostedActionType>([
  "list_servers",
  "get_status",
  "read_logs",
  "list_docker_containers",
  "check_service_status",
  "execute_command",
  "restart_service",
  "modify_config",
  "deploy_docker",
]);

function isHostedActionType(actionType: string): actionType is HostedActionType {
  return HOSTED_ACTION_TYPES.has(actionType as HostedActionType);
}

// ── 创建托管操作记录 ──────────────────────────────────────

export async function createHostedAction(input: {
  conversationId: string;
  messageId: string;
  toolCallId: string;
  tool: HostedTool;
  args: Record<string, unknown>;
  userId: string;
}) {
  const { conversationId, messageId, tool, args, userId } = input;
  const serverId = await resolveServerId(args);
  const params = { ...args, ...(serverId ? { serverId } : {}) };
  return prisma.aiHostedAction.create({
    data: {
      conversationId,
      messageId,
      serverId,
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
  if (context && !sessionHasPermission(context.session, context.requiredPermission ?? requiredPermissionForAction(action.actionType))) {
    return { success: false, data: null, error: action.actionType === "list_servers" ? "你没有服务器查看权限" : "你没有服务器 SSH 执行权限" };
  }

  if (action.actionType === "list_servers") {
    const servers = await prisma.server.findMany({
      orderBy: [{ enabled: "desc" }, { name: "asc" }],
      select: { id: true, name: true, host: true, port: true, username: true, enabled: true },
      take: 500, // P2: server 总数有限
    });
    return { success: true, data: { servers } };
  }

  if (!action.serverId) {
    return { success: false, data: null, error: "未指定服务器" };
  }

  // 获取服务器连接信息 + OS 方言 (TR-041)
  // Prisma include 返回所有标量字段（含 osDialect）+ 关联的 sshKey
  const server = await prisma.server.findUnique({
    where: { id: action.serverId },
    include: { sshKey: true },
  });

  if (!server) {
    return { success: false, data: null, error: "服务器不存在" };
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
          resolve({ success: false, data: null, error: "不支持的操作类型" });
          return;
        }
        const dialect = server.osDialect ? deserializeDialect(server.osDialect) : undefined;
        const command = buildCommand(action.actionType, action.params, dialect);
        if (!command) {
          sshClient.end();
          resolve({ success: false, data: null, error: "不支持的操作类型" });
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
              error: code !== 0 ? `命令执行失败 (exit code ${code})` : undefined,
            });
          });
        });
      });

      sshClient.on("error", (err) => {
        sshClient.end();
        resolve({ success: false, data: null, error: `SSH连接失败: ${err.message}` });
      });

      sshClient.connect(connectConfig);
    });
  } catch (err) {
    return { success: false, data: null, error: `执行失败: ${err instanceof Error ? err.message : "未知错误"}` };
  }
}


// ── 审批操作 ──────────────────────────────────────────────

export async function approveHostedAction(actionId: string, approver: HostedActionSession) {
  if (!sessionHasPermission(approver, "ai:action:approve")) throw new ForbiddenError("缺少权限：ai:action:approve");

  const action = await prisma.aiHostedAction.findFirst({ where: { id: actionId } });
  if (!action) throw new NotFoundError("操作不存在或无权审批");
  if (action.status !== "PENDING_APPROVAL") throw new BusinessError("操作不在待审批状态");

  // 更新状态为已批准
  await prisma.aiHostedAction.update({
    where: { id: actionId },
    data: { status: "APPROVED", approverId: approver.userId, approvedAt: new Date() },
  });

  // 执行自动批准操作
  await executeApprovedAction(actionId, approver);
}

export async function confirmHostedAction(actionId: string, requester: HostedActionSession) {
  if (!sessionHasPermission(requester, "server:ssh")) throw new ForbiddenError("缺少权限：server:ssh");

  const action = await prisma.aiHostedAction.findFirst({ where: { id: actionId, requesterId: requester.userId } });
  if (!action) throw new NotFoundError("操作不存在或无权确认");
  if (action.status !== "PENDING_APPROVAL") throw new BusinessError("操作不在待确认状态");
  if (action.autoApproved) throw new BusinessError("自动批准操作无需人工确认");
  if (!isHostedActionType(action.actionType)) throw new BusinessError("不支持的操作类型");
  if (action.actionType === "list_servers") throw new BusinessError("列表查询无需创建命令请求");
  if (!action.serverId) throw new BusinessError("未绑定目标 VPS，无法创建命令请求");

  const params = JSON.parse(action.params) as Record<string, unknown>;
  const commandRequest = await createAssistantCommandRequest({
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
  });

  await prisma.aiHostedAction.update({
    where: { id: actionId },
    data: {
      status: "APPROVED",
      approverId: requester.userId,
      approvedAt: new Date(),
      result: JSON.stringify(commandRequest),
    },
  });
}

export async function rejectHostedAction(actionId: string, actor: HostedActionSession, reason?: string) {
  const canApprove = sessionHasPermission(actor, "ai:action:approve");
  const action = await prisma.aiHostedAction.findFirst({
    where: canApprove ? { id: actionId } : { id: actionId, requesterId: actor.userId },
  });
  if (!action) {
    if (canApprove) throw new NotFoundError("操作不存在或无权审批");
    throw new NotFoundError("操作不存在或无权取消");
  }
  if (action.status !== "PENDING_APPROVAL") throw new BusinessError(canApprove ? "操作不在待审批状态" : "操作不在待确认状态");

  return prisma.aiHostedAction.update({
    where: { id: actionId },
    data: {
      status: "REJECTED",
      approverId: actor.userId,
      errorMessage: reason || (canApprove ? "审批被拒绝" : "用户取消确认"),
    },
  });
}

// ── 执行已批准的操作 ──────────────────────────────────────

async function executeApprovedAction(actionId: string, approver: HostedActionSession) {
  const action = await prisma.aiHostedAction.findUnique({ where: { id: actionId } });
  if (!action || action.status !== "APPROVED") return;

  await prisma.aiHostedAction.update({
    where: { id: actionId },
    data: { status: "EXECUTING", executedAt: new Date() },
  });

  const params = JSON.parse(action.params) as Record<string, unknown>;
  const result = await executeSafeAction(
    {
      actionType: action.actionType,
      serverId: action.serverId,
      params,
    },
    { session: approver },
  );

  await prisma.aiHostedAction.update({
    where: { id: actionId },
    data: {
      status: result.success ? "COMPLETED" : "FAILED",
      result: JSON.parse(JSON.stringify(result.data || {})),
      errorMessage: result.error,
      completedAt: new Date(),
    },
  });
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

// ── 获取对话的托管操作列表 ─────────────────────────────────

export async function getConversationActions(conversationId: string) {
  return prisma.aiHostedAction.findMany({
    where: { conversationId },
    include: { server: { select: { id: true, name: true, host: true } } },
    orderBy: { createdAt: "desc" },
    take: 500, // P2: 单 conversation 操作数有限
  });
}
