import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  findManyMock,
  createCommandRequestMock,
  recordTaskRunMock,
  infoMock,
  warnMock,
  errorMock,
} = vi.hoisted(() => ({
  findManyMock: vi.fn(),
  createCommandRequestMock: vi.fn(),
  recordTaskRunMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    scheduledTask: {
      findMany: findManyMock,
    },
  },
}));

vi.mock("@/lib/command/service", () => ({
  createCommandRequest: createCommandRequestMock,
}));

vi.mock("./service", () => ({
  recordTaskRun: recordTaskRunMock,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: infoMock,
    warn: warnMock,
    error: errorMock,
  }),
}));

import { startScheduledTaskWorker, stopScheduledTaskWorkerForTests } from "./worker";

function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "task-1",
    name: "备份",
    command: "echo hi",
    reason: null,
    serverIds: ["srv-1"],
    createdById: "user-1",
    ...overrides,
  };
}

describe("scheduled task worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    findManyMock.mockResolvedValue([]);
    createCommandRequestMock.mockResolvedValue({ id: "cmd-1" });
    recordTaskRunMock.mockResolvedValue(undefined);
    stopScheduledTaskWorkerForTests();
  });

  it("starts once (idempotent) and ticks on startup and interval", async () => {
    await startScheduledTaskWorker();
    await startScheduledTaskWorker();
    await Promise.resolve();

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(findManyMock).toHaveBeenCalledTimes(1);

    await vi.runOnlyPendingTimersAsync();
    expect(findManyMock).toHaveBeenCalledTimes(2);
  });

  it("dispatches a command request and records the run for a due task", async () => {
    findManyMock.mockResolvedValueOnce([makeTask({ reason: "夜间备份" })]).mockResolvedValue([]);

    await startScheduledTaskWorker();
    await Promise.resolve();
    await Promise.resolve();

    expect(createCommandRequestMock).toHaveBeenCalledWith({
      title: "定时任务：备份",
      command: "echo hi",
      reason: "夜间备份",
      submissionMode: "user",
      requesterId: "user-1",
      serverIds: ["srv-1"],
    });
    expect(recordTaskRunMock).toHaveBeenCalledWith("task-1", "已触发命令请求 cmd-1");
  });

  it("skips tasks without target servers or creator, advancing nextRunAt", async () => {
    findManyMock
      .mockResolvedValueOnce([
        makeTask({ id: "no-srv", serverIds: [] }),
        makeTask({ id: "no-creator", createdById: null }),
      ])
      .mockResolvedValue([]);

    await startScheduledTaskWorker();
    await Promise.resolve();
    await Promise.resolve();

    expect(createCommandRequestMock).not.toHaveBeenCalled();
    expect(recordTaskRunMock).toHaveBeenCalledWith("no-srv", "跳过：无目标服务器或无创建者");
    expect(recordTaskRunMock).toHaveBeenCalledWith("no-creator", "跳过：无目标服务器或无创建者");
  });

  it("swallows per-task errors, records failure, and continues other tasks", async () => {
    findManyMock
      .mockResolvedValueOnce([makeTask({ id: "bad" }), makeTask({ id: "good" })])
      .mockResolvedValue([]);
    createCommandRequestMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ id: "cmd-good" });

    await expect(startScheduledTaskWorker()).resolves.toBeDefined();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(recordTaskRunMock).toHaveBeenCalledWith("bad", "执行失败：boom");
    expect(recordTaskRunMock).toHaveBeenCalledWith("good", "已触发命令请求 cmd-good");
    expect(errorMock).toHaveBeenCalled();
  });

  it("does not throw when the findMany query itself fails", async () => {
    findManyMock.mockRejectedValueOnce(new Error("db down")).mockResolvedValue([]);

    await expect(startScheduledTaskWorker()).resolves.toBeDefined();
    await Promise.resolve();
    await Promise.resolve();

    expect(errorMock).toHaveBeenCalled();
  });
});
