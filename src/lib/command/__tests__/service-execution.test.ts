import { CommandCancellationUnconfirmedError } from "../cancellation-error";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    $transaction: vi.fn(),
    server: { findUnique: vi.fn(async () => ({ id: "srv-1" }) as { id: string } | null) },
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
  assertRequesterMayExecuteCommand: vi.fn(async (..._args: unknown[]): Promise<{ ok: boolean; reason?: string }> => ({ ok: true })),
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
vi.mock("@/lib/auth/command-execution-authz", () => ({ assertRequesterMayExecuteCommand: mocks.assertRequesterMayExecuteCommand }));
vi.mock("../cancellation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../cancellation")>()),
  monitorCommandCancellation: vi.fn(async () => () => {}),
}));
vi.mock("../execution-queue", () => ({ enqueueCommandExecutionJob: mocks.enqueueCommandExecutionJob }));
vi.mock("../ssh-executor", () => ({
  cancelRunningCommandChild: mocks.cancelRunningCommandChild,
  markCommandTargetCancelled: mocks.markCommandTargetCancelled,
}));
vi.mock("@/lib/audit/service", () => ({ auditSystemAction: mocks.auditSystemAction }));
vi.mock("@/lib/notification/service", () => ({ notifyCommandResult: mocks.notifyCommandResult }));
vi.mock("@/lib/ssh/ssh-key-crypto", async () => (await import("@/test/ssh-key-crypto-mock")).withStoredKeyHelpers({
  decryptSshPrivateKey: mocks.decryptSshPrivateKey,
  decryptServerPassword: mocks.decryptServerPassword,
}));

import {
  cancelActiveCommandChild,
  enqueueApprovedCommandExecution,
  executeAndFinalizeCommand,
  executeTarget,
  executeTargets,
  heartbeatRunningCommandRequest,
  markCommandExecutionFailed,
  markTargetsRunning,
} from "../service-execution";

const RUNTIME = { executionTimeoutMs: 1000, outputLimitBytes: 1000, staleRunningAfterMs: 1000, executionHeartbeatMs: 100 };

