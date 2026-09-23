import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    commandTarget: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    commandRequest: {
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      updateMany: vi.fn(),
    },
    executionLog: { create: vi.fn() },
    // Fire-and-forget in cancelActiveCommandChild: must stay thenable.
    serverAgentJob: { updateMany: vi.fn(() => Promise.resolve({ count: 0 })) },
  },
  executeCommandOverSsh: vi.fn(),
  getCommandRuntimeConfigValues: vi.fn(),
  executeCommandWithAgent: vi.fn(),
  enqueueCommandExecutionJob: vi.fn(),
  cancelRunningCommandChild: vi.fn(),
  markCommandTargetCancelled: vi.fn(),
  auditSystemAction: vi.fn(),
  notifyCommandResult: vi.fn(() => Promise.resolve()),
  decryptSshPrivateKey: vi.fn((value: string) => value),
  decryptServerPassword: vi.fn((value: string) => value),
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("../service-ssh", () => ({
  executeCommandOverSsh: mocks.executeCommandOverSsh,
  getCommandRuntimeConfigValues: mocks.getCommandRuntimeConfigValues,
  setPasswordExecutorMode: vi.fn(),
  shouldUseSsh2PasswordExecutor: vi.fn(() => false),
}));
vi.mock("@/lib/server/agent-service", () => ({ executeCommandWithAgent: mocks.executeCommandWithAgent }));
vi.mock("../execution-queue", () => ({ enqueueCommandExecutionJob: mocks.enqueueCommandExecutionJob }));
vi.mock("../ssh-executor", () => ({
  cancelRunningCommandChild: mocks.cancelRunningCommandChild,
  markCommandTargetCancelled: mocks.markCommandTargetCancelled,
}));
vi.mock("@/lib/audit/service", () => ({ auditSystemAction: mocks.auditSystemAction }));
vi.mock("@/lib/notification/service", () => ({ notifyCommandResult: mocks.notifyCommandResult }));
vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptSshPrivateKey: mocks.decryptSshPrivateKey,
  decryptServerPassword: mocks.decryptServerPassword,
}));

import {
  cancelActiveCommandChild,
  enqueueApprovedCommandExecution,
  executeTarget,
  executeTargets,
  heartbeatRunningCommandRequest,
  markCommandExecutionFailed,
  markTargetsRunning,
} from "../service-execution";

const RUNTIME = { executionTimeoutMs: 1000, outputLimitBytes: 1000, staleRunningAfterMs: 1000, executionHeartbeatMs: 100 };

function buildTarget(overrides: { server?: Record<string, unknown> } = {}) {
  return {
    id: "target-1",
    status: "RUNNING",
    server: {
      id: "srv-1",
      name: "node-a",
      host: "203.0.113.10",
      port: 22,
      username: "root",
      connectionType: "SSH_KEY",
      managementMode: "DIRECT",
      operatingSystem: "LINUX",
      agentLastSeenAt: null,
      password: null,
      hostKeySha256: "SHA256:pinned",
      sshKey: { id: "key-1", name: "deploy", privateKey: "ENCRYPTED-KEY" },
      ...overrides.server,
    },
    commandRequest: { command: "uptime", title: "Check uptime" },
    // Partial fixture: only the fields executeTarget reads are populated.
  } as unknown as Parameters<typeof executeTarget>[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCommandRuntimeConfigValues.mockResolvedValue(RUNTIME);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cancelActiveCommandChild", () => {
  it("cancels the SSH child, pending Agent jobs, and stamps the cancel marker", () => {
    mocks.cancelRunningCommandChild.mockReturnValue(true);
    const result = cancelActiveCommandChild("target-1");
    expect(result).toBe(true);
    expect(mocks.markCommandTargetCancelled).toHaveBeenCalledWith("target-1");
    expect(mocks.cancelRunningCommandChild).toHaveBeenCalledWith("target-1");
    expect(mocks.prisma.serverAgentJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { commandTargetId: "target-1", status: { in: ["PENDING", "CLAIMED"] } },
      data: expect.objectContaining({ status: "CANCELLED", exitCode: 130 }),
    }));
  });
});

