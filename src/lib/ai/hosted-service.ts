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
import type { SessionPayload } from "@/lib/auth/session";
import { teamWhere } from "@/lib/auth/team-scope";
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
  /** Optional; used to stamp CommandRequest.teamId on confirm and scope server/KB access. */
  currentTeamId?: string | null;
};

function sessionForTeamScope(
  session?: HostedActionSession | null,
): Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> | null {
  if (!session) return null;
  return {
    userId: session.userId,
    roles: session.roles,
    currentTeamId: session.currentTeamId ?? null,
  };
}

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
    // Malformed JSON arguments — default to empty so the tool call can still be surfaced.
    args = {};
  }

  return { toolCallId: tc.id, tool, args };
}

// ── VPS 解析与命令审批桥接 ─────────────────────────────────

async function resolveServerId(
  args: Record<string, unknown>,
  session?: HostedActionSession | null,
): Promise<string | null> {
  const explicitId = typeof args.serverId === "string" ? args.serverId.trim() : "";
  const scope = sessionForTeamScope(session);
  const teamFilter = scope ? teamWhere(scope) : {};

  if (explicitId) {
    const owned = await prisma.server.findFirst({
      where: { id: explicitId, ...teamFilter },
      select: { id: true },
    });
    return owned?.id ?? null;
  }

  const query = typeof args.serverQuery === "string" ? args.serverQuery.trim() : "";
  if (!query) return null;

  const server = await prisma.server.findFirst({
    where: {
      AND: [
        teamFilter,
        {
          OR: [
            { id: query },
            { name: { contains: query } },
            { host: { contains: query } },
          ],
        },
      ],
    },
    select: { id: true, name: true, host: true },
  });

  return server?.id ?? null;
}

async function buildAssistantCommandRequestPayload(input: {
  tool: HostedTool;
  args: Record<string, unknown>;
  userId: string;
  serverId: string;
  /** Optional team stamp for the spawned CommandRequest (system path has no session). */
  teamId?: string | null;
}) {
  // TR-041: 加载 server 的 osDialect 以支持方言感知命令生成
  const server = await prisma.server.findUnique({
    where: { id: input.serverId },
    select: { osDialect: true, teamId: true },
  });
  const dialect = server?.osDialect ? deserializeDialect(server.osDialect) : undefined;
  const command = buildCommand(input.tool.actionType, input.args, dialect);
  if (!command) {
    throw new BusinessError("AI action parameters are invalid; cannot generate an approvable command");
  }

  const reason = typeof input.args.reason === "string" && input.args.reason.trim()
    ? input.args.reason.trim()
    : "AI assistant initiated from web session; will execute after manual approval.";

  // Prefer explicit teamId (session); fall back to target server's team so the
  // CommandRequest is not left null-team (shared across all tenants in list views).
  const teamId =
    input.teamId !== undefined && input.teamId !== null
      ? input.teamId
      : (server?.teamId ?? null);

  return {
    title: `AI Assistant: ${input.tool.actionName}`,
    command,
    reason,
    requesterId: input.userId,
    serverIds: [input.serverId],
    submissionMode: "assistant" as const,
    teamId,
  };
}

function requiredPermissionForAction(actionType: string): Permission {
  if (actionType === "list_servers") return "server:read";
  if (actionType === "list_backups") return "backup:read";
  if (actionType === "run_playbook") return "playbook:run";
  if (actionType === "query_traffic") return "health:read";
  if (actionType === "manage_cron") return "task:read";
  if (actionType === "search_knowledge") return "ai:chat";
  if (actionType === "list_files" || actionType === "search_files" || actionType === "read_file") return "storage:read";
  return "server:ssh";
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
  "list_files",
  "search_files",
  "read_file",
  "get_docker_logs",
  "search_knowledge",
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
  /** Optional session for team-scoped server resolution. */
  session?: HostedActionSession | null;
}) {
  const { conversationId, messageId, tool, args, userId } = input;
  const session =
    input.session ??
    ({
      userId,
      roles: [] as RoleKey[],
      currentTeamId: null,
    } satisfies HostedActionSession);
  const serverId = await resolveServerId(args, session);
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
    return { success: false, data: null, error: action.actionType === "list_servers" ? "You do not have server read permission" : "You do not have server SSH execution permission" };
  }

  if (action.actionType === "search_knowledge") {
    const query = typeof action.params.query === "string" ? action.params.query : "";
    const knowledgeBaseId =
      typeof action.params.knowledgeBaseId === "string" ? action.params.knowledgeBaseId : undefined;
    const limitRaw = action.params.limit;
    const limit =
      typeof limitRaw === "number"
        ? limitRaw
        : typeof limitRaw === "string"
          ? Number(limitRaw)
          : 5;
    const { searchKnowledge } = await import("./knowledge");
    const scope = sessionForTeamScope(context?.session);
    const hits = await searchKnowledge({
      query,
      knowledgeBaseId,
      limit: Number.isFinite(limit) ? limit : 5,
      // Always pass a session when available so teamWhere applies; never force currentTeamId=null.
      session: scope ?? undefined,
    });
    return {
      success: true,
      data: {
        hits: hits.map((h) => ({
          knowledgeBase: h.knowledgeBaseName,
          document: h.documentTitle,
          chunkIndex: h.chunkIndex,
          score: h.score,
          excerpt: h.content.slice(0, 1200),
        })),
        count: hits.length,
      },
    };
  }

  if (action.actionType === "list_servers") {
    const scope = sessionForTeamScope(context?.session);
    const servers = await prisma.server.findMany({
      where: scope ? teamWhere(scope) : { teamId: null },
      orderBy: [{ enabled: "desc" }, { name: "asc" }],
      select: { id: true, name: true, host: true, port: true, username: true, enabled: true },
      take: 500, // P2: server 总数有限
    });
    return { success: true, data: { servers } };
  }

  if (!action.serverId) {
    return { success: false, data: null, error: "No server specified" };
  }

  // Team-scoped server load (IDOR: never SSH into out-of-team hosts).
  const scope = sessionForTeamScope(context?.session);
  const server = await prisma.server.findFirst({
    where: {
      id: action.serverId,
      ...(scope ? teamWhere(scope) : { teamId: null }),
    },
    include: { sshKey: true },
  });

  if (!server) {
    return { success: false, data: null, error: "Server not found" };
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
          resolve({ success: false, data: null, error: "Unsupported action type" });
          return;
        }
        const dialect = server.osDialect ? deserializeDialect(server.osDialect) : undefined;
        const command = buildCommand(action.actionType, action.params, dialect);
        if (!command) {
          sshClient.end();
          resolve({ success: false, data: null, error: "Unsupported action type" });
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
              error: code !== 0 ? `Command execution failed (exit code ${code})` : undefined,
            });
          });
        });
      });

      sshClient.on("error", (err) => {
        sshClient.end();
        resolve({ success: false, data: null, error: `SSH connection failed: ${err.message}` });
      });

      sshClient.connect(connectConfig);
    });
  } catch (err) {
    return { success: false, data: null, error: `Execution failed: ${err instanceof Error ? err.message : "Unknown error"}` };
  }
}