describe("executeAndFinalizeCommand", () => {
  it("settles from the persisted targets when a target already completed and all subsequent logs fail", async () => {
    const request = { id: "req-1", title: "check", requesterId: "user", teamId: "team", status: "RUNNING", targets: [{ status: "COMPLETED" }] };
    mocks.prisma.commandRequest.findUnique.mockResolvedValue(request);
    mocks.prisma.commandTarget.findMany.mockResolvedValue([buildTarget()]);
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({ status: "COMPLETED", commandRequest: { status: "RUNNING" } });
    mocks.prisma.executionLog.create.mockRejectedValue(new Error("log unavailable"));
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.commandRequest.findUniqueOrThrow.mockResolvedValue({ ...request, status: "COMPLETED" });
    await executeAndFinalizeCommand(request.id);
    expect(mocks.prisma.commandRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
  });

  it("acknowledges cancellation arriving after the final status read", async () => {
    const request = { id: "req-1", status: "RUNNING", title: "Check uptime", requesterId: "user-1", teamId: "team-1", targets: [{ status: "COMPLETED" }] };
    mocks.prisma.commandRequest.findUnique.mockResolvedValue(request);
    mocks.prisma.commandRequest.findUniqueOrThrow.mockResolvedValue({ ...request, status: "CANCELLED" });
    mocks.prisma.commandTarget.findMany.mockResolvedValue([]);
    mocks.prisma.executionLog.create.mockResolvedValue({});
    mocks.prisma.commandRequest.updateMany
      .mockResolvedValueOnce({ count: 1 }) // Heartbeat.
      .mockResolvedValueOnce({ count: 0 }) // Concurrent cancel beats finalization.
      .mockResolvedValueOnce({ count: 1 }); // Worker acknowledges transports settled.

    const result = await executeAndFinalizeCommand("req-1");

    expect(result.status).toBe("CANCELLED");
    expect(mocks.prisma.commandRequest.updateMany).toHaveBeenLastCalledWith({
      where: { id: "req-1", status: "CANCELLING" },
      data: { status: "CANCELLED", workerId: null, workerHeartbeatAt: null },
    });
    expect(mocks.prisma.commandTarget.updateMany).not.toHaveBeenCalled();
    expect(mocks.notifyCommandResult).toHaveBeenCalledWith("user-1", "Check uptime", "cancelled", "team-1");
  });
});

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
      teamId: "team-1", agentTokenHash: null,
      password: null,
      hostKeySha256: "SHA256:pinned",
      sshKey: { id: "key-1", name: "deploy", updatedAt: new Date(), privateKey: "ENCRYPTED-KEY", passphrase: null },
      ...overrides.server,
    },
    commandRequest: { command: "uptime", title: "Check uptime" },
    // Partial fixture: only the fields executeTarget reads are populated.
  } as unknown as Parameters<typeof executeTarget>[1];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCommandRuntimeConfigValues.mockResolvedValue(RUNTIME);
  mocks.prisma.$transaction.mockImplementation(async (work) => work(mocks.prisma));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("cancelActiveCommandChild", () => {
  it("signals the local SSH child without claiming remote Agent acknowledgement", () => {
    mocks.cancelRunningCommandChild.mockReturnValue(true);
    const result = cancelActiveCommandChild("target-1");
    expect(result).toBe(true);
    expect(mocks.cancelRunningCommandChild).toHaveBeenCalledWith("target-1");
    expect(mocks.prisma.serverAgentJob.updateMany).not.toHaveBeenCalled();
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
  it("runs every target of a large request, reading them in pages", async () => {
    const page = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ ...buildTarget(), id: `t-${String(from + i).padStart(4, "0")}` }));
    mocks.prisma.commandTarget.findMany.mockResolvedValueOnce(page(0, 500)).mockResolvedValueOnce(page(500, 500)).mockResolvedValueOnce(page(1000, 1));
    // Each target is already terminal: no remote work, just the bookkeeping.
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({ id: "t", status: "CANCELLED", commandRequest: { status: "RUNNING", approvals: [] } });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTargets("req-1");

    expect(result.totalCount).toBe(1001);
    expect(mocks.prisma.commandTarget.findUnique).toHaveBeenCalledTimes(1001);
    expect(mocks.prisma.commandTarget.findMany.mock.calls[1]![0]).toMatchObject({ cursor: { id: "t-0499" }, skip: 1 });
    expect(mocks.prisma.commandTarget.findMany.mock.calls[2]![0]).toMatchObject({ cursor: { id: "t-0999" }, skip: 1 });
  });

  it("skips remote work when the target already reached a terminal status", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "CANCELLED",
      commandRequest: { status: "RUNNING", approvals: [] },
    });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget());

    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    expect(mocks.prisma.executionLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ commandRequestId: "req-1", serverId: "srv-1" }),
    });
  });

  it("asks for the requester's execute permission only when no reviewer approved the request", async () => {
    // Refuse both times so neither run goes on to SSH; Once, so the default (allowed) stays for other tests.
    mocks.assertRequesterMayExecuteCommand
      .mockResolvedValueOnce({ ok: false, reason: "stop here" })
      .mockResolvedValueOnce({ ok: false, reason: "stop here" });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});
    const live = (approvals: Array<{ id: string }>) => ({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING", requesterId: "user-1", teamId: "team-1", approvals },
    });

    // A request someone approved runs on that decision: a member who may only create requests is not refused.
    mocks.prisma.commandTarget.findUnique.mockResolvedValue(live([{ id: "approval-1" }]));
    await executeTarget("req-1", buildTarget());
    expect(mocks.assertRequesterMayExecuteCommand).toHaveBeenLastCalledWith("user-1", "team-1", "srv-1", { requireExecutePermission: false });

    // Nobody approved it (an unattended run): the requester's own authority is checked as before.
    mocks.prisma.commandTarget.findUnique.mockResolvedValue(live([]));
    await executeTarget("req-1", buildTarget());
    expect(mocks.assertRequesterMayExecuteCommand).toHaveBeenLastCalledWith("user-1", "team-1", "srv-1", { requireExecutePermission: true });
    // The lookup only counts approvals that said yes.
    expect(mocks.prisma.commandTarget.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      select: expect.objectContaining({
        commandRequest: { select: expect.objectContaining({ approvals: { where: { approved: true }, select: { id: true }, take: 1 } }) },
      }),
    }));
  });

  it("skips remote work when the whole request is terminal", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "CANCELLED", approvals: [] },
    });
    const result = await executeTarget("req-1", buildTarget());
    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
  });

  it("dispatches through the Agent and stamps the Agent result", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING", approvals: [] },
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

  it("rechecks the login before falling back and preserves spaces in an SSH password", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({ id: "target-1", status: "RUNNING", commandRequest: { status: "RUNNING", approvals: [] } });
    mocks.executeCommandWithAgent.mockResolvedValue(null);
    mocks.executeCommandOverSsh.mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    const target = buildTarget({ server: { managementMode: "AGENT", connectionType: "PASSWORD", sshKey: null, password: " exact " } });
    mocks.prisma.server.findUnique.mockResolvedValueOnce(null);
    expect(await executeTarget("req-1", target)).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    expect(await executeTarget("req-1", target)).toBe(true);
    expect(mocks.executeCommandOverSsh).toHaveBeenCalledWith(expect.objectContaining({ password: " exact " }));
  });

  it("checks live requester grants again after an Agent leaves the job unclaimed", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({ status: "RUNNING", commandRequest: {
      status: "RUNNING", requesterId: "user", teamId: "team", approvals: [{ id: "approved" }],
    } });
    mocks.executeCommandWithAgent.mockResolvedValueOnce(null);
    mocks.assertRequesterMayExecuteCommand.mockResolvedValueOnce({ ok: true }).mockResolvedValueOnce({ ok: false, reason: "connection revoked" });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    expect(await executeTarget("req-1", buildTarget({ server: { managementMode: "AGENT" } }))).toBe(false);
    expect(mocks.assertRequesterMayExecuteCommand).toHaveBeenLastCalledWith("user", "team", "srv-1", { requireExecutePermission: false });
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED", stderr: expect.stringContaining("connection revoked") }),
    }));
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
  });

  it("checks the SSH key revision, team and Agent identity again before dispatch", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({ id: "target-1", status: "RUNNING", commandRequest: { status: "RUNNING", approvals: [] } });
    mocks.executeCommandWithAgent.mockResolvedValueOnce(null);
    mocks.prisma.server.findUnique.mockResolvedValueOnce(null);
    const target = buildTarget({ server: { managementMode: "AGENT", agentTokenHash: "previous-identity" } });
    await executeTarget("req-1", target);
    expect(mocks.prisma.server.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ teamId: "team-1", agentTokenHash: "previous-identity",
        sshKey: { is: { updatedAt: target.server.sshKey!.updatedAt } } }),
    }));
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
  });

  it.each([new CommandCancellationUnconfirmedError(), new Error("result lookup disconnected")])("flags an unconfirmed Agent outcome and prevents SSH replay (%s)", async (error) => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING", approvals: [] },
    });
    mocks.executeCommandWithAgent.mockRejectedValue(error);
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget({
      server: { managementMode: "AGENT", sshKey: null, hostKeySha256: "SHA256:pinned" },
    }));

    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "FAILED", outcomeUnknown: true }),
    }));
  });

  it.each(["AGENT_OFFLINE", "AGENT_UNCLAIMED"])("records SSH and the confirmed fallback reason %s", async (reason) => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({ status: "RUNNING", commandRequest: { status: "RUNNING", approvals: [] } });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.assertRequesterMayExecuteCommand.mockResolvedValue({ ok: true });
    mocks.executeCommandWithAgent.mockImplementationOnce(async ({ onUnavailable }) => { onUnavailable(reason); return null; });
    mocks.executeCommandOverSsh.mockResolvedValueOnce({ stdout: "ok", stderr: "", exitCode: 0 });
    expect(await executeTarget("req-1", buildTarget({ server: { managementMode: "AGENT" } }))).toBe(true);
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalledWith(expect.objectContaining({ data: { executionChannel: "SSH", fallbackReason: reason, outcomeUnknown: true } }));
  });

  it("fails Windows targets without an SSH fallback when the Agent is unavailable", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING", approvals: [] },
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

  it("says the Agent is offline, not that an SSH key is incomplete, for a node that has no SSH login at all", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING", approvals: [] },
    });
    mocks.executeCommandWithAgent.mockResolvedValue(null); // Agent not seen recently.
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    const result = await executeTarget("req-1", buildTarget({ server: { managementMode: "AGENT", sshKey: null, password: null } }));

    expect(result).toBe(false);
    expect(mocks.executeCommandOverSsh).not.toHaveBeenCalled();
    const written = mocks.prisma.commandTarget.updateMany.mock.calls.at(-1)![0] as { data: { status: string; stderr: string } };
    expect(written.data.status).toBe("FAILED");
    expect(written.data.stderr).toContain("Agent");
    expect(written.data.stderr).not.toContain("私钥");
  });

  it("fails SSH_KEY targets whose key has no private key material", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING", approvals: [] },
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
      commandRequest: { status: "RUNNING", approvals: [] },
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
      commandRequest: { status: "RUNNING", approvals: [] },
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
      commandRequest: { status: "RUNNING", approvals: [] },
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
      commandRequest: { status: "RUNNING", approvals: [] },
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

  it("does not call a command the platform stopped itself cancelled by the operator", async () => {
    // The monitor stops a command whose cancellation state it cannot read. That was recorded as CANCELLED /
    // exit 130 / "cancelled by the operator", and the request ended CANCELLED with nobody having cancelled it.
    const { CommandCancellationStateUnknownError, monitorCommandCancellation } = await import("../cancellation");
    vi.mocked(monitorCommandCancellation).mockImplementationOnce(async (_targetId, controller) => {
      controller.abort(new CommandCancellationStateUnknownError());
      return () => {};
    });
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING", approvals: [] },
    });
    mocks.executeCommandOverSsh.mockResolvedValue({ stdout: "half", stderr: "Command has been cancelled; SSH subprocess terminated.", exitCode: 130, cancelled: true, outcomeUnknown: true });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.executionLog.create.mockResolvedValue({});

    expect(await executeTarget("req-1", buildTarget())).toBe(false);

    const written = mocks.prisma.commandTarget.updateMany.mock.calls.at(-1)![0] as { data: { status: string; exitCode: number; stderr: string; outcomeUnknown: boolean } };
    expect(written.data).toMatchObject({ status: "FAILED", exitCode: 255, outcomeUnknown: true });
    expect(written.data.stderr).toContain("Stopped by the platform, not by an operator");
    expect(written.data.stderr).toContain("SSH subprocess terminated");
    const summary = (mocks.prisma.executionLog.create.mock.calls.at(-1)![0] as { data: { summary: string } }).data.summary;
    expect(summary).toContain("stopped by the platform");
    expect(summary).not.toContain("cancelled by the operator");

    // A command that had already finished when the monitor gave up keeps its own result.
    vi.mocked(monitorCommandCancellation).mockImplementationOnce(async (_targetId, controller) => {
      controller.abort(new CommandCancellationStateUnknownError());
      return () => {};
    });
    mocks.executeCommandOverSsh.mockResolvedValue({ stdout: "done", stderr: "", exitCode: 0, cancelled: false });
    expect(await executeTarget("req-1", buildTarget())).toBe(true);
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED", exitCode: 0, stderr: null }),
    }));
  });

  it("keeps the existing status when the target went terminal while SSH was closing", async () => {
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({
      id: "target-1",
      status: "RUNNING",
      commandRequest: { status: "RUNNING", approvals: [] },
    });
    mocks.executeCommandOverSsh.mockResolvedValue({ stdout: "", stderr: "", exitCode: 0, cancelled: false });
    // The dispatch stamp succeeds; the result CAS loses to cancel/recovery.
    mocks.prisma.commandTarget.updateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValue({ count: 0 });
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
  it("retains a durable unknown outcome when the result of dispatched SSH cannot be saved", async () => {
    mocks.prisma.commandTarget.findMany.mockResolvedValue([buildTarget()]);
    mocks.prisma.commandTarget.findUnique.mockResolvedValue({ status: "RUNNING", commandRequest: { status: "RUNNING", approvals: [] } });
    const row = { status: "RUNNING", outcomeUnknown: false };
    mocks.prisma.commandTarget.updateMany.mockImplementation(async ({ data }) => {
      if (data.status === "COMPLETED") throw new Error("result write failed");
      Object.assign(row, data);
      return { count: 1 };
    });
    mocks.executeCommandOverSsh.mockImplementationOnce(async () => {
      expect(row.outcomeUnknown).toBe(true);
      return { exitCode: 0, stdout: "done", stderr: "" };
    });
    await executeTargets("req-1");
    expect(row).toMatchObject({ status: "FAILED", outcomeUnknown: true });
  });

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
      ([args]) => args?.where?.status?.in?.includes("RUNNING") && args?.data?.exitCode === 255,
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
      where: { id: "req-1", status: { in: ["RUNNING", "CANCELLING"] } },
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
      status: "RUNNING",
      targets: [{ status: "FAILED" }],
      teamId: "team-1",
    });

    await markCommandExecutionFailed("req-1", new Error("worker crashed"));

    expect(mocks.prisma.commandRequest.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "req-1", status: { in: ["RUNNING", "CANCELLING", "APPROVED"] } },
      data: { workerHeartbeatAt: expect.any(Date) },
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

  it("preserves completion when the final status read had failed after every result was saved", async () => {
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.commandTarget.updateMany.mockResolvedValue({ count: 0 });
    mocks.prisma.commandRequest.findUnique.mockResolvedValue({
      id: "req-1", title: "Check", requesterId: "user", teamId: "team", status: "RUNNING", targets: [{ status: "COMPLETED" }],
    });
    await markCommandExecutionFailed("req-1", new Error("final read failed"));
    expect(mocks.prisma.commandRequest.updateMany).toHaveBeenLastCalledWith(expect.objectContaining({
      data: expect.objectContaining({ status: "COMPLETED" }),
    }));
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
      where: { id: "req-1", status: "APPROVED" },
      data: expect.objectContaining({ status: "RUNNING" }),
    }));
    expect(mocks.prisma.commandTarget.updateMany).toHaveBeenCalled();
    expect(mocks.enqueueCommandExecutionJob).toHaveBeenCalledWith(expect.objectContaining({ commandRequestId: "req-1" }), mocks.prisma);
  });

  it("returns false without enqueuing when the claim loses", async () => {
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 0 });

    const enqueued = await enqueueApprovedCommandExecution("req-1", "entered queue");

    expect(enqueued).toBe(false);
    expect(mocks.enqueueCommandExecutionJob).not.toHaveBeenCalled();
  });

  it("propagates a target write failure to the claim transaction before queuing", async () => {
    mocks.prisma.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.commandTarget.updateMany.mockRejectedValueOnce(new Error("target unavailable"));
    await expect(enqueueApprovedCommandExecution("req-1", "entered queue")).rejects.toThrow("target unavailable");
    expect(mocks.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(mocks.enqueueCommandExecutionJob).not.toHaveBeenCalled();
    expect(mocks.prisma.executionLog.create).not.toHaveBeenCalled();
  });
});
