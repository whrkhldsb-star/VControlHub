import { JobStatus, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  scheduledTaskFindManyMock,
  jobFindFirstMock,
  enqueueJobMock,
  claimNextJobMock,
  completeJobMock,
  failJobMock,
  heartbeatJobMock,
  createCommandRequestMock,
  recordTaskRunMock,
  infoMock,
  warnMock,
  errorMock,
} = vi.hoisted(() => ({
  scheduledTaskFindManyMock: vi.fn(),
  jobFindFirstMock: vi.fn(),
  enqueueJobMock: vi.fn(),
  claimNextJobMock: vi.fn(),
  completeJobMock: vi.fn(),
  failJobMock: vi.fn(),
  heartbeatJobMock: vi.fn(),
  createCommandRequestMock: vi.fn(),
  recordTaskRunMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    scheduledTask: {
      findMany: scheduledTaskFindManyMock,
    },
    job: {
      findFirst: jobFindFirstMock,
    },
  },
}));

vi.mock("@/lib/command/service", () => ({
  createCommandRequest: createCommandRequestMock,
}));

vi.mock("./service", () => ({
  recordTaskRun: recordTaskRunMock,
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: enqueueJobMock,
  claimNextJob: claimNextJobMock,
  completeJob: completeJobMock,
  failJob: failJobMock,
  heartbeatJob: heartbeatJobMock,
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

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "job-1",
    type: "scheduled-task.tick",
    payload: { reason: "test", requestedAt: new Date().toISOString() } as Prisma.JsonValue,
    ...overrides,
  };
}

describe("scheduled-task durable job worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    scheduledTaskFindManyMock.mockResolvedValue([]);
    jobFindFirstMock.mockResolvedValue(null);
    enqueueJobMock.mockResolvedValue({ id: "job-enqueued" });
    claimNextJobMock.mockResolvedValue(null);
    completeJobMock.mockResolvedValue({ count: 1 });
    failJobMock.mockResolvedValue({ count: 1 });
    heartbeatJobMock.mockResolvedValue({ count: 1 });
    createCommandRequestMock.mockResolvedValue({ id: "cmd-1" });
    recordTaskRunMock.mockResolvedValue(undefined);
    stopScheduledTaskWorkerForTests();
  });

  it("starts once (idempotent) and ticks on startup and interval", async () => {
    claimNextJobMock.mockResolvedValue(makeJob());

    await startScheduledTaskWorker();
    await startScheduledTaskWorker();
    // Allow the startup tick to flush
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(infoMock).toHaveBeenCalledTimes(1);
    // The fake-timer runOnlyPendingTimersAsync also fires the first 60_000ms interval tick.
    expect(claimNextJobMock).toHaveBeenCalledTimes(2);

    // One more interval tick
    await vi.advanceTimersByTimeAsync(60_000);
    await Promise.resolve();
    expect(claimNextJobMock.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("claims via the jobs table and completes with the dispatched count", async () => {
    claimNextJobMock.mockResolvedValueOnce(makeJob());
    scheduledTaskFindManyMock.mockResolvedValueOnce([makeTask({ reason: "夜间备份" })]);

    await startScheduledTaskWorker();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(claimNextJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        types: ["scheduled-task.tick"],
      }),
    );
    expect(createCommandRequestMock).toHaveBeenCalledWith({
      title: "定时任务：备份",
      command: "echo hi",
      reason: "夜间备份",
      submissionMode: "user",
      requesterId: "user-1",
      serverIds: ["srv-1"],
    });
    expect(recordTaskRunMock).toHaveBeenCalledWith("task-1", "已触发命令请求 cmd-1");
    expect(completeJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.stringContaining(":scheduled-task:"),
      { dispatched: 1 },
    );
  });

  it("skips the enqueue when an active scheduled-task tick job already exists", async () => {
    // Every tick sees an active job, so enqueue should never be called.
    jobFindFirstMock.mockResolvedValue({ id: "existing" });
    claimNextJobMock.mockResolvedValue(makeJob());

    await startScheduledTaskWorker();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(jobFindFirstMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          type: "scheduled-task.tick",
          status: { in: [JobStatus.PENDING, JobStatus.RUNNING] },
        }),
      }),
    );
    expect(enqueueJobMock).not.toHaveBeenCalled();
    expect(claimNextJobMock).toHaveBeenCalled();
  });

  it("dispatches nothing when the claim returns no job", async () => {
    claimNextJobMock.mockResolvedValue(null);

    await startScheduledTaskWorker();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();

    expect(scheduledTaskFindManyMock).not.toHaveBeenCalled();
    expect(completeJobMock).not.toHaveBeenCalled();
    expect(failJobMock).not.toHaveBeenCalled();
  });

  it("skips tasks without target servers or creator, advancing nextRunAt", async () => {
    claimNextJobMock.mockResolvedValueOnce(makeJob());
    scheduledTaskFindManyMock.mockResolvedValueOnce([
      makeTask({ id: "no-srv", serverIds: [] }),
      makeTask({ id: "no-creator", createdById: null }),
    ]);

    await startScheduledTaskWorker();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(createCommandRequestMock).not.toHaveBeenCalled();
    expect(recordTaskRunMock).toHaveBeenCalledWith("no-srv", "跳过：无目标服务器或无创建者");
    expect(recordTaskRunMock).toHaveBeenCalledWith("no-creator", "跳过：无目标服务器或无创建者");
    expect(completeJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.any(String),
      { dispatched: 2 },
    );
  });

  it("swallows per-task errors, records failure, and still completes the tick job", async () => {
    claimNextJobMock.mockResolvedValueOnce(makeJob());
    scheduledTaskFindManyMock.mockResolvedValueOnce([
      makeTask({ id: "bad" }),
      makeTask({ id: "good" }),
    ]);
    createCommandRequestMock
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValue({ id: "cmd-good" });

    await startScheduledTaskWorker();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(recordTaskRunMock).toHaveBeenCalledWith("bad", "执行失败：boom");
    expect(recordTaskRunMock).toHaveBeenCalledWith("good", "已触发命令请求 cmd-good");
    expect(completeJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.any(String),
      { dispatched: 2 },
    );
  });

  it("fails the durable job and surfaces the error when the dispatch query itself throws", async () => {
    claimNextJobMock.mockResolvedValueOnce(makeJob());
    scheduledTaskFindManyMock.mockRejectedValueOnce(new Error("db down"));

    await startScheduledTaskWorker();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(failJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.any(String),
      expect.stringContaining("db down"),
      expect.objectContaining({ retryAfterMs: 60_000 }),
    );
    expect(completeJobMock).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalled();
  });
});
