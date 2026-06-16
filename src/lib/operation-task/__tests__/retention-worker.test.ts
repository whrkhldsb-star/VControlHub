import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for operation-task-retention-worker — TR-006 跨来源保留策略 worker
 *
 * 覆盖：
 *   - 启动幂等 (idempotent)
 *   - 一次 tick: enqueue → claim → heartbeat → prune → complete 完整路径
 *   - 已有 PENDING/RUNNING job → skip enqueue
 *   - prune 抛错 → failJob + logger.error
 *   - 重入保护 (state.running)
 */

const {
  pruneHistoryMock,
  infoMock,
  warnMock,
  errorMock,
  jobMocks,
  jobIds,
} = vi.hoisted(() => ({
  pruneHistoryMock: vi.fn(),
  infoMock: vi.fn(),
  warnMock: vi.fn(),
  errorMock: vi.fn(),
  jobIds: { next: 1 },
  jobMocks: {
    findFirst: vi.fn(),
    enqueueJob: vi.fn(),
    claimNextJob: vi.fn(),
    heartbeatJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
  },
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: infoMock,
    warn: warnMock,
    error: errorMock,
    debug: vi.fn(),
  }),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    job: { findFirst: jobMocks.findFirst },
  },
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: jobMocks.enqueueJob,
  claimNextJob: jobMocks.claimNextJob,
  heartbeatJob: jobMocks.heartbeatJob,
  completeJob: jobMocks.completeJob,
  failJob: jobMocks.failJob,
}));

vi.mock("../retention", () => ({
  OPERATION_TASK_RETENTION_JOB_TYPE: "operation-task.retention",
  pruneOperationTaskHistory: pruneHistoryMock,
}));

