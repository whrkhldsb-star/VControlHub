import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { prisma } from "@/lib/db";
import {
  decryptServerPassword,
  decryptSshPrivateKey,
} from "@/lib/ssh/ssh-key-crypto";
import { getCommandRuntimeConfig } from "@/lib/runtime-settings/service";
import {
  type SshExecutionResult,
  cancelRunningCommandChild,
  markCommandTargetCancelled,
  runSshCommandProcess,
} from "./ssh-executor";
import { enqueueCommandExecutionJob } from "./execution-worker";

export const COMMAND_WORKER_ID = `${process.pid}-${randomUUID()}`;

export async function getCommandRuntimeConfigValues() {
  const config = await getCommandRuntimeConfig();
  return {
    executionTimeoutMs: config.executionTimeoutMs,
    outputLimitBytes: config.outputLimitBytes,
    staleRunningAfterMs: Math.max(config.staleRunningAfterMs, config.executionTimeoutMs),
    executionHeartbeatMs: config.executionHeartbeatMs,
  };
}

async function executeCommandOverSshWithKey(input: {
  host: string;
  port: number;
  username: string;
  privateKey: string;
  command: string;
  targetId?: string;
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
      "UserKnownHostsFile=/dev/null",
      "-o",
      "LogLevel=ERROR",
      "-o",
      "ConnectTimeout=15",
      `${input.username}@${input.host}`,
      input.command,
    ];

    return await runSshCommandProcess({
      command: "ssh",
      args,
      env: process.env,
      targetId: input.targetId,
      runtimeConfig: await getCommandRuntimeConfigValues(),
    });
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
  targetId?: string;
}): Promise<SshExecutionResult> {
  const args = [
    "-p",
    String(input.port),
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    "UserKnownHostsFile=/dev/null",
    "-o",
    "LogLevel=ERROR",
    "-o",
    "ConnectTimeout=15",
    `${input.username}@${input.host}`,
    input.command,
  ];

  // Use SSHPASS env var instead of -p flag to avoid leaking password in /proc/cmdline
  const env = { ...process.env, SSHPASS: input.password };

  return await runSshCommandProcess({
    command: "sshpass",
    args: ["-e", "ssh", ...args],
    env,
    targetId: input.targetId,
    runtimeConfig: await getCommandRuntimeConfigValues(),
  });
}

export async function executeCommandOverSsh(input: {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  command: string;
  targetId?: string;
}): Promise<SshExecutionResult> {
  if (input.privateKey) {
    return executeCommandOverSshWithKey(
      input as {
        host: string;
        port: number;
        username: string;
        privateKey: string;
        command: string;
        targetId?: string;
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
        targetId?: string;
      },
    );
  }
  throw new Error("缺少 SSH 连接凭据（私钥或密码）");
}

export function cancelActiveCommandChild(targetId: string) {
  markCommandTargetCancelled(targetId);
  return cancelRunningCommandChild(targetId);
}

export async function markTargetsRunning(commandRequestId: string) {
  await prisma.commandTarget.updateMany({
    where: { commandRequestId },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
}

export async function executeTarget(
  commandRequestId: string,
  target: Awaited<ReturnType<typeof prisma.commandTarget.findMany>>[number] & {
    server: {
      id: string;
      name: string;
      host: string;
      port: number;
      username: string;
      connectionType: string;
      password: string | null;
      sshKey: { id: string; name: string; privateKey: string | null } | null;
    };
    commandRequest: { command: string; title: string };
  },
) {
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
    return false;
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
    return false;
  }

  const result = await executeCommandOverSsh({
    host: target.server.host,
    port: target.server.port,
    username: target.server.username,
    privateKey,
    password,
    command: target.commandRequest.command,
    targetId: target.id,
  }).catch((error): SshExecutionResult => ({
    stdout: "",
    stderr: error instanceof Error ? error.message : "SSH 执行失败",
    exitCode: 255,
  }));

  const succeeded = result.exitCode === 0;

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

  const summary = result.cancelled
    ? `命令在 ${target.server.name}（${target.server.host}:${target.server.port}）已由操作员取消。`
    : succeeded
      ? `命令已在 ${target.server.name}（${target.server.host}:${target.server.port}）执行完成，退出码 0。`
      : `命令在 ${target.server.name}（${target.server.host}:${target.server.port}）执行失败，退出码 ${result.exitCode}。`;

  await prisma.executionLog.create({
    data: {
      commandRequestId,
      serverId: target.server.id,
      summary,
    },
  });

  return succeeded;
}

export async function executeTargets(commandRequestId: string) {
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
    take: 1000, // P2: 单 request 的 target 数本质有限
  });

  const results = await Promise.allSettled(
    targets.map((target) => executeTarget(commandRequestId, target)),
  );
  const completedCount = results.filter(
    (result) => result.status === "fulfilled" && result.value,
  ).length;

  return { totalCount: targets.length, completedCount };
}

