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
import { createLogger } from "@/lib/logging";
import { scanPinnedKnownHost } from "@/lib/ssh/known-hosts";
import { auditSystemAction } from "@/lib/audit/service";
import { notifyCommandResult } from "@/lib/notification/service";

const cmdExecLogger = createLogger("command-execution");

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
  hostKeySha256?: string | null;
}): Promise<SshExecutionResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "app-ssh-"));
  const keyPath = join(tempDir, "id_key");
  const knownHostsPath = join(tempDir, "known_hosts");

  try {
    await writeFile(keyPath, `${input.privateKey.trim()}\n`, { mode: 0o600 });
    const pin = input.hostKeySha256?.trim();
    if (pin) {
      const knownHostLine = await scanPinnedKnownHost({ host: input.host, port: input.port, expectedFingerprint: pin });
      await writeFile(knownHostsPath, `${knownHostLine}\n`, { mode: 0o600 });
    }
    const hostKeyMode = pin
      ? (["-o", "StrictHostKeyChecking=yes"] as const)
      : (["-o", "StrictHostKeyChecking=accept-new"] as const);

    const args = [
      "-i",
      keyPath,
      "-p",
      String(input.port),
      "-o",
      "BatchMode=yes",
      ...hostKeyMode,
      "-o",
      `UserKnownHostsFile=${pin ? knownHostsPath : "/dev/null"}`,
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
  hostKeySha256?: string | null;
}): Promise<SshExecutionResult> {
  const tempDir = await mkdtemp(join(tmpdir(), "app-ssh-known-hosts-"));
  const knownHostsPath = join(tempDir, "known_hosts");
  const pin = input.hostKeySha256?.trim();
  try {
    if (pin) {
      const knownHostLine = await scanPinnedKnownHost({ host: input.host, port: input.port, expectedFingerprint: pin });
      await writeFile(knownHostsPath, `${knownHostLine}\n`, { mode: 0o600 });
    }
    const hostKeyMode = pin
      ? (["-o", "StrictHostKeyChecking=yes"] as const)
      : (["-o", "StrictHostKeyChecking=accept-new"] as const);

    const args = [
    "-p",
    String(input.port),
    ...hostKeyMode,
    "-o",
    `UserKnownHostsFile=${pin ? knownHostsPath : "/dev/null"}`,
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
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

export async function executeCommandOverSsh(input: {
  host: string;
  port: number;
  username: string;
  privateKey?: string;
  password?: string;
  command: string;
  targetId?: string;
  hostKeySha256?: string | null;
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
        hostKeySha256?: string | null;
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
        hostKeySha256?: string | null;
      },
    );
  }
  throw new Error("Missing SSH credentials (private key or password)");
}

export function cancelActiveCommandChild(targetId: string) {
  markCommandTargetCancelled(targetId);
  return cancelRunningCommandChild(targetId);
}

export async function markTargetsRunning(commandRequestId: string) {
  // Never re-open terminal rows (esp. CANCELLED): cancel can race between
  // claim APPROVED→RUNNING and this stamp. Only advance queued statuses.
  await prisma.commandTarget.updateMany({
    where: {
      commandRequestId,
      status: { in: ["PENDING_APPROVAL", "APPROVED"] },
    },
    data: {
      status: "RUNNING",
      startedAt: new Date(),
    },
  });
}

const TERMINAL_TARGET_STATUSES = new Set([
  "CANCELLED",
  "COMPLETED",
  "FAILED",
  "REJECTED",
]);

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
  // Cancel / recovery may have terminalized the target (or whole request)
  // after executeTargets loaded the snapshot but before SSH spawn. Skip
  // remote work entirely — late CAS alone still opens a network session.
  const live = await prisma.commandTarget.findUnique({
    where: { id: target.id },
    select: {
      id: true,
      status: true,
      commandRequest: { select: { status: true } },
    },
  });
  if (
    !live ||
    TERMINAL_TARGET_STATUSES.has(live.status) ||
    live.commandRequest.status === "CANCELLED"
  ) {
    await prisma.executionLog.create({
      data: {
        commandRequestId,
        serverId: target.server.id,
        summary: `Skipped SSH for ${target.server.name} (${target.server.host}:${target.server.port}): target/request already terminal (${live?.status ?? "missing"} / ${live?.commandRequest.status ?? "missing"}).`,
      },
    });
    return false;
  }

  const privateKey = target.server.sshKey?.privateKey
    ? decryptSshPrivateKey(target.server.sshKey.privateKey).trim()
    : undefined;
  const password = target.server.password
    ? decryptServerPassword(target.server.password).trim()
    : undefined;
  const connectionType = target.server.connectionType;

  if (connectionType === "SSH_KEY" && !privateKey) {
    const summary = `The SSH key bound to node ${target.server.name} lacks a private key; cannot execute real SSH command.`;
    const failed = await prisma.commandTarget.updateMany({
      where: {
        id: target.id,
        status: { in: ["RUNNING", "APPROVED", "PENDING_APPROVAL"] },
      },
      data: {
        status: "FAILED",
        stdout: null,
        stderr: summary,
        exitCode: 255,
        finishedAt: new Date(),
      },
    });
    if (failed.count > 0) {
      await prisma.executionLog.create({
        data: {
          commandRequestId,
          serverId: target.server.id,
          summary,
        },
      });
    }
    return false;
  }

  if (connectionType === "PASSWORD" && !password) {
    const summary = `Node ${target.server.name} is configured for password connection but lacks a password; cannot execute real SSH command.`;
    const failed = await prisma.commandTarget.updateMany({
      where: {
        id: target.id,
        status: { in: ["RUNNING", "APPROVED", "PENDING_APPROVAL"] },
      },
      data: {
        status: "FAILED",
        stdout: null,
        stderr: summary,
        exitCode: 255,
        finishedAt: new Date(),
      },
    });
    if (failed.count > 0) {
      await prisma.executionLog.create({
        data: {
          commandRequestId,
          serverId: target.server.id,
          summary,
        },
      });
    }
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
    hostKeySha256: (target.server as { hostKeySha256?: string | null }).hostKeySha256,
  }).catch((error): SshExecutionResult => ({
    stdout: "",
    stderr: error instanceof Error ? error.message : "SSH execution failed",
    exitCode: 255,
  }));

  // Operator cancel races with SSH close: cancelCommandRequest may already
  // have stamped CANCELLED. Never overwrite that terminal status with
  // COMPLETED/FAILED from a late process exit (false "failed after cancel").
  const cancelled = Boolean(result.cancelled);
  const succeeded = !cancelled && result.exitCode === 0;
  const nextTargetStatus = cancelled ? "CANCELLED" : succeeded ? "COMPLETED" : "FAILED";
  const targetUpdate = await prisma.commandTarget.updateMany({
    where: {
      id: target.id,
      // Only advance non-terminal / still-running rows. CANCELLED (and other
      // finished statuses) must stick once cancel or recovery has claimed them.
      status: { in: ["RUNNING", "APPROVED", "PENDING_APPROVAL"] },
    },
    data: {
      status: nextTargetStatus,
      stdout: result.stdout || null,
      stderr: result.stderr || null,
      exitCode: cancelled ? 130 : result.exitCode,
      finishedAt: new Date(),
    },
  });

  if (targetUpdate.count === 0) {
    await prisma.executionLog.create({
      data: {
        commandRequestId,
        serverId: target.server.id,
        summary: `SSH process for ${target.server.name} (${target.server.host}:${target.server.port}) finished after the target was already terminal (cancel/recovery); left existing status unchanged.`,
      },
    });
    return false;
  }

  const summary = cancelled
    ? `Command on ${target.server.name} (${target.server.host}:${target.server.port}) was cancelled by the operator.`
    : succeeded
      ? `Command completed on ${target.server.name} (${target.server.host}:${target.server.port}) with exit code 0.`
      : `Command failed on ${target.server.name} (${target.server.host}:${target.server.port}) with exit code ${result.exitCode}.`;

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
          hostKeySha256: true,
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
  // Rejected promises leave targets RUNNING with no stderr — surface them as
  // FAILED so finalize counts and UI do not show a permanent "still running".
  const rejectedIndexes: number[] = [];
  results.forEach((result, index) => {
    if (result.status === "rejected") rejectedIndexes.push(index);
  });
  if (rejectedIndexes.length > 0) {
    await Promise.all(
      rejectedIndexes.map(async (index) => {
        const target = targets[index];
        const settled = results[index];
        if (!target || !settled || settled.status !== "rejected") return;
        const reason =
          settled.reason instanceof Error
            ? settled.reason.message
            : String(settled.reason);
        const summary = `Command executor threw on ${target.server.name} (${target.server.host}:${target.server.port}): ${reason}`;
        await prisma.commandTarget.updateMany({
          where: { id: target.id, status: "RUNNING" },
          data: {
            status: "FAILED",
            stderr: summary.slice(0, 4000),
            exitCode: 255,
            finishedAt: new Date(),
          },
        });
        await prisma.executionLog.create({
          data: {
            commandRequestId,
            serverId: target.server.id,
            summary: summary.slice(0, 2000),
          },
        });
      }),
    );
  }
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
    throw new Error("Command request not found");
  }

  // Cancel may win the race before SSH work starts (or after claim). Do not
  // re-run targets or flip CANCELLED → FAILED/COMPLETED.
  if (request.status === "CANCELLED") {
    return request;
  }

  const runtimeConfig = await getCommandRuntimeConfigValues();
  const heartbeatIntervalMs = runtimeConfig.executionHeartbeatMs;
  let heartbeat: NodeJS.Timeout | null = setInterval(() => {
    heartbeatRunningCommandRequest(commandRequestId).catch((err) => { cmdExecLogger.warn("heartbeatRunningCommandRequest failed", { error: err instanceof Error ? err.message : String(err) }); });
  }, heartbeatIntervalMs);
  heartbeat.unref?.();

  try {
    await heartbeatRunningCommandRequest(commandRequestId);
    const { totalCount, completedCount } = await executeTargets(commandRequestId);

    // Re-read after SSH work: cancelCommandRequest may have set CANCELLED while
    // children were still closing. Preserve operator cancel over synthetic FAIL.
    const latest = await prisma.commandRequest.findUnique({
      where: { id: commandRequestId },
      include: { targets: true },
    });
    if (!latest) {
      throw new Error("Command request not found");
    }
    if (latest.status === "CANCELLED") {
      return latest;
    }

    const targetStatuses = latest.targets.map((t) => t.status);
    const allCancelled =
      targetStatuses.length > 0 && targetStatuses.every((s) => s === "CANCELLED");
    if (allCancelled) {
      const cancelledSummary =
        "Background SSH execution stopped because the operator cancelled the command request.";
      await prisma.executionLog.create({
        data: { commandRequestId, serverId: null, summary: cancelledSummary },
      });
      const updated = await prisma.commandRequest.updateMany({
        where: { id: commandRequestId, status: { in: ["RUNNING", "APPROVED"] } },
        data: { status: "CANCELLED", workerId: null, workerHeartbeatAt: null },
      });
      if (updated.count === 0) {
        return prisma.commandRequest.findUniqueOrThrow({ where: { id: commandRequestId } });
      }
      const cancelledRequest = await prisma.commandRequest.findUniqueOrThrow({
        where: { id: commandRequestId },
      });
      await auditSystemAction(
        "command.execute.cancelled",
        {
          commandRequestId,
          title: request.title,
          status: "CANCELLED",
          completedCount: 0,
          totalCount: targetStatuses.length,
          summary: cancelledSummary,
          requesterId: request.requesterId,
        },
        "INFO",
      );
      notifyCommandResult(
        request.requesterId,
        request.title,
        "cancelled",
        request.teamId,
      ).catch((err) => {
        cmdExecLogger.warn("notifyCommandResult failed", {
          error: err instanceof Error ? err.message : String(err),
          commandRequestId,
        });
      });
      return cancelledRequest;
    }

    const nextStatus =
      totalCount > 0 && completedCount === totalCount ? "COMPLETED" : "FAILED";

    const summary =
      totalCount > 0 && completedCount === totalCount
        ? `Background SSH execution completed ${completedCount}/${totalCount} targets.`
        : completedCount > 0
          ? `Background SSH execution only completed ${completedCount}/${totalCount} targets; please check failed node logs.`
          : totalCount > 0
            ? `Background SSH execution failed; ${totalCount} targets all incomplete.`
            : "Background SSH execution found no executable targets.";
    await prisma.executionLog.create({
      data: { commandRequestId, serverId: null, summary },
    });

    // CAS: only finalize while still RUNNING/APPROVED so cancel wins races.
    const claimed = await prisma.commandRequest.updateMany({
      where: { id: commandRequestId, status: { in: ["RUNNING", "APPROVED"] } },
      data: { status: nextStatus, workerId: null, workerHeartbeatAt: null },
    });
    if (claimed.count === 0) {
      return prisma.commandRequest.findUniqueOrThrow({ where: { id: commandRequestId } });
    }

    const updated = await prisma.commandRequest.findUniqueOrThrow({
      where: { id: commandRequestId },
    });

    // Terminal observability: audit + in-app notification (approve path only
    // notified "approved", so operators saw no failure signal after SSH fail).
    await auditSystemAction(
      nextStatus === "COMPLETED" ? "command.execute.completed" : "command.execute.failed",
      {
        commandRequestId,
        title: request.title,
        status: nextStatus,
        completedCount,
        totalCount,
        summary,
        requesterId: request.requesterId,
      },
      nextStatus === "COMPLETED" ? "INFO" : "WARNING",
    );
    notifyCommandResult(
      request.requesterId,
      request.title,
      nextStatus === "COMPLETED" ? "completed" : "failed",
      request.teamId,
    ).catch((err) => {
      cmdExecLogger.warn("notifyCommandResult failed", {
        error: err instanceof Error ? err.message : String(err),
        commandRequestId,
      });
    });

    return updated;
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
  const message = error instanceof Error ? error.message : "Command background execution failed";
  const request = await prisma.commandRequest.findUnique({
    where: { id: commandRequestId },
    select: { id: true, title: true, requesterId: true, status: true, teamId: true },
  });
  // Operator cancel is terminal — do not rewrite CANCELLED as FAILED when the
  // worker tears down after SIGTERM / mid-flight cancel.
  if (request?.status === "CANCELLED") {
    return;
  }
  const claimed = await prisma.commandRequest.updateMany({
    where: { id: commandRequestId, status: { in: ["RUNNING", "APPROVED"] } },
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
  if (claimed.count === 0) {
    return;
  }
  await prisma.executionLog.create({
    data: {
      commandRequestId,
      serverId: null,
      summary: `Command background executor startup failed: ${message}`,
    },
  });
  await auditSystemAction(
    "command.execute.failed",
    {
      commandRequestId,
      title: request?.title ?? null,
      status: "FAILED",
      summary: message.slice(0, 500),
      requesterId: request?.requesterId ?? null,
      phase: "executor_error",
    },
    "WARNING",
  );
  if (request?.requesterId) {
    notifyCommandResult(request.requesterId, request.title, "failed", request.teamId).catch((err) => {
      cmdExecLogger.warn("notifyCommandResult failed", {
        error: err instanceof Error ? err.message : String(err),
        commandRequestId,
      });
    });
  }
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
    summary: `Command request ${commandRequestId} has been enqueued for background execution`,
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

  // Cancel may have won after claim (CANCELLED request + targets). Do not
  // enqueue durable SSH work or log "entered queue" over an operator abort.
  // Only abort on explicit terminal statuses so partial test mocks / transient
  // reads without a status field still proceed when the claim already won.
  const stillRunnable = await prisma.commandRequest.findUnique({
    where: { id: commandRequestId },
    select: { status: true },
  });
  const terminalRequestStatuses = new Set(["CANCELLED", "COMPLETED", "FAILED", "REJECTED"]);
  if (!stillRunnable || terminalRequestStatuses.has(stillRunnable.status)) {
    return false;
  }

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
