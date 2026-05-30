import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";

import { isProtectedByApproval } from "@/lib/auth/rbac";
import { prisma } from "@/lib/db";
import {
  notifyCommandPending,
  notifyCommandResult,
} from "@/lib/notification/service";
import {
  decryptServerPassword,
  decryptSshPrivateKey,
} from "@/lib/ssh/ssh-key-crypto";

import {
  createCommandSchema,
  reviewCommandSchema,
  type CreateCommandInput,
  type ReviewCommandInput,
} from "./schema";

function toApprovalActorType(submissionMode: "user" | "assistant") {
  return submissionMode;
}

function toInitiatedByType(submissionMode: "user" | "assistant") {
  return submissionMode === "assistant" ? "ASSISTANT" : "USER";
}

async function markTargetsRunning(commandRequestId: string) {
  await prisma.commandTarget.updateMany({
    where: { commandRequestId },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
}

type SshExecutionResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  timedOut?: boolean;
};

const DEFAULT_COMMAND_EXECUTION_TIMEOUT_MS = 5 * 60 * 1000;
const DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES = 256 * 1024;

function getCommandExecutionTimeoutMs() {
  const raw = Number(process.env.COMMAND_EXECUTION_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COMMAND_EXECUTION_TIMEOUT_MS;
}

function getCommandOutputLimitBytes() {
  const raw = Number(process.env.COMMAND_OUTPUT_LIMIT_BYTES);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_COMMAND_OUTPUT_LIMIT_BYTES;
}

function appendBoundedOutput(current: string, chunk: unknown, limitBytes: number) {
  if (Buffer.byteLength(current, "utf8") >= limitBytes) return current;
  const next = Buffer.concat([Buffer.from(current), Buffer.from(String(chunk))]);
  if (next.byteLength <= limitBytes) return next.toString("utf8");
  return `${next.subarray(0, limitBytes).toString("utf8")}\n[输出已截断，超过 ${limitBytes} 字节限制]`;
}

async function executeCommandOverSsh(input: {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  command: string;
}): Promise<SshExecutionResult> {
  if (input.privateKey) {
    return executeCommandOverSshWithKey(
      input as {
        host: string;
        port: number;
        username: string;
        privateKey: string;
        command: string;
      },
    );
  } else if (input.password) {
    return executeCommandOverSshWithPassword(
      input as {
        host: string;
        port: number;
        username: string;
        password: string;
        command: string;
      },
    );
  }
  throw new Error("缺少 SSH 连接凭据（私钥或密码）");
}

async function executeCommandOverSshWithKey(input: {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  command: string;
}): Promise<SshExecutionResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "app-ssh-"));
  const keyPath = join(tempDir, "id_key");

  try {
    await writeFile(keyPath, `${input.privateKey.trim()}\n`, { mode: 0o600 });

    const args = [
      "-i",
      keyPath,
      "-p",
      String(input.port),
      "-o",
      "BatchMode=yes",
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      "ConnectTimeout=15",
      `${input.username}@${input.host}`,
      input.command,
    ];

    const result = await new Promise<SshExecutionResult>((resolve, reject) => {
      const child = spawn("ssh", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timeoutMs = getCommandExecutionTimeoutMs();
      const outputLimitBytes = getCommandOutputLimitBytes();
      const timeout = setTimeout(() => {
        timedOut = true;
        stderr = appendBoundedOutput(stderr, `\n命令执行超过 ${timeoutMs}ms，已终止。`, outputLimitBytes);
        child.kill("SIGTERM");
      }, timeoutMs);

      child.stdout.on("data", (chunk) => {
        stdout = appendBoundedOutput(stdout, chunk, outputLimitBytes);
      });

      child.stderr.on("data", (chunk) => {
        stderr = appendBoundedOutput(stderr, chunk, outputLimitBytes);
      });

      child.on("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ stdout, stderr, exitCode: timedOut ? 124 : (code ?? 255), timedOut });
      });
    });

    return result;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function executeCommandOverSshWithPassword(input: {
  host: string;
  port: number;
  username: string;
  password: string;
  command: string;
}): Promise<SshExecutionResult> {
  const args = [
    "-p",
    String(input.port),
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "ConnectTimeout=15",
    `${input.username}@${input.host}`,
    input.command,
  ];

  const result = await new Promise<SshExecutionResult>((resolve, reject) => {
    // Use SSHPASS env var instead of -p flag to avoid leaking password in /proc/cmdline
    const env = { ...process.env, SSHPASS: input.password };
    const child = spawn("sshpass", ["-e", "ssh", ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeoutMs = getCommandExecutionTimeoutMs();
    const outputLimitBytes = getCommandOutputLimitBytes();
    const timeout = setTimeout(() => {
      timedOut = true;
      stderr = appendBoundedOutput(stderr, `\n命令执行超过 ${timeoutMs}ms，已终止。`, outputLimitBytes);
      child.kill("SIGTERM");
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      stdout = appendBoundedOutput(stdout, chunk, outputLimitBytes);
    });

    child.stderr.on("data", (chunk) => {
      stderr = appendBoundedOutput(stderr, chunk, outputLimitBytes);
    });

    child.on("error", (err) => {
      clearTimeout(timeout);
      if (
        err &&
        "code" in err &&
        (err as NodeJS.ErrnoException).code === "ENOENT"
      ) {
        reject(
          new Error(
            "密码连接需要 sshpass 工具，但系统未安装 sshpass。请安装 sshpass 或改用 SSH 密钥连接。",
          ),
        );
      } else {
        reject(err);
      }
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      resolve({ stdout, stderr, exitCode: timedOut ? 124 : (code ?? 255), timedOut });
    });
  });

  return result;
}

async function executeTargets(commandRequestId: string) {
  const targets = await prisma.commandTarget.findMany({
    where: { commandRequestId },
    include: {
      server: {
        select: {
          id: true,
          name: true,
          host: true,
          port: true,
          username: true,
          connectionType: true,
          password: true,
          sshKey: {
            select: {
              id: true,
              name: true,
              privateKey: true,
            },
          },
        },
      },
      commandRequest: {
        select: { command: true, title: true },
      },
    },
  });

  let completedCount = 0;

  for (const target of targets) {
    const privateKey = target.server.sshKey?.privateKey
      ? decryptSshPrivateKey(target.server.sshKey.privateKey).trim()
      : undefined;
    const password = target.server.password
      ? decryptServerPassword(target.server.password).trim()
      : undefined;
    const connectionType = target.server.connectionType;

    if (connectionType === "SSH_KEY" && !privateKey) {
      const summary = `节点 ${target.server.name} 绑定的 SSH 密钥缺少私钥，无法执行真实 SSH 命令。`;
      await prisma.commandTarget.update({
        where: { id: target.id },
        data: {
          status: "FAILED",
          stdout: null,
          stderr: summary,
          exitCode: 255,
          finishedAt: new Date(),
        },
      });
      await prisma.executionLog.create({
        data: {
          commandRequestId,
          serverId: target.server.id,
          summary,
        },
      });
      continue;
    }

    if (connectionType === "PASSWORD" && !password) {
      const summary = `节点 ${target.server.name} 配置为密码连接但缺少密码，无法执行真实 SSH 命令。`;
      await prisma.commandTarget.update({
        where: { id: target.id },
        data: {
          status: "FAILED",
          stdout: null,
          stderr: summary,
          exitCode: 255,
          finishedAt: new Date(),
        },
      });
      await prisma.executionLog.create({
        data: {
          commandRequestId,
          serverId: target.server.id,
          summary,
        },
      });
      continue;
    }

    const result = await executeCommandOverSsh({
      host: target.server.host,
      port: target.server.port,
      username: target.server.username,
      privateKey,
      password,
      command: target.commandRequest.command,
    }).catch((error) => ({
      stdout: "",
      stderr: error instanceof Error ? error.message : "SSH 执行失败",
      exitCode: 255,
    }));

    const succeeded = result.exitCode === 0;
    if (succeeded) completedCount += 1;

    await prisma.commandTarget.update({
      where: { id: target.id },
      data: {
        status: succeeded ? "COMPLETED" : "FAILED",
        stdout: result.stdout || null,
        stderr: result.stderr || null,
        exitCode: result.exitCode,
        finishedAt: new Date(),
      },
    });

    const summary = succeeded
      ? `命令已在 ${target.server.name}（${target.server.host}:${target.server.port}）执行完成，退出码 0。`
      : `命令在 ${target.server.name}（${target.server.host}:${target.server.port}）执行失败，退出码 ${result.exitCode}。`;

    await prisma.executionLog.create({
      data: {
        commandRequestId,
        serverId: target.server.id,
        summary,
      },
    });
  }

  return { totalCount: targets.length, completedCount };
}

async function executeAndFinalizeCommand(commandRequestId: string) {
  await Promise.resolve();
  const request = await prisma.commandRequest.findUnique({
    where: { id: commandRequestId },
    include: { targets: true },
  });

  if (!request) {
    throw new Error("命令请求不存在");
  }

  const { totalCount, completedCount } = await executeTargets(commandRequestId);
  const nextStatus =
    totalCount > 0 && completedCount === totalCount ? "COMPLETED" : "FAILED";

  const summary =
    totalCount > 0 && completedCount === totalCount
      ? `后台 SSH 执行已完成 ${completedCount}/${totalCount} 个目标。`
      : completedCount > 0
        ? `后台 SSH 执行仅完成 ${completedCount}/${totalCount} 个目标，请查看失败节点日志。`
        : totalCount > 0
          ? `后台 SSH 执行失败，${totalCount} 个目标均未完成。`
          : "后台 SSH 执行未找到可执行目标。";
  await prisma.executionLog.create({
    data: { commandRequestId, serverId: null, summary },
  });

  return prisma.commandRequest.update({
    where: { id: commandRequestId },
    data: { status: nextStatus },
  });
}

async function markCommandExecutionFailed(commandRequestId: string, error: unknown) {
  const message = error instanceof Error ? error.message : "命令后台执行失败";
  await prisma.commandRequest.update({
    where: { id: commandRequestId },
    data: { status: "FAILED" },
  });
  await prisma.commandTarget.updateMany({
    where: { commandRequestId, status: "RUNNING" },
    data: {
      status: "FAILED",
      stderr: message,
      exitCode: 255,
      finishedAt: new Date(),
    },
  });
  await prisma.executionLog.create({
    data: {
      commandRequestId,
      serverId: null,
      summary: `命令后台执行器启动失败：${message}`,
    },
  });
}

function scheduleCommandExecution(commandRequestId: string) {
  void executeAndFinalizeCommand(commandRequestId).catch((error) => {
    markCommandExecutionFailed(commandRequestId, error).catch(() => {});
  });
}

async function enqueueApprovedCommandExecution(commandRequestId: string, summary: string) {
  await prisma.commandRequest.update({
    where: { id: commandRequestId },
    data: { status: "RUNNING" },
  });
  await markTargetsRunning(commandRequestId);
  await prisma.executionLog.create({
    data: {
      commandRequestId,
      serverId: null,
      summary,
    },
  });
  scheduleCommandExecution(commandRequestId);
}

function mapCommandRequest(
  request: Awaited<
    ReturnType<typeof prisma.commandRequest.findMany>
  >[number] & {
    requester: { id: string; username: string; displayName: string | null };
    approvals: Array<Record<string, unknown>>;
    targets: Array<Record<string, unknown>>;
    executionLogs: Array<Record<string, unknown>>;
  },
) {
  return {
    id: request.id,
    title: request.title,
    command: request.command,
    reason: request.reason,
    status: request.status,
    initiatedByType: request.initiatedByType,
    requesterId: request.requesterId,
    createdAt: request.createdAt?.toISOString?.() ?? request.createdAt,
    updatedAt: request.updatedAt?.toISOString?.() ?? request.updatedAt,
    requester: request.requester,
    approvals: request.approvals.map(
      (
        a: Record<string, unknown> & {
          createdAt?: Date | string;
          approved?: boolean;
          approver?: {
            id: string;
            username: string;
            displayName: string | null;
          };
          comment?: string | null;
        },
      ) => ({
        approved: a.approved as boolean,
        approver: a.approver as {
          id: string;
          username: string;
          displayName: string | null;
        },
        comment: (a.comment as string | null) ?? null,
        createdAt:
          a.createdAt instanceof Date ? a.createdAt.toISOString() : a.createdAt,
      }),
    ),
    targets: request.targets.map(
      (
        t: Record<string, unknown> & {
          finishedAt?: Date | string;
          createdAt?: Date | string;
          updatedAt?: Date | string;
          id?: string;
          status?: string;
          server?: { id: string; name: string; host: string; port: number };
        },
      ) => ({
        id: t.id as string,
        status: t.status as string,
        server: t.server as {
          id: string;
          name: string;
          host: string;
          port: number;
        },
        finishedAt:
          t.finishedAt instanceof Date
            ? t.finishedAt.toISOString()
            : t.finishedAt,
        createdAt:
          t.createdAt instanceof Date ? t.createdAt.toISOString() : t.createdAt,
        updatedAt:
          t.updatedAt instanceof Date ? t.updatedAt.toISOString() : t.updatedAt,
      }),
    ),
    executionLogs: request.executionLogs.map(
      (
        log: Record<string, unknown> & {
          createdAt?: Date | string;
          summary?: string;
          exitCode?: number | null;
          stdout?: string | null;
          stderr?: string | null;
        },
      ) => ({
        summary: (log.summary as string) ?? "",
        exitCode: (log.exitCode as number | null) ?? null,
        stdout: (log.stdout as string | null) ?? null,
        stderr: (log.stderr as string | null) ?? null,
        createdAt:
          log.createdAt instanceof Date
            ? log.createdAt.toISOString()
            : log.createdAt,
      }),
    ),
    approvalStateLabel:
      request.status === "PENDING_APPROVAL"
        ? "待审批"
        : request.status === "APPROVED"
          ? "已批准"
          : request.status === "REJECTED"
            ? "已拒绝"
            : request.status,
    targetSummary: request.targets.map(
      (
        target: Record<string, unknown> & {
          server?: { name: string };
          status?: string;
        },
      ) => `${(target.server as { name: string })?.name} · ${target.status}`,
    ),
    latestApproval: request.approvals[0]
      ? {
          approved: request.approvals[0].approved as boolean,
          approver: request.approvals[0].approver as {
            id: string;
            username: string;
            displayName: string | null;
          },
          comment: (request.approvals[0].comment as string | null) ?? null,
          createdAt:
            request.approvals[0].createdAt instanceof Date
              ? request.approvals[0].createdAt.toISOString()
              : request.approvals[0].createdAt,
        }
      : null,
    latestLog: request.executionLogs[0]
      ? {
          summary: (request.executionLogs[0].summary as string) ?? "",
          exitCode:
            (request.executionLogs[0].exitCode as number | null) ?? null,
          stdout: (request.executionLogs[0].stdout as string | null) ?? null,
          stderr: (request.executionLogs[0].stderr as string | null) ?? null,
          createdAt:
            request.executionLogs[0].createdAt instanceof Date
              ? request.executionLogs[0].createdAt.toISOString()
              : request.executionLogs[0].createdAt,
        }
      : null,
    isAssistantInitiated: request.initiatedByType === "ASSISTANT",
  };
}

export async function createCommandRequest(input: CreateCommandInput) {
  const payload = createCommandSchema.parse(input);
  const requiresApproval = isProtectedByApproval({
    actorType: toApprovalActorType(payload.submissionMode),
    actionType: "command.execute",
  });

  const status = requiresApproval ? "PENDING_APPROVAL" : "APPROVED";
  const commandRequest = await prisma.commandRequest.create({
    data: {
      title: payload.title,
      command: payload.command,
      reason: payload.reason,
      requesterId: payload.requesterId,
      initiatedByType: toInitiatedByType(payload.submissionMode) as
        | "USER"
        | "ASSISTANT",
      status,
      targets: {
        create: payload.serverIds.map((serverId) => ({ serverId, status })),
      },
    },
    include: { targets: true },
  });

  if (!requiresApproval) {
    await enqueueApprovedCommandExecution(
      commandRequest.id,
      "站内用户操作已进入后台 SSH 执行队列，可在任务中心查看各节点状态。",
    );

    // Notify requester that command execution has started; final status will be visible on the task row/logs.
    notifyCommandResult(payload.requesterId, payload.title, "approved").catch(
      () => {},
    );
  } else {
    // Notify admins about pending command approval
    notifyCommandPending(payload.requesterId, payload.title).catch(() => {});
  }

  return { ...commandRequest, requiresApproval };
}

export async function reviewCommandRequest(input: ReviewCommandInput) {
  const payload = reviewCommandSchema.parse(input);
  const request = await prisma.commandRequest.findUnique({
    where: { id: payload.commandRequestId },
  });

  if (!request) {
    throw new Error("命令请求不存在");
  }

  if (request.status !== "PENDING_APPROVAL") {
    throw new Error("当前命令请求不在待审批状态");
  }

  const nextStatus = payload.approved ? "APPROVED" : "REJECTED";

  await prisma.commandApproval.create({
    data: {
      commandRequestId: payload.commandRequestId,
      approverId: payload.approverId,
      approved: payload.approved,
      comment: payload.comment,
    },
  });

  const updated = await prisma.commandRequest.update({
    where: { id: payload.commandRequestId },
    data: { status: nextStatus },
  });

  if (payload.approved) {
    // Notify requester: command approved
    notifyCommandResult(request.requesterId, request.title, "approved").catch(
      () => {},
    );

    await enqueueApprovedCommandExecution(
      payload.commandRequestId,
      "命令审批已通过，任务已进入后台 SSH 执行队列。",
    );

    return prisma.commandRequest.findUniqueOrThrow({
      where: { id: payload.commandRequestId },
    });
  }

  await prisma.commandTarget.updateMany({
    where: { commandRequestId: payload.commandRequestId },
    data: {
      status: "REJECTED",
      finishedAt: new Date(),
    },
  });

  await prisma.executionLog.create({
    data: {
      commandRequestId: payload.commandRequestId,
      serverId: null,
      summary: "命令审批已拒绝，任务不会进入执行队列。",
    },
  });

  // Notify requester: command rejected
  notifyCommandResult(request.requesterId, request.title, "rejected").catch(
    () => {},
  );

  return updated;
}

export async function listCommandRequests() {
  const requests = await prisma.commandRequest.findMany({
    orderBy: { createdAt: "desc" },
    take: 100,
    include: {
      requester: { select: { id: true, username: true, displayName: true } },
      approvals: {
        orderBy: { createdAt: "desc" },
        take: 10,
        include: {
          approver: { select: { id: true, username: true, displayName: true } },
        },
      },
      targets: {
        take: 50,
        include: {
          server: { select: { id: true, name: true, host: true, port: true } },
        },
      },
      executionLogs: { orderBy: { createdAt: "desc" }, take: 3 },
    },
  });

  return requests.map(mapCommandRequest);
}
