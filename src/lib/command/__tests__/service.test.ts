import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";

type MockChildProcess = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
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
    process.env.COMMAND_DEMO_FALLBACK = "false";
    delete process.env.NEXT_PUBLIC_DEMO_MODE;
    delete process.env.DEMO_MODE;

    spawnMock.mockImplementation(() => {
      const child = new EventEmitter() as MockChildProcess;
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      queueMicrotask(() => {
        child.stdout.emit("data", Buffer.from("ok\n"));
        child.emit("close", 0);
      });
      return child;
    });
  });

  it("executes immediately for user-initiated requests", async () => {
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
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_user_1", status: "COMPLETED" });

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
    expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target_1" } }),
    );
    expect(mockPrisma.executionLog.create).toHaveBeenCalledTimes(2);
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
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_pw_1", status: "COMPLETED" });

    await createCommandRequest({
      title: "Run uptime",
      command: "uptime",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_pw_1"],
    });

    // SSH password is now passed via SSHPASS env var (not -p flag) to avoid /proc/cmdline leak
    expect(spawnMock).toHaveBeenCalledWith(
      "sshpass",
      expect.arrayContaining(["-e", "ssh"]),
      expect.objectContaining({
        env: expect.objectContaining({ SSHPASS: "plain-secret" }),
      }),
    );
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
        queueMicrotask(() => {
          child.stderr.emit("data", Buffer.from("failed\n"));
          child.emit("close", 1);
        });
        return child;
      });
    mockPrisma.commandRequest.update.mockResolvedValue({ id: "req_partial_1", status: "FAILED" });

    await createCommandRequest({
      title: "Deploy",
      command: "deploy",
      requesterId: "u_1",
      submissionMode: "user",
      serverIds: ["srv_ok", "srv_fail"],
    });

    expect(mockPrisma.commandRequest.update).toHaveBeenCalledWith({
      where: { id: "req_partial_1" },
      data: { status: "FAILED" },
    });
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

  it("approves assistant request and advances execution flow", async () => {
    mockPrisma.commandRequest.findUnique.mockResolvedValue({ id: "req_assistant_1", status: "PENDING_APPROVAL" });
    mockPrisma.commandRequest.update
      .mockResolvedValueOnce({ id: "req_assistant_1", status: "APPROVED" })
      .mockResolvedValueOnce({ id: "req_assistant_1", status: "RUNNING" })
      .mockResolvedValueOnce({ id: "req_assistant_1", status: "COMPLETED" });
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
    mockPrisma.commandRequest.findUniqueOrThrow.mockResolvedValue({ id: "req_assistant_1", status: "COMPLETED" });

    const result = await reviewCommandRequest({
      commandRequestId: "req_assistant_1",
      approverId: "admin_1",
      approved: true,
      comment: "ok",
    });

    expect(result.status).toBe("COMPLETED");
    expect(mockPrisma.commandApproval.create).toHaveBeenCalled();
    expect(mockPrisma.commandTarget.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { commandRequestId: "req_assistant_1" } }),
    );
    expect(mockPrisma.commandTarget.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "target_2" } }),
    );
    expect(mockPrisma.executionLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          commandRequestId: "req_assistant_1",
          summary: "命令审批已通过，任务正在进入真实 SSH 执行器。",
        }),
      }),
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