describe("markTargetsRunning", () => {
  it("only advances PENDING_APPROVAL/APPROVED targets to RUNNING", async () => {
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 2 });
    await markTargetsRunning("req-1");
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith({
      where: { commandRequestId: "req-1", status: { in: ["PENDING_APPROVAL", "APPROVED"] } },
      data: expect.objectContaining({ status: "RUNNING", startedAt: expect.any(Date) }),
    });
  });
});

describe("executeTarget", () => {
  it("skips remote work when the target already reached a terminal status", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "CANCELLED",
      commandRequest: { status: "RUNNING" },
    });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget());

    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    expect(mocks.prisma.executionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ commandRequestId: "req-1", serverId: "srv-1" }),
    });
  });

  it("skips remote work when the whole request is terminal", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "CANCELLED" },
    });
    const result = await executeTarget("req-1", buildTarget());
    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
  });

  it("dispatches through the Agent and stamps the Agent result", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING" },
    });
    mocks.executeCommandWithAgent.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget({
      server: { managementMode: "AGENT", sshKey: null, hostKeySha256: null },
    }));

    expect(result).toBe(true);
    expect(mocks.executeCommandWithAgent).toHaveBeenCalledWith(expect.objectContaining({
      serverId: "srv-1",
      commandTargetId: "target-1",
      command: "uptime",
      timeoutMs: RUNTIME.executionTimeoutMs,
    }));
    // Agent path never opens a direct SSH session.
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED", exitCode: 0 }),
    }));
  });

  it("fails Windows targets without an SSH fallback when the Agent is unavailable", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING" },
    });
    mocks.executeCommandWithAgent.mockResolvedValue(null);
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget({
      server: { managementMode: "AGENT", operatingSystem: "WINDOWS", sshKey: null, hostKeySha256: null },
    }));

    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "FAILED",
        exitCode: 255,
        stderr: expect.stringContaining("no SSH fallback channel"),
      }),
    }));
  });

  it("fails SSH_KEY targets whose key has no private key material", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING" },
    });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget({
      server: { sshKey: { id: "key-1", name: "public-only", privateKey: null } },
    }));

    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "FAILED",
        stderr: expect.stringMatching(/缺少私钥|lacks a private key/),
      }),
    }));
  });

  it("fails PASSWORD targets that have no stored password", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING" },
    });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget({
      server: { connectionType: "PASSWORD", sshKey: null, password: null },
    }));

    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "FAILED",
        stderr: expect.stringMatching(/未配置密码，无法执行|lacks a password/),
      }),
    }));
  });

  it("refuses to execute direct SSH without a pinned host key (fail closed)", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING" },
    });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget({
      server: { hostKeySha256: "" },
    }));

    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "FAILED",
        stderr: expect.stringMatching(/未固定 SSH 主机密钥指纹|no pinned SSH host key/),
      }),
    }));
  });

  it("executes over SSH with the decrypted private key and completes on exit 0", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING" },
    });
    mocks.executeCommandOverSsh.mockResolvedValue({ stdout: "up 1 day", stderr: "", exitCode: 0, cancelled: false });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget());

    expect(result).toBe(true);
    expect(mocks.decryptSshPrivateKey).toHaveBeenCalledWith("ENCRYPTED-KEY");
    expect(mocks.executeCommandOverSsh).toHaveBeenCalledWith(expect.objectContaining({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "ENCRYPTED-KEY",
      command: "uptime",
      targetId: "target-1",
      hostKeySha256: "SHA256:pinned",
    }));
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED", exitCode: 0, stdout: "up 1 day" }),
    }));
  });

  it("marks the target CANCELLED with exit code 130 when the operator cancelled mid-run", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING" },
    });
    mocks.executeCommandOverSsh.mockResolvedValue({ stdout: "", stderr: "", exitCode: 143, cancelled: true });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget());

    expect(result).toBe(false);
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "CANCELLED", exitCode: 130 }),
    }));
  });

  it("keeps the existing status when the target went terminal while SSH was closing", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING" },
    });
    mocks.executeCommandOverSsh.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, cancelled: false });
    // Late CAS loses: cancel/recovery already terminalized the row.
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget());

    expect(result).toBe(false);
    expect(mocks.prisma.executionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        summary: expect.stringContaining("already terminal"),
      }),
    });
  });
});

