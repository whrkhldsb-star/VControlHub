/**
 * AI 托管服务 — 处理 AI 发起的 VPS 操作
 * 
 * 流程：
 * 1. AI 返回 tool_call → 解析工具名和参数
 * 2. 安全操作（autoApproved）→ 直接执行 → 返回结果给 AI
 * 3. 危险操作 → 创建审批请求 → 等待用户审批 → 执行 → 返回结果
 */

import { prisma } from "@/lib/db";
import { BusinessError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { getToolByName, type HostedTool } from "./hosted-tools";
import { sessionHasPermission } from "@/lib/auth/authorization";
import type { Permission, RoleKey } from "@/lib/auth/rbac";
import { decryptServerPassword, decryptSshPrivateKey } from "@/lib/ssh/ssh-key-crypto";

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

  return prisma.aiHostedAction.create({
    data: {
      conversationId,
      messageId,
      serverId: (args.serverId as string) || null,
      actionType: tool.actionType,
      actionName: tool.actionName,
      params: JSON.parse(JSON.stringify(args)),
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
  if (context && !sessionHasPermission(context.session, context.requiredPermission ?? "server:ssh")) {
    return { success: false, data: null, error: "你没有服务器 SSH 执行权限" };
  }

  if (!action.serverId) {
    return { success: false, data: null, error: "未指定服务器" };
  }

  // 获取服务器连接信息
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
      const connectConfig: Record<string, unknown> = {
        host: server.host,
        port: server.port,
        username: server.username,
        readyTimeout: 10000,
      };

      if (server.sshKey?.privateKey) {
        connectConfig.privateKey = decryptSshPrivateKey(server.sshKey.privateKey);
      } else if (server.password) {
        connectConfig.password = decryptServerPassword(server.password);
      }

      sshClient.on("ready", () => {
        const command = buildCommand(action.actionType, action.params);
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
        resolve({ success: false, data: null, error: `SSH连接失败: ${err.message}` });
      });

      sshClient.connect(connectConfig as Parameters<typeof sshClient.connect>[0]);
    });
  } catch (err) {
    return { success: false, data: null, error: `执行失败: ${err instanceof Error ? err.message : "未知错误"}` };
  }
}

// ── 根据操作类型构建 shell 命令 ─────────────────────────────

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function normalizeTail(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value ?? 50);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 1000) return null;
  return parsed;
}

function normalizeLogPath(value: unknown): string | null {
  const path = typeof value === "string" && value.trim() ? value.trim() : "/var/log/syslog";
  if (!path.startsWith("/")) return null;
  if (path.includes("\0") || path.includes("\n") || path.includes("\r")) return null;
  if (path.split("/").some((segment) => segment === "..")) return null;
  if (!/^[/A-Za-z0-9._+@:-]+$/.test(path)) return null;
  return path;
}

function normalizeFilter(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return "";
  if (typeof value !== "string") return null;
  const filter = value.trim();
  if (filter.length > 120 || filter.includes("\0") || filter.includes("\n") || filter.includes("\r")) return null;
  return filter;
}

export function buildCommand(actionType: string, params: Record<string, unknown>): string | null {
  switch (actionType) {
    case "get_status":
      return "echo '=== UPTIME ===' && uptime && echo '=== MEMORY ===' && free -h && echo '=== DISK ===' && df -h / && echo '=== CPU ===' && top -bn1 | head -5";

    case "read_logs": {
      const logPath = normalizeLogPath(params.logPath);
      const tail = normalizeTail(params.tail);
      const filter = normalizeFilter(params.filter);
      if (!logPath || !tail || filter === null) return null;
      let cmd = `tail -n ${tail} -- ${shellQuote(logPath)}`;
      if (filter) cmd += ` | grep -F -i -- ${shellQuote(filter)}`;
      return cmd;
    }

    case "execute_command":
      return params.command as string;

    case "restart_service": {
      const svc = (params.serviceName as string).replace(/[^a-zA-Z0-9_-]/g, "");
      return `systemctl restart ${svc} && systemctl status ${svc} --no-pager -l`;
    }

    case "modify_config": {
      const path = (params.configPath as string).replace(/[^a-zA-Z0-9_./-]/g, "");
      // Write content via heredoc with sudo
      return `cp ${path} ${path}.bak.$(date +%s) && cat > ${path} << 'AIEOF'\n${params.content}\nAIEOF`;
    }

    case "deploy_docker": {
      const img = (params.imageName as string).replace(/[^a-zA-Z0-9_.:/-]/g, "");
      const name = (params.containerName as string).replace(/[^a-zA-Z0-9_-]/g, "");
      const ports = (params.ports as string) || "";
      const portFlag = ports ? `-p ${ports}` : "";
      const envVars = params.envVars as string;
      let envFlag = "";
      if (envVars) {
        try {
          const envObj = JSON.parse(envVars) as Record<string, string>;
          envFlag = Object.entries(envObj)
            .map(([k, v]) => `-e ${k}='${v.replace(/'/g, "'\\''")}'`)
            .join(" ");
        } catch { /* ignore invalid env */ }
      }
      return `docker run -d --name ${name} ${portFlag} ${envFlag} ${img}`;
    }

    default:
      return null;
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

  // 执行操作
  await executeApprovedAction(actionId, approver);
}

export async function rejectHostedAction(actionId: string, approver: HostedActionSession, reason?: string) {
  if (!sessionHasPermission(approver, "ai:action:approve")) throw new ForbiddenError("缺少权限：ai:action:approve");

  const action = await prisma.aiHostedAction.findFirst({ where: { id: actionId } });
  if (!action) throw new NotFoundError("操作不存在或无权审批");
  if (action.status !== "PENDING_APPROVAL") throw new BusinessError("操作不在待审批状态");

  return prisma.aiHostedAction.update({
    where: { id: actionId },
    data: {
      status: "REJECTED",
      approverId: approver.userId,
      errorMessage: reason || "审批被拒绝",
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
  });
}

// ── 获取对话的托管操作列表 ─────────────────────────────────

export async function getConversationActions(conversationId: string) {
  return prisma.aiHostedAction.findMany({
    where: { conversationId },
    include: { server: { select: { id: true, name: true, host: true } } },
    orderBy: { createdAt: "desc" },
  });
}
