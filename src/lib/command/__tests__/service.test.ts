import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

const { mockPrisma, spawnMock } = vi.hoisted(() => ({
  mockPrisma: {
    commandRequest: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
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
  },
  spawnMock: vi.fn(),
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

import { createCommandRequest, listCommandRequests, reviewCommandRequest } from "../service";

describe("command service execution flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    process.env.COMMAND_DEMO_FALLBACK = "false";
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    delete process.env.DEMO_MODE;
    delete process.env.COMMAND_EXECUTION_TIMEOUT_MS;
    delete process.env.COMMAND_OUTPUT_LIMIT_BYTES;

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
          summary: expect.stringContaining("后台 SSH 执行队列"),
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
      data: { status: "COMPLETED" },
    });
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
      expect.arrayContaining(["-e", "ssh"]),
      expect.objectContaining({
        env: expect.objectContaining({ SSHPASS: "plain-secret" }),
      }),
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
    })).rejects.toThrow("至少选择 1 台目标 VPS");

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
        data: { status: "FAILED" },
      }),
    );
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandRequestId: "req_partial_1",
          serverId: null,
          summary: expect.stringContaining("仅完成 1/2 个目标"),
        }),
      }),
    );
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
          stderr: expect.stringContaining("已终止"),
        }),
      }),
    );
    await vi.waitFor(() =>
      expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
        where: { id: "req_timeout_1" },
        data: { status: "FAILED" },
      }),
    );
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
          stdout: expect.stringContaining("输出已截断"),
          exitCode: 0,
        }),
      }),
    );
  });

  it("approves assistant request and enqueues execution without blocking review", async () => {
    mockPrisma.commandRequest.findUnique
      .mockResolvedValueOnce({ id: "req_assistant_1", status: "PENDING_APPROVAL" })
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
          summary: "命令审批已通过，任务已进入后台 SSH 执行队列。",
        }),
      }),
    );

    await vi.waitFor(() => expect(spawnMock).toHaveBeenCalled());
    expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target_2" } }),
    );
  });

  it("rejects review when command is not pending approval", async () => {
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_done_1", status: "COMPLETED" });

    await expect(
      reviewCommandRequest({
        commandRequestId: "req_done_1",
        approverId: "admin_1",
        approved: false,
        comment: "late review",
      }),
    ).rejects.toThrow("当前命令请求不在待审批状态");
  });

  it("does not fall back to demo command data when database is unavailable", async () => {
    const dbError = new Error("Can't reach database server");
    mockPrisma.commandRequest.findMany.mockRejectedValue(dbError);

    await expect(listCommandRequests()).rejects.toThrow("Can't reach database server");
  });
});