const {
  runOperationTaskRetentionJobWorkerOnce,
  startOperationTaskRetentionWorker,
  stopOperationTaskRetentionWorkerForTests,
} = await import("../retention-worker");

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("operation task retention worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    jobIds.next = 1;
    pruneHistoryMock.mockResolvedValue({
      olderThan: "2026-03-17T00:00:00.000Z",
      keepLatest: 100,
      totalDeleted: 7,
      perSource: {
        command: { scanned: 100, deleted: 3 },
        download: { scanned: 50, deleted: 2 },
        sync: { scanned: 10, deleted: 1 },
        backup: { scanned: 5, deleted: 1 },
        deployment: { scanned: 0, deleted: 0 },
      },
      durationMs: 42,
    });
    jobMocks.findFirst.mockResolvedValue(null);
    jobMocks.enqueueJob.mockResolvedValue({ id: "enqueued-job" });
    jobMocks.claimNextJob.mockImplementation(async () => {
      const id = `job-${jobIds.next++}`;
      return { id, type: "operation-task.retention", payload: {}, status: "RUNNING" };
    });
    jobMocks.heartbeatJob.mockResolvedValue({ count: 1 });
    jobMocks.completeJob.mockResolvedValue({ count: 1 });
    jobMocks.failJob.mockResolvedValue({ count: 1 });
    stopOperationTaskRetentionWorkerForTests();
  });

  it("一次 tick: enqueue → claim → heartbeat → prune → complete 完整路径", async () => {
    const ran = await runOperationTaskRetentionJobWorkerOnce("test");

    expect(ran).toBe(true);
    expect(jobMocks.enqueueJob).toHaveBeenCalledWith(
      expect.objectContaining({ type: "operation-task.retention" }),
    );
    expect(jobMocks.claimNextJob).toHaveBeenCalledWith(
      expect.objectContaining({ types: ["operation-task.retention"] }),
    );
    expect(jobMocks.heartbeatJob).toHaveBeenCalledWith(
      "job-1",
      expect.stringContaining(":operation-task-retention:"),
      expect.objectContaining({ leaseMs: expect.any(Number), progress: "正在跨来源裁剪历史记录" }),
    );
    expect(pruneHistoryMock).toHaveBeenCalledTimes(1);
    expect(jobMocks.completeJob).toHaveBeenCalledWith(
      "job-1",
      expect.stringContaining(":operation-task-retention:"),
      expect.objectContaining({ totalDeleted: 7, perSource: expect.any(Object) }),
    );
  });

  it("prune 抛错 → failJob 走 retry, errorMock 触发, complete 不调", async () => {
    pruneHistoryMock.mockRejectedValueOnce(new Error("prune boom"));

    const ran = await runOperationTaskRetentionJobWorkerOnce("test");

    expect(ran).toBe(true);
    expect(jobMocks.failJob).toHaveBeenCalledWith(
      "job-1",
      expect.stringContaining(":operation-task-retention:"),
      "prune boom",
      expect.objectContaining({ retryAfterMs: expect.any(Number) }),
    );
    expect(errorMock).toHaveBeenCalledWith(
      "Operation task retention failed",
      expect.objectContaining({ jobId: "job-1", error: "prune boom" }),
    );
    expect(jobMocks.completeJob).not.toHaveBeenCalled();
  });

  it("无 pending job → 立即返 false, 不调 prune", async () => {
    jobMocks.claimNextJob.mockResolvedValueOnce(null);

    const ran = await runOperationTaskRetentionJobWorkerOnce("test");

    expect(ran).toBe(false);
    expect(pruneHistoryMock).not.toHaveBeenCalled();
  });

  it("已有 PENDING/RUNNING job → skip enqueue (不再叠加新 job)", async () => {
    // 注意: skip enqueue 意味着不创建新 job, 但 claimNextJob 仍可能拿到 (同 tick
    // 并发的旧 job)。本断言只验证 enqueueJob 没被调。
    jobMocks.findFirst.mockResolvedValueOnce({ id: "existing" });

    await runOperationTaskRetentionJobWorkerOnce("test");

    expect(jobMocks.enqueueJob).not.toHaveBeenCalled();
  });

  it("startOperationTaskRetentionWorker 幂等: 多次调 start 只触发一次 startup tick", async () => {
    await startOperationTaskRetentionWorker();
    await startOperationTaskRetentionWorker();
    await flushPromises();

    // startup tick 一次 (第 1 个 start 触发), 第 2 个 start 短路
    expect(infoMock).toHaveBeenCalledWith(
      "operation-task retention durable job worker started",
      expect.objectContaining({ workerId: expect.any(String) }),
    );
    expect(jobMocks.enqueueJob).toHaveBeenCalledTimes(1);
  });

  it("重入保护: 上一 tick 还在跑时第二次 tick 跳过 (warn + 立即返 false)", async () => {
    let release!: () => void;
    pruneHistoryMock.mockReturnValueOnce(
      new Promise<unknown>((resolve) => {
        release = () => resolve({ totalDeleted: 0, perSource: {} });
      }),
    );

    // 第一次 tick 还没 await 完时第二次 tick
    const first = runOperationTaskRetentionJobWorkerOnce("first");
    const second = await runOperationTaskRetentionJobWorkerOnce("second");

    expect(second).toBe(false);
    expect(warnMock).toHaveBeenCalledWith(
      "Skipping operation-task retention tick because a previous tick is still running",
      expect.objectContaining({ reason: "second" }),
    );

    release();
    await first;
  });

  it("stopOperationTaskRetentionWorkerForTests 重置状态 (允许下次 start 重新启动)", async () => {
    await startOperationTaskRetentionWorker();
    stopOperationTaskRetentionWorkerForTests();
    vi.clearAllMocks();

    // 重新 start, 应当能再起一次 (infoMock 应再次被调)
    await startOperationTaskRetentionWorker();
    await flushPromises();

    expect(infoMock).toHaveBeenCalledWith(
      "operation-task retention durable job worker started",
      expect.any(Object),
    );
  });
});