export async function heartbeatRunningCommandRequest(commandRequestId: string) {
  const now = new Date();
  await prisma.commandRequest.updateMany({
    where: { id: commandRequestId, status: "RUNNING" },
    data: {
      status: "RUNNING",
      updatedAt: now,
      workerId: COMMAND_WORKER_ID,
      workerHeartbeatAt: now,
    },
  });
}

export async function executeAndFinalizeCommand(commandRequestId: string) {
  await Promise.resolve();
  const request = await prisma.commandRequest.findUnique({
    where: { id: commandRequestId },
    include: { targets: true },
  });

  if (!request) {
    throw new Error("命令请求不存在");
  }

  const runtimeConfig = await getCommandRuntimeConfigValues();
  const heartbeatIntervalMs = runtimeConfig.executionHeartbeatMs;
  let heartbeat: NodeJS.Timeout | null = setInterval(() => {
    heartbeatRunningCommandRequest(commandRequestId).catch(() => {});
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  try {
    await heartbeatRunningCommandRequest(commandRequestId);
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
      data: { status: nextStatus, workerId: null, workerHeartbeatAt: null },
    });
  } finally {
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
  }
}

export async function markCommandExecutionFailed(
  commandRequestId: string,
  error: unknown,
) {
  const message = error instanceof Error ? error.message : "命令后台执行失败";
  await prisma.commandRequest.update({
    where: { id: commandRequestId },
    data: { status: "FAILED", workerId: null, workerHeartbeatAt: null },
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

export function scheduleCommandExecution(commandRequestId: string) {
  // TR-001 (T11): command execution now goes through the durable jobs table
  // (src/lib/command/execution-worker.ts). This synchronous helper is kept
  // as a backward-compat shim for callers that have not been migrated yet;
  // it enqueues a command.execution job and returns the job id so legacy
  // callers can await the enqueue confirmation. The actual SSH dispatch is
  // now driven by startCommandExecutionWorker()'s poll loop.
  return enqueueCommandExecutionJob({
    commandRequestId,
    summary: `命令请求 ${commandRequestId} 已写入后台执行队列`,
  });
}

export async function enqueueApprovedCommandExecution(
  commandRequestId: string,
  summary: string,
) {
  const claimed = await prisma.commandRequest.updateMany({
    where: { id: commandRequestId, status: { in: ["APPROVED"] } },
    data: {
      status: "RUNNING",
      workerId: COMMAND_WORKER_ID,
      workerHeartbeatAt: new Date(),
    },
  });

  if (claimed.count === 0) return false;

  await markTargetsRunning(commandRequestId);
  await prisma.executionLog.create({
    data: {
      commandRequestId,
      serverId: null,
      summary,
    },
  });
  // TR-001 (T11): scheduleCommandExecution is now a thin shim that enqueues a
  // command.execution job in the durable jobs table. The actual SSH dispatch
  // is performed by startCommandExecutionWorker() when the job worker claims
  // the row; the original fire-and-forget void path is gone.
  await scheduleCommandExecution(commandRequestId);
  return true;
}
