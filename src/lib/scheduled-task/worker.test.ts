import { JobStatus, Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  scheduledTaskFindManyMock,
  scheduledTaskUpdateManyMock,
  scheduledTaskUpdateMock,
  jobFindFirstMock,
  prismaTransactionMock,
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
  scheduledTaskUpdateManyMock: vi.fn(),
  scheduledTaskUpdateMock: vi.fn(),
  jobFindFirstMock: vi.fn(),
  prismaTransactionMock: vi.fn(),
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
      updateMany: scheduledTaskUpdateManyMock,
      update: scheduledTaskUpdateMock,
    },
    job: {
      findFirst: jobFindFirstMock,
    },
    $transaction: prismaTransactionMock,
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
    // New-B (2026-06-15): the dispatch CAS now pins the original
    // nextRunAt on its updateMany `where` clause, so every fixture that
    // dispatches must carry it.
    nextRunAt: new Date("2026-01-01T00:00:00Z"),
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
    scheduledTaskUpdateManyMock.mockResolvedValue({ count: 1 });
    scheduledTaskUpdateMock.mockResolvedValue({ id: "task-1" });
    jobFindFirstMock.mockResolvedValue(null);
    enqueueJobMock.mockResolvedValue({ id: "job-enqueued" });
    claimNextJobMock.mockResolvedValue(null);
    completeJobMock.mockResolvedValue({ count: 1 });
    failJobMock.mockResolvedValue({ count: 1 });
    heartbeatJobMock.mockResolvedValue({ count: 1 });
    createCommandRequestMock.mockResolvedValue({ id: "cmd-1" });
    recordTaskRunMock.mockResolvedValue(undefined);
    // New-B (2026-06-15): the tick enqueue now goes through prisma.$transaction.
    // Default behaviour: no active tick job in flight, so the inner
    // findFirst returns null and the enqueue goes through. The seam
    // invokes the callback directly with the regular prisma mock (no
    // separate transaction client) so the in-callback findFirst is
    // observable via jobFindFirstMock. Any error in the callback
    // re-throws so the surrounding serialisation-conflict guard in
    // enqueueScheduledTaskTickJob can decide whether to swallow.
    prismaTransactionMock.mockImplementation(
      async (callback: (tx: unknown) => Promise<unknown>) => {
        return callback({
          job: { findFirst: jobFindFirstMock },
          scheduledTask: {
            findMany: scheduledTaskFindManyMock,
            updateMany: scheduledTaskUpdateManyMock,
            update: scheduledTaskUpdateMock,
          },
        });
      },
    );
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
    // New-B (2026-06-15): both tasks short-circuited (no servers / no
    // creator) so they don't count as "dispatched" — only tasks that
    // actually went through createCommandRequest do.
    expect(completeJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.any(String),
      { dispatched: 0 },
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
    // New-B (2026-06-15): only the `good` task actually went through
    // createCommandRequest; `bad` failed and was caught by the per-task
    // try/catch, so it doesn't count toward `dispatched`.
    expect(completeJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.any(String),
      { dispatched: 1 },
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

  // New-B (2026-06-15): the dispatch path now races an updateMany CAS on
  // (id, nextRunAt) so two overlapping workers cannot both call
  // createCommandRequest for the same scheduled task. When the loser
  // observes count === 0 it must skip silently and log, not call
  // createCommandRequest.
  it("skips dispatch when the row-level CAS updateMany returns count 0 (another worker already claimed)", async () => {
    claimNextJobMock.mockResolvedValueOnce(makeJob());
    scheduledTaskFindManyMock.mockResolvedValueOnce([makeTask({ id: "raced" })]);
    scheduledTaskUpdateManyMock.mockResolvedValueOnce({ count: 0 });

    await startScheduledTaskWorker();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    expect(scheduledTaskUpdateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "raced",
          status: "ACTIVE",
          nextRunAt: new Date("2026-01-01T00:00:00Z"),
        }),
        data: expect.objectContaining({ nextRunAt: expect.any(Date) }),
      }),
    );
    expect(createCommandRequestMock).not.toHaveBeenCalled();
    expect(recordTaskRunMock).not.toHaveBeenCalledWith(
      "raced",
      expect.stringMatching(/^已触发命令请求/),
    );
    expect(infoMock).toHaveBeenCalledWith(
      expect.stringContaining("already claimed by another worker"),
      expect.objectContaining({ taskId: "raced" }),
    );
    // The tick job is still considered complete with dispatched: 0 because
    // the racing worker's claim counts as "not our dispatch".
    expect(completeJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.any(String),
      { dispatched: 0 },
    );
  });

  it("rolls back the CAS claim when createCommandRequest fails so the next tick can retry", async () => {
    claimNextJobMock.mockResolvedValueOnce(makeJob());
    scheduledTaskFindManyMock.mockResolvedValueOnce([makeTask({ id: "claim-rollback" })]);
    // First updateMany is the CAS claim (success). Second is the
    // rollback (also succeeds in the test seam).
    scheduledTaskUpdateManyMock.mockResolvedValueOnce({ count: 1 });
    scheduledTaskUpdateMock.mockResolvedValueOnce({ id: "claim-rollback" });
    createCommandRequestMock.mockRejectedValueOnce(new Error("downstream API 503"));

    await startScheduledTaskWorker();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(createCommandRequestMock).toHaveBeenCalledOnce();
    // The rollback `update` must restore the original nextRunAt so the
    // next tick (or operator retry) can pick the row up again.
    expect(scheduledTaskUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "claim-rollback" },
        data: expect.objectContaining({
          nextRunAt: new Date("2026-01-01T00:00:00Z"),
        }),
      }),
    );
    expect(recordTaskRunMock).toHaveBeenCalledWith(
      "claim-rollback",
      "执行失败：downstream API 503",
    );
    // Tick job still completes — per-task failures don't fail the whole
    // tick. The `dispatched` counter is the number of tasks that actually
    // went through createCommandRequest successfully; failed dispatches
    // are recorded via recordTaskRun("执行失败: ...") but don't count.
    expect(completeJobMock).toHaveBeenCalledWith(
      "job-1",
      expect.any(String),
      { dispatched: 0 },
    );
  });

  it("serialises the enqueueScheduledTaskTickJob existence check and enqueue under a Prisma transaction", async () => {
    // New-B (2026-06-15): every in-transaction findFirst sees an active
    // tick job, so both the startup tick and the first interval tick
    // short-circuit the enqueue to null. We assert the transaction was
    // used (not a bare findFirst + enqueue pair) and that the enqueue
    // was indeed bypassed.
    jobFindFirstMock.mockResolvedValue({ id: "active-forever" });
    claimNextJobMock.mockResolvedValue(makeJob());

    await startScheduledTaskWorker();
    await vi.runOnlyPendingTimersAsync();
    await Promise.resolve();
    await Promise.resolve();

    // The transaction should have been entered on the first tick.
    expect(prismaTransactionMock).toHaveBeenCalled();
    // Because every in-transaction findFirst returned an active job,
    // the enqueue short-circuited to null — i.e. enqueueJob was NEVER
    // called.
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });
});