describe("executeTargets", () => {
  it("surfaces executor rejections as FAILED targets instead of leaving them RUNNING", async () => {
    // findMany returns the snapshot; the per-target live check then throws,
    // which must be recovered as a FAILED row with the rejection reason.
    mocks.prisma.commandTarget.findMany.mockResolvedValue([buildTarget()]);
    mocks.prisma.commandTarget.findUnique.mockRejectedValue(new Error("db exploded"));
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const { totalCount, completedCount } = await executeTargets("req-1");

    expect(totalCount).toBe(1);
    expect(completedCount).toBe(0);
    const recoveryCall = mocks.prisma.commandTarget.updateMany.mock.calls.find(
      ([args]) => args?.where?.status === "RUNNING" && args?.data?.exitCode === 255,
    );
    expect(recoveryCall).toBeTruthy();
    expect(recoveryCall?.[0]?.data?.stderr).toContain("db exploded");
  });
});

describe("heartbeatRunningCommandRequest", () => {
  it("stamps the worker heartbeat only on RUNNING requests", async () => {
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    await heartbeatRunningCommandRequest("req-1");
    expect(mocks.prisma.commandRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req-1", status: "RUNNING" },
      data: expect.objectContaining({ workerId: expect.any(String), workerHeartbeatAt: expect.any(Date) }),
    });
  });
});

describe("markCommandExecutionFailed", () => {
  it("claims the request first, then fails its queued targets and audits", async () => {
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 2 });
    mocks.prisma.executionLog.create.mockResolvedValue({});
    mocks.prisma.commandRequest.findUnique.mockResolvedValue({
      id: "req-1",
      title: "Restart nginx",
      requesterId: "user-1",
      status: "FAILED",
      teamId: "team-1",
    });

    await markCommandExecutionFailed("req-1", new Error("worker crashed"));

    expect(mocks.prisma.commandRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "req-1", status: { in: ["RUNNING", "APPROVED"] } },
      data: expect.objectContaining({ status: "FAILED" }),
    }));
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED", stderr: "worker crashed", exitCode: 255 }),
    }));
    expect(mocks.auditSystemAction).toHaveBeenCalledWith(
      "command.execute.failed",
      expect.objectContaining({ commandRequestId: "req-1", phase: "executor_error" }),
      "WARNING",
      "team-1",
    );
    expect(mocks.notifyCommandResult).toHaveBeenCalledWith("user-1", "Restart nginx", "failed", "team-1");
  });

  it("does not touch targets when the CAS claim loses to a concurrent cancel", async () => {
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 0 });

    await markCommandExecutionFailed("req-1", new Error("late failure"));

    expect(mocks.prisma.commandTarget.updateMany).not.toHaveBeenCalled();
    expect(mocks.auditSystemAction).not.toHaveBeenCalled();
  });
});

describe("enqueueApprovedCommandExecution", () => {
  it("claims APPROVED requests, marks targets RUNNING and enqueues the durable job", async () => {
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 2 });
    mocks.prisma.commandRequest.findUnique.mockResolvedValue({ status: "RUNNING" });
    mocks.prisma.executionLog.create.mockResolvedValue({});
    mocks.enqueueCommandExecutionJob.mockResolvedValue("job-1");

    const enqueued = await enqueueApprovedCommandExecution("req-1", "entered queue");

    expect(enqueued).toBe(true);
    expect(mocks.prisma.commandRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "req-1", status: { in: ["APPROVED"] } },
      data: expect.objectContaining({ status: "RUNNING" }),
    }));
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalled();
    expect(mocks.enqueueCommandExecutionJob).toHaveBeenCalledWith(expect.objectContaining({ commandRequestId: "req-1" }));
  });

  it("returns false without enqueuing when the claim loses", async () => {
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 0 });

    const enqueued = await enqueueApprovedCommandExecution("req-1", "entered queue");

    expect(enqueued).toBe(false);
    expect(mocks.enqueueCommandExecutionJob).not.toHaveBeenCalled();
  });

  it("aborts without enqueuing when the request was cancelled after the claim", async () => {
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    // Re-read after claim shows the operator already cancelled.
    mocks.prisma.commandRequest.findUnique.mockResolvedValue({ status: "CANCELLED" });

    const enqueued = await enqueueApprovedCommandExecution("req-1", "entered queue");

    expect(enqueued).toBe(false);
    expect(mocks.enqueueCommandExecutionJob).not.toHaveBeenCalled();
    expect(mocks.prisma.executionLog.create).not.toHaveBeenCalled();
  });
});