// ── 审批操作 ──────────────────────────────────────────────

export async function approveHostedAction(actionId: string, approver: HostedActionSession) {
  if (!sessionHasPermission(approver, "ai:action:approve")) throw new ForbiddenError("Missing permission: ai:action:approve");

  // Atomic compare-and-swap: only transition from PENDING_APPROVAL to APPROVED
  const claimed = await prisma.aiHostedAction.updateMany({
    where: { id: actionId, status: "PENDING_APPROVAL" },
    data: { status: "APPROVED", approverId: approver.userId, approvedAt: new Date() },
  });
  if (claimed.count === 0) {
    const action = await prisma.aiHostedAction.findFirst({ where: { id: actionId } });
    if (!action) throw new NotFoundError("Action not found or not authorized to approve");
    throw new BusinessError("Action is not pending approval");
  }

  await executeApprovedAction(actionId, approver);
}

export async function confirmHostedAction(actionId: string, requester: HostedActionSession) {
  if (!sessionHasPermission(requester, "server:ssh")) throw new ForbiddenError("Missing permission: server:ssh");

  const action = await prisma.aiHostedAction.findFirst({ where: { id: actionId, requesterId: requester.userId } });
  if (!action) throw new NotFoundError("Action not found or not authorized to confirm");
  if (action.status !== "PENDING_APPROVAL") throw new BusinessError("Action is not pending confirmation");
  if (action.autoApproved) throw new BusinessError("Auto-approved actions do not require manual confirmation");
  if (!isHostedActionType(action.actionType)) throw new BusinessError("Unsupported action type");
  if (action.actionType === "list_servers") throw new BusinessError("List queries do not require creating a command request");
  if (!action.serverId) throw new BusinessError("No target VPS bound; cannot create command request");

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
    userId: requester.userId,
    serverId: action.serverId,
    teamId: requester.currentTeamId ?? null,
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
    throw new BusinessError("Action is not pending confirmation (may have just been confirmed by another request)");
  }

  const request = await createCommandRequest(commandRequestPayload);
  const commandRequest = { commandRequestId: request.id, requiresApproval: request.requiresApproval };

  await prisma.aiHostedAction.update({
    where: { id: actionId },
    data: { result: JSON.stringify(commandRequest) },
  });
}

export async function rejectHostedAction(actionId: string, actor: HostedActionSession, reason?: string) {
  const canApprove = sessionHasPermission(actor, "ai:action:approve");
  // Scope claim by ownership unless the actor can approve any pending action.
  const where = canApprove
    ? { id: actionId, status: "PENDING_APPROVAL" as const }
    : { id: actionId, status: "PENDING_APPROVAL" as const, requesterId: actor.userId };
  const claimed = await prisma.aiHostedAction.updateMany({
    where,
    data: {
      status: "REJECTED",
      approverId: actor.userId,
      errorMessage: reason || (canApprove ? "Approval rejected" : "User cancelled confirmation"),
    },
  });
  if (claimed.count === 0) {
    const action = await prisma.aiHostedAction.findFirst({
      where: canApprove ? { id: actionId } : { id: actionId, requesterId: actor.userId },
    });
    if (!action) {
      if (canApprove) throw new NotFoundError("Action not found or not authorized to approve");
      throw new NotFoundError("Action not found or not authorized to cancel");
    }
    throw new BusinessError(canApprove ? "Action is not pending approval" : "Action is not pending confirmation");
  }
  return prisma.aiHostedAction.findUniqueOrThrow({ where: { id: actionId } });
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
