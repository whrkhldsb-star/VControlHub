import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

const { mockPrisma, spawnMock, pendingExecutions } = vi.hoisted(() => ({
  mockPrisma: {
    commandRequest: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
    commandTarget: {
      updateMany: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
    },
    commandApproval: {
      create: vi.fn(),
    },
    executionLog: {
      create: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    notification: {
      create: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    server: {
      findMany: vi.fn(),
    },
    setting: {
      findUnique: vi.fn(),
    },
    $transaction: vi.fn(),
  },
  spawnMock: vi.fn(),
  pendingExecutions: new Set<Promise<void>>(),
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  const mockedModule = {
    ...actual,
    spawn: spawnMock,
  };

  return {
    __esModule: true,
    ...mockedModule,
    default: mockedModule,
  };
});

vi.mock("@/lib/db", () => ({
  prisma: mockPrisma,
  isDatabaseUnavailableError: (error: unknown) =>
    error instanceof Error && /P1001|Can't reach database server|PrismaClientInitializationError|database server/i.test(error.message),
}));

// TR-001 (T11): the command execution path now goes through the durable
// jobs table. In production the actual SSH dispatch is performed by
// startCommandExecutionWorker() when the job worker claims the row. In
// these unit tests we mock the new module to behave like the old
// fire-and-forget shim: enqueue is a no-op record, and we synchronously
// kick off the real executeAndFinalizeCommand so the existing
// `vi.waitFor(() => expect(spawnMock).toHaveBeenCalled())` assertions
// keep working without rewriting every test.
vi.mock("@/lib/command/execution-worker", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/command/execution-worker")>();
  return {
    ...actual,
    enqueueCommandExecutionJob: vi.fn(async ({ commandRequestId }: { commandRequestId: string; summary?: string }) => {
      const { executeAndFinalizeCommand } = await import("../service-execution");
      const execution = executeAndFinalizeCommand(commandRequestId).then(() => undefined, () => undefined);
      pendingExecutions.add(execution);
      void execution.finally(() => pendingExecutions.delete(execution));
      return { id: "job-test-1", type: actual.COMMAND_EXECUTION_JOB_TYPE, status: "PENDING" };
    }),
    runCommandExecutionJobWorkerOnce: vi.fn(async () => false),
    startCommandExecutionWorker: vi.fn(async () => ({ started: true, running: false, timer: null })),
    stopCommandExecutionWorkerForTests: vi.fn(),
  };
});

import { createCommandRequest, listCommandRequests, reviewCommandRequest, cancelCommandRequest, recoverQueuedApprovedCommandRequests } from "../service";

describe("command service execution flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    process.env.COMMAND_DEMO_FALLBACK = "false";
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    delete process.env.DEMO_MODE;
    delete process.env.COMMAND_EXECUTION_TIMEOUT_MS;
    delete process.env.COMMAND_OUTPUT_LIMIT_BYTES;
    delete process.env.COMMAND_EXECUTION_HEARTBEAT_MS;

    mockPrisma.setting.findUnique.mockResolvedValue(null);
    mockPrisma.auditLog.create.mockResolvedValue({ id: "audit_1" });
    mockPrisma.notification.create.mockResolvedValue({
      id: "notif_1",
      userId: "u1",
      type: "command",
      title: "t",
      message: "m",
      createdAt: new Date(),
      readAt: null,
      teamId: null,
    });
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.server.findMany.mockImplementation(async (args: { where?: { id?: { in?: string[] } } }) => {
      const ids = args?.where?.id?.in ?? [];
      return ids.map((id: string) => ({ id }));
    });
    mockPrisma.notification.count.mockResolvedValue(0);
    mockPrisma.$transaction.mockImplementation(async (callback: (tx: typeof mockPrisma) => unknown) => callback(mockPrisma));
    mockPrisma.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as MockChildProcess;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true);
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("ok\n"));
        child.emit("close", 0);
      });
      return child;
    });
  });

  afterEach(async () => {
    await Promise.allSettled([...pendingExecutions]);
    pendingExecutions.clear();
  });

  it("enqueues user-initiated execution without blocking the API caller", async () => {
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_user_1",
      status: "APPROVED",
      targets: [{ id: "target_1" }],
    });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_1",
        server: {
          id: "srv_1",
          name: "hk-prod-1",
          host: "203.0.113.10",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "uptime" },
      },
    ]);
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_user_1", status: "RUNNING" });
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_user_1", targets: [{ id: "target_1" }] });

    const result = await createCommandRequest({
      title: "Run uptime",
      command: "uptime",
      reason: "Check status",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_1"],
    });

    expect(result.requiresApproval).toBe(false);
    expect(mockPrisma.commandTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { commandRequestId: "req_user_1" } }),
    );
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandRequestId: "req_user_1",
          summary: expect.stringContaining("background SSH execution queue"),
        }),
      }),
    );
    expect(mockPrisma.commandTarget.update).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target_1" } }),
    );
    expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
      where: { id: "req_user_1" },
      data: { status: "COMPLETED", workerId: null, workerHeartbeatAt: null },
    });
  });

  it("refreshes RUNNING command requests while background SSH execution is still active", async () => {
    vi.useFakeTimers();
    process.env.COMMAND_EXECUTION_HEARTBEAT_MS = "1000";
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_heartbeat_1",
      status: "APPROVED",
      targets: [{ id: "target_heartbeat" }],
    });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_heartbeat",
        server: {
          id: "srv_heartbeat",
          name: "long-node",
          host: "203.0.113.21",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "sleep 5" },
      },
    ]);
    let heartbeatChild!: MockChildProcess;
    spawnMock.mockImplementationOnce(() => {
      heartbeatChild = new EventEmitter() as MockChildProcess;
      heartbeatChild.stdout = new EventEmitter();
      heartbeatChild.stderr = new EventEmitter();
      heartbeatChild.kill = vi.fn(() => true);
      return heartbeatChild;
    });
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_heartbeat_1", targets: [{ id: "target_heartbeat" }] });

    await createCommandRequest({
      title: "Long command with heartbeat",
      command: "sleep 5",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_heartbeat"],
    });

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    const heartbeatCallsBeforeInterval = mockPrisma.commandRequest.updateMany.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);

    expect(mockPrisma.commandRequest.updateMany.mock.calls.length).toBeGreaterThan(heartbeatCallsBeforeInterval);
    expect(mockPrisma.commandRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req_heartbeat_1", status: "RUNNING" },
      data: {
        status: "RUNNING",
        updatedAt: expect.any(Date),
        workerId: expect.any(String),
        workerHeartbeatAt: expect.any(Date),
      },
    });

    heartbeatChild.emit("close", 0);
    await vi.waitFor(() =>
      expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
        where: { id: "req_heartbeat_1" },
        data: { status: "COMPLETED", workerId: null, workerHeartbeatAt: null },
      }),
    );
    const callsAfterFinish = mockPrisma.commandRequest.updateMany.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(mockPrisma.commandRequest.updateMany.mock.calls.length).toBe(callsAfterFinish);
  });

  it("decrypts stored server password before password SSH execution", async () => {
    const { encryptServerPassword } = await import("@/lib/ssh/ssh-key-crypto");
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_pw_1",
      status: "APPROVED",
      targets: [{ id: "target_pw_1" }],
    });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_pw_1",
        server: {
          id: "srv_pw_1",
          name: "pw-prod-1",
          host: "203.0.113.20",
          port: 22,
          username: "admin",
          connectionType: "PASSWORD",
          password: encryptServerPassword("plain-secret"),
          sshKey: null,
        },
        commandRequest: { command: "uptime" },
      },
    ]);
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_pw_1", status: "RUNNING" });
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_pw_1", targets: [{ id: "target_pw_1" }] });

    await createCommandRequest({
      title: "Run uptime",
      command: "uptime",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_pw_1"],
    });

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledWith(
      "sshpass",
      expect.arrayContaining(["-e", "ssh", "-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR"]),
      expect.objectContaining({
        env: expect.objectContaining({ SSHPASS: "plain-secret" }),
      }),
    ));
  });

  it("routes SSH execution through a non-persistent known-hosts file", async () => {
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_known_hosts_1",
      status: "APPROVED",
      targets: [{ id: "target_known_hosts_1" }],
    });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_known_hosts_1",
        server: {
          id: "srv_known_hosts_1",
          name: "prod-node",
          host: "203.0.113.20",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "uptime" },
      },
    ]);
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_known_hosts_1", status: "RUNNING" });
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_known_hosts_1", targets: [{ id: "target_known_hosts_1" }] });

    await createCommandRequest({
      title: "Run uptime",
      command: "uptime",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_known_hosts_1"],
    });

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalledWith(
      "ssh",
      expect.arrayContaining(["-o", "StrictHostKeyChecking=accept-new", "-o", "UserKnownHostsFile=/dev/null", "-o", "LogLevel=ERROR"]),
      expect.any(Object),
    ));
    await vi.waitFor(() => expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target_known_hosts_1" } }),
    ));
  });

  it("normalizes duplicate command targets before creating approval/execution rows", async () => {
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_dedupe_1",
      status: "PENDING_APPROVAL",
      targets: [{ id: "target_srv_1" }, { id: "target_srv_2" }],
    });

    await createCommandRequest({
      title: "Run maintenance",
      command: "uptime",
      requesterId: "u_1",
      submissionMode: "assistant",
      serverIds: [" srv_1 ", "srv_1", "", "srv_2", " srv_2 "],
    });

    expect(mockPrisma.commandRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          targets: {
            create: [
              { serverId: "srv_1", status: "PENDING_APPROVAL" },
              { serverId: "srv_2", status: "PENDING_APPROVAL" },
            ],
          },
        }),
      }),
    );
  });

  it("rejects command requests when target normalization leaves no servers", async () => {
    await expect(createCommandRequest({
      title: "Run maintenance",
      command: "uptime",
      requesterId: "u_1",
      submissionMode: "assistant",
      serverIds: ["", "   "],
    })).rejects.toThrow("At least 1 target VPS must be selected");

    expect(mockPrisma.commandRequest.create).not.toHaveBeenCalled();
  });

  it("marks command request as failed when only some targets complete", async () => {
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_partial_1",
      status: "APPROVED",
      targets: [{ id: "target_ok" }, { id: "target_fail" }],
    });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_ok",
        server: {
          id: "srv_ok",
          name: "ok-node",
          host: "203.0.113.11",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "deploy" },
      },
      {
        id: "target_fail",
        server: {
          id: "srv_fail",
          name: "bad-node",
          host: "203.0.113.12",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "deploy" },
      },
    ]);
    spawnMock
      .mockImplementationOnce(() => {
        const child = new EventEmitter() as MockChildProcess;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn(() => true);
        queueMicrotask(() => {
          child.stdout.emit("data", Buffer.from("ok\n"));
          child.emit("close", 0);
        });
        return child;
      })
      .mockImplementationOnce(() => {
        const child = new EventEmitter() as MockChildProcess;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.kill = vi.fn(() => true);
        queueMicrotask(() => {
          child.stderr.emit("data", Buffer.from("failed\n"));
          child.emit("close", 1);
        });
        return child;
      });
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_partial_1", status: "RUNNING" });
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_partial_1", targets: [{ id: "target_ok" }, { id: "target_fail" }] });

    await createCommandRequest({
      title: "Deploy",
      command: "deploy",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_ok", "srv_fail"],
    });

    await vi.waitFor(() =>
      expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
        where: { id: "req_partial_1" },
        data: { status: "FAILED", workerId: null, workerHeartbeatAt: null },
      }),
    );
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandRequestId: "req_partial_1",
          serverId: null,
          summary: expect.stringContaining("only completed 1/2 targets"),
        }),
      }),
    );
  });

  it("executes multiple SSH targets concurrently so one slow server does not block later targets", async () => {
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_parallel_1",
      status: "APPROVED",
      targets: [{ id: "target_slow" }, { id: "target_fast" }],
    });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_slow",
        server: {
          id: "srv_slow",
          name: "slow-node",
          host: "203.0.113.21",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "deploy" },
      },
      {
        id: "target_fast",
        server: {
          id: "srv_fast",
          name: "fast-node",
          host: "203.0.113.22",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "deploy" },
      },
    ]);
    let slowChild!: MockChildProcess;
    spawnMock.mockImplementation((_, args) => {
      const child = new EventEmitter() as MockChildProcess;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true);

      if (Array.isArray(args) && args.includes("root@203.0.113.21")) {
        slowChild = child;
        return child;
      }

      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("fast ok\n"));
        child.emit("close", 0);
      });
      return child;
    });
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_parallel_1", status: "RUNNING" });
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_parallel_1", targets: [{ id: "target_slow" }, { id: "target_fast" }] });

    await createCommandRequest({
      title: "Deploy in parallel",
      command: "deploy",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_slow", "srv_fast"],
    });

    await vi.waitFor(() =>
      expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "target_fast" },
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      ),
    );
    expect(mockPrisma.commandTarget.update.mock.calls.map(([call]) => call)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ where: { id: "target_slow" } }),
      ]),
    );
    expect(mockPrisma.commandRequest.update).not.toHaveBeenCalledWith({
      where: { id: "req_parallel_1" },
      data: { status: "COMPLETED" },
    });

    slowChild.stdout.emit("data", Buffer.from("slow ok\n"));
    slowChild.emit("close", 0);

    await vi.waitFor(() =>
      expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "target_slow" },
          data: expect.objectContaining({ status: "COMPLETED" }),
        }),
      ),
    );
    await vi.waitFor(() =>
      expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
        where: { id: "req_parallel_1" },
        data: { status: "COMPLETED", workerId: null, workerHeartbeatAt: null },
      }),
    );
  });

  it("recovers approved commands left queued after a prior process exits before scheduling execution", async () => {
    mockPrisma.commandRequest.findMany.mockResolvedValue([{ id: "req_queued_1" }]);
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_queued_1",
        server: {
          id: "srv_queued_1",
          name: "queued-node",
          host: "203.0.113.30",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "uptime" },
      },
    ]);
    mockPrisma.commandRequest.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_queued_1", targets: [{ id: "target_queued_1" }] });

    const result = await recoverQueuedApprovedCommandRequests();

    expect(result).toEqual({ enqueued: 1 });
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: "APPROVED" },
        orderBy: { updatedAt: "asc" },
        take: 20,
      }),
    );
    expect(mockPrisma.commandRequest.updateMany).toHaveBeenCalledWith({
      where: { id: "req_queued_1", status: { in: ["APPROVED"] } },
      data: {
        status: "RUNNING",
        workerId: expect.any(String),
        workerHeartbeatAt: expect.any(Date),
      },
    });
    expect(mockPrisma.commandTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { commandRequestId: "req_queued_1" } }),
    );
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandRequestId: "req_queued_1",
          summary: expect.stringContaining("re-claimed"),
        }),
      }),
    );
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          summary: expect.stringMatching(/maintenance worker .+re-claimed/),
        }),
      }),
    );
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
  });

  it("does not schedule duplicate background execution when an approved command was already claimed", async () => {
    mockPrisma.commandRequest.findMany.mockResolvedValue([{ id: "req_claimed_1" }]);
    mockPrisma.commandRequest.updateMany.mockResolvedValue({ count: 0 });

    const result = await recoverQueuedApprovedCommandRequests();

    expect(result).toEqual({ enqueued: 0 });
    expect(mockPrisma.commandTarget.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.executionLog.create).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("kills long-running SSH commands and marks the target failed with timeout output", async () => {
    vi.useFakeTimers();
    process.env.COMMAND_EXECUTION_TIMEOUT_MS = "50";
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_timeout_1",
      status: "APPROVED",
      targets: [{ id: "target_timeout" }],
    });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_timeout",
        server: {
          id: "srv_timeout",
          name: "slow-node",
          host: "203.0.113.13",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "sleep 3600" },
      },
    ]);
    let timeoutChild!: MockChildProcess;
    spawnMock.mockImplementationOnce(() => {
      timeoutChild = new EventEmitter() as MockChildProcess;
      timeoutChild.stdout = new EventEmitter();
      timeoutChild.stderr = new EventEmitter();
      timeoutChild.kill = vi.fn(() => {
        timeoutChild.emit("close", null);
        return true;
      });
      return timeoutChild;
    });
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_timeout_1", status: "RUNNING" });
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_timeout_1", targets: [{ id: "target_timeout" }] });

    await createCommandRequest({
      title: "Slow command",
      command: "sleep 3600",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_timeout"],
    });

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    await vi.advanceTimersByTimeAsync(50);

    await vi.waitFor(() => expect(timeoutChild.kill).toHaveBeenCalledWith("SIGTERM"));
    await vi.waitFor(() =>
      expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith({
        where: { id: "target_timeout" },
        data: expect.objectContaining({
          status: "FAILED",
          exitCode: 124,
          stderr: expect.stringContaining("terminated"),
        }),
      }),
    );
    await vi.waitFor(() =>
      expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
        where: { id: "req_timeout_1" },
        data: { status: "FAILED", workerId: null, workerHeartbeatAt: null },
      }),
    );
  });

  it("cancels running command requests and terminates active SSH children", async () => {
    mockPrisma.commandRequest.findFirst.mockResolvedValueOnce({
      id: "req_cancel_1",
      status: "RUNNING",
      targets: [{ id: "target_cancel", status: "RUNNING" }],
    });
    mockPrisma.commandRequest.findUnique
      .mockResolvedValueOnce({ id: "req_cancel_1", targets: [{ id: "target_cancel" }] });
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_cancel_1", status: "CANCELLED" });
    mockPrisma.commandRequest.findUniqueOrThrow.mockResolvedValue({ id: "req_cancel_1", status: "CANCELLED" });
    let runningChild!: MockChildProcess;
    spawnMock.mockImplementationOnce(() => {
      runningChild = new EventEmitter() as MockChildProcess;
      runningChild.stdout = new EventEmitter();
      runningChild.stderr = new EventEmitter();
      runningChild.kill = vi.fn(() => {
        runningChild.emit("close", null);
        return true;
      });
      return runningChild;
    });
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_cancel_1",
      status: "APPROVED",
      targets: [{ id: "target_cancel" }],
    });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_cancel",
        server: {
          id: "srv_cancel",
          name: "cancel-node",
          host: "203.0.113.15",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "sleep 3600" },
      },
    ]);

    await createCommandRequest({
      title: "Long command",
      command: "sleep 3600",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_cancel"],
    });
    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());

    await cancelCommandRequest({ commandRequestId: "req_cancel_1", actorId: "u_2", reason: "wrong window" });

    expect(runningChild.kill).toHaveBeenCalledWith("SIGTERM");
    expect(mockPrisma.commandTarget.updateMany).toHaveBeenCalledWith({
      where: {
        commandRequestId: "req_cancel_1",
        status: { in: ["PENDING_APPROVAL", "APPROVED", "RUNNING"] },
      },
      data: expect.objectContaining({
        status: "CANCELLED",
        exitCode: 130,
        stderr: expect.stringContaining("wrong window"),
      }),
    });
    expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
      where: { id: "req_cancel_1" },
      data: { status: "CANCELLED", workerId: null, workerHeartbeatAt: null },
    });
  });

  it("truncates oversized SSH output before persisting target logs", async () => {
    process.env.COMMAND_OUTPUT_LIMIT_BYTES = "12";
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_output_1",
      status: "APPROVED",
      targets: [{ id: "target_output" }],
    });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_output",
        server: {
          id: "srv_output",
          name: "chatty-node",
          host: "203.0.113.14",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "yes" },
      },
    ]);
    spawnMock.mockImplementationOnce(() => {
      const child = new EventEmitter() as MockChildProcess;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.kill = vi.fn(() => true);
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("abcdefghijklmnopqrstuvwxyz"));
        child.emit("close", 0);
      });
      return child;
    });
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_output_1", status: "RUNNING" });
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_output_1", targets: [{ id: "target_output" }] });

    await createCommandRequest({
      title: "Chatty command",
      command: "yes",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_output"],
    });

    await vi.waitFor(() =>
      expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith({
        where: { id: "target_output" },
        data: expect.objectContaining({
          status: "COMPLETED",
          stdout: expect.stringContaining("output truncated"),
          exitCode: 0,
        }),
      }),
    );
  });

  it("approves assistant request and enqueues execution without blocking review", async () => {
    mockPrisma.commandRequest.findFirst
      .mockResolvedValueOnce({ id: "req_assistant_1", status: "PENDING_APPROVAL", requesterId: "u_1", title: "Restart nginx" });
    mockPrisma.commandRequest.findUnique
      .mockResolvedValueOnce({ id: "req_assistant_1", targets: [{ id: "target_2" }] });
    mockPrisma.commandRequest.update
      .mockResolvedValueOnce({ id: "req_assistant_1", status: "APPROVED" })
      .mockResolvedValueOnce({ id: "req_assistant_1", status: "RUNNING" })
      .mockResolvedValueOnce({ id: "req_assistant_1", status: "COMPLETED" });
    mockPrisma.commandRequest.findUniqueOrThrow.mockResolvedValue({ id: "req_assistant_1", status: "RUNNING" });
    mockPrisma.commandTarget.findMany.mockResolvedValue([
      {
        id: "target_2",
        server: {
          id: "srv_2",
          name: "sg-prod-1",
          host: "198.51.100.7",
          port: 22,
          username: "root",
          connectionType: "SSH_KEY",
          password: null,
          sshKey: { privateKey: "TEST_SSH_PRIVATE_KEY_PLACEHOLDER" },
        },
        commandRequest: { command: "systemctl restart nginx" },
      },
    ]);

    const result = await reviewCommandRequest({
      commandRequestId: "req_assistant_1",
      approverId: "admin_1",
      approved: true,
      comment: "ok",
    });

    expect(result.status).toBe("RUNNING");
    expect(mockPrisma.commandApproval.create).toHaveBeenCalled();
    expect(mockPrisma.commandTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { commandRequestId: "req_assistant_1" } }),
    );
    expect(mockPrisma.commandTarget.update).not.toHaveBeenCalled();
    expect(spawnMock).not.toHaveBeenCalled();
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandRequestId: "req_assistant_1",
          summary: "Command approval passed; the task has entered the background SSH execution queue.",
        }),
      }),
    );

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target_2" } }),
    );
  });

  it("rejects review when command is not pending approval", async () => {
    mockPrisma.commandRequest.findFirst.mockResolvedValue({ id: "req_done_1", status: "COMPLETED" });

    await expect(
      reviewCommandRequest({
        commandRequestId: "req_done_1",
        approverId: "admin_1",
        approved: false,
        comment: "late review",
      }),
    ).rejects.toThrow("Command request is not pending approval");
  });

  it("rejects create when session cannot see target servers (team IDOR)", async () => {
    mockPrisma.server.findMany.mockResolvedValueOnce([{ id: "srv_in_scope" }]);

    await expect(
      createCommandRequest(
        {
          title: "Cross-team shell",
          command: "id",
          requesterId: "u_team_a",
          submissionMode: "user",
          serverIds: ["srv_in_scope", "srv_other_team"],
        },
        {
          userId: "u_team_a",
          roles: ["operator"],
          currentTeamId: "team_a",
        },
      ),
    ).rejects.toThrow("outside your team scope");

    expect(mockPrisma.commandRequest.create).not.toHaveBeenCalled();
    expect(mockPrisma.server.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["srv_in_scope", "srv_other_team"] },
          OR: [{ teamId: "team_a" }, { teamId: null }],
        }),
      }),
    );
  });

  it("rejects system create with stamped teamId when targets are outside that team (playbook path)", async () => {
    mockPrisma.server.findMany.mockResolvedValueOnce([{ id: "srv_in_team" }]);

    await expect(
      createCommandRequest({
        title: "Playbook cross-team",
        command: "id",
        requesterId: "u_playbook",
        submissionMode: "user",
        serverIds: ["srv_in_team", "srv_other_team"],
        teamId: "team_a",
      }),
    ).rejects.toThrow("outside your team scope");

    expect(mockPrisma.commandRequest.create).not.toHaveBeenCalled();
    expect(mockPrisma.server.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["srv_in_team", "srv_other_team"] },
          OR: [{ teamId: "team_a" }, { teamId: null }],
        }),
      }),
    );
  });

  it("stamps CommandRequest.teamId from session and accepts in-scope servers", async () => {
    mockPrisma.server.findMany.mockResolvedValueOnce([{ id: "srv_1" }]);
    mockPrisma.commandRequest.create.mockResolvedValue({
      id: "req_team_1",
      status: "PENDING_APPROVAL",
      teamId: "team_a",
      targets: [{ id: "t1" }],
    });

    await createCommandRequest(
      {
        title: "Scoped run",
        command: "uptime",
        requesterId: "u_team_a",
        submissionMode: "assistant",
        serverIds: ["srv_1"],
        teamId: "team_attacker_override",
      },
      {
        userId: "u_team_a",
        roles: ["operator"],
        currentTeamId: "team_a",
      },
    );

    expect(mockPrisma.commandRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          teamId: "team_a",
        }),
      }),
    );
  });

  it("does not replay another team's command via shared idempotencyKey", async () => {
    mockPrisma.server.findMany.mockResolvedValueOnce([{ id: "srv_1" }]);
    // Scoped findFirst sees nothing for team_a even if the global key exists elsewhere.
    mockPrisma.commandRequest.findFirst.mockResolvedValueOnce(null);
    const uniqueError = Object.assign(new Error("Unique constraint failed on the fields: (`idempotencyKey`)"), {
      code: "P2002",
    });
    mockPrisma.commandRequest.create.mockRejectedValueOnce(uniqueError);
    // After P2002, second scoped lookup still finds nothing → ValidationError, not foreign row.
    mockPrisma.commandRequest.findFirst.mockResolvedValueOnce(null);

    await expect(
      createCommandRequest(
        {
          title: "Replay attack",
          command: "cat /etc/shadow",
          requesterId: "u_team_a",
          submissionMode: "assistant",
          serverIds: ["srv_1"],
          idempotencyKey: "playbook:shared-key",
        },
        {
          userId: "u_team_a",
          roles: ["operator"],
          currentTeamId: "team_a",
        },
      ),
    ).rejects.toThrow("Idempotency key is already in use");

    expect(mockPrisma.commandRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          idempotencyKey: "playbook:shared-key",
          OR: [{ teamId: "team_a" }, { teamId: null }],
        }),
      }),
    );
  });

  it("replays same-team idempotencyKey without creating a second request", async () => {
    mockPrisma.commandRequest.findFirst.mockResolvedValueOnce({
      id: "req_existing",
      status: "PENDING_APPROVAL",
      teamId: "team_a",
      command: "uptime",
      targets: [{ id: "t1" }],
    });

    const result = await createCommandRequest(
      {
        title: "Replay same team",
        command: "uptime",
        requesterId: "u_team_a",
        submissionMode: "assistant",
        serverIds: ["srv_1"],
        idempotencyKey: "playbook:team-a-key",
      },
      {
        userId: "u_team_a",
        roles: ["operator"],
        currentTeamId: "team_a",
      },
    );

    expect(result.id).toBe("req_existing");
    expect(result.requiresApproval).toBe(true);
    expect(mockPrisma.commandRequest.create).not.toHaveBeenCalled();
    expect(mockPrisma.server.findMany).not.toHaveBeenCalled();
  });

  it("scopes cancel/review loads with teamWhere when session is provided", async () => {
    mockPrisma.commandRequest.findFirst.mockResolvedValue(null);

    await expect(
      cancelCommandRequest({
        commandRequestId: "req_other_team",
        actorId: "u_team_a",
        session: { userId: "u_team_a", roles: ["operator"], currentTeamId: "team_a" },
      }),
    ).rejects.toThrow("Command request not found");

    expect(mockPrisma.commandRequest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "req_other_team",
          OR: [{ teamId: "team_a" }, { teamId: null }],
        }),
      }),
    );

    mockPrisma.commandRequest.findFirst.mockResolvedValue(null);
    await expect(
      reviewCommandRequest(
        {
          commandRequestId: "req_other_team",
          approverId: "u_team_a",
          approved: true,
        },
        { userId: "u_team_a", roles: ["operator"], currentTeamId: "team_a" },
      ),
    ).rejects.toThrow("Command request not found");
  });

  it("recovers stale running command requests that lost their in-process worker", async () => {
    process.env.COMMAND_STALE_RUNNING_AFTER_MS = "1000";
    process.env.COMMAND_EXECUTION_TIMEOUT_MS = "1000";
    const now = new Date("2026-05-30T08:00:00Z");
    mockPrisma.commandRequest.findMany.mockResolvedValueOnce([
      {
        id: "req_stale_1",
        workerId: "worker-lost-1",
        workerHeartbeatAt: new Date("2026-05-30T07:58:00Z"),
        targets: [{ id: "target_stale", status: "RUNNING" }],
      },
    ]);
    mockPrisma.commandTarget.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_stale_1", status: "FAILED" });

    const { recoverStaleRunningCommandRequests } = await import("../service");
    const result = await recoverStaleRunningCommandRequests(now);

    expect(result).toEqual({ recovered: 1 });
    expect(mockPrisma.commandRequest.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        status: "RUNNING",
        OR: [
          { workerHeartbeatAt: { lt: new Date("2026-05-30T07:59:59Z") } },
          { workerHeartbeatAt: null, updatedAt: { lt: new Date("2026-05-30T07:59:59Z") } },
        ],
      },
      take: 50,
    }));
    expect(mockPrisma.commandTarget.updateMany).toHaveBeenCalledWith({
      where: {
        commandRequestId: "req_stale_1",
        status: { in: ["RUNNING", "APPROVED", "PENDING_APPROVAL"] },
      },
      data: expect.objectContaining({
        status: "FAILED",
        stderr: expect.stringContaining("service restart"),
        exitCode: 255,
        finishedAt: now,
      }),
    });
    expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
      where: { id: "req_stale_1" },
      data: { status: "FAILED", workerId: null, workerHeartbeatAt: null },
    });
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        commandRequestId: "req_stale_1",
        summary: expect.stringContaining("Stale RUNNING command"),
      }),
    }));
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        summary: expect.stringContaining("worker-lost-1"),
      }),
    }));
  });

  it("archives stale running command requests from completed target state", async () => {
    process.env.COMMAND_STALE_RUNNING_AFTER_MS = "1000";
    mockPrisma.commandRequest.findMany.mockResolvedValueOnce([
      {
        id: "req_stale_done",
        workerId: "worker-archived-1",
        workerHeartbeatAt: new Date("2026-05-30T07:57:00Z"),
        targets: [{ id: "target_done", status: "COMPLETED" }],
      },
    ]);
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_stale_done", status: "COMPLETED" });

    const { recoverStaleRunningCommandRequests } = await import("../service");
    const result = await recoverStaleRunningCommandRequests(new Date("2026-05-30T08:00:00Z"));

    expect(result).toEqual({ recovered: 1 });
    expect(mockPrisma.commandTarget.updateMany).not.toHaveBeenCalled();
    expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
      where: { id: "req_stale_done" },
      data: { status: "COMPLETED", workerId: null, workerHeartbeatAt: null },
    });
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        commandRequestId: "req_stale_done",
        summary: expect.stringContaining("automatically archived as COMPLETED"),
      }),
    }));
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        summary: expect.stringContaining("worker-archived-1"),
      }),
    }));
  });

  it("does not fall back to demo command data when database is unavailable", async () => {
    const dbError = new Error("Can't reach database server");
    mockPrisma.commandRequest.findMany.mockRejectedValue(dbError);

    await expect(listCommandRequests()).rejects.toThrow("Can't reach database server");
  });
});
