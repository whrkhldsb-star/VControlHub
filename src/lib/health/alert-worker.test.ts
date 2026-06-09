import { beforeEach, describe, expect, it, vi } from "vitest";

const { evaluateAlertsMock, infoMock, warnMock, errorMock, jobMocks, jobIds } = vi.hoisted(() => ({
  evaluateAlertsMock: vi.fn(),
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
    pruneCompletedJobsByType: vi.fn(),
  },
}));

vi.mock("./service", () => ({
  evaluateAlerts: evaluateAlertsMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    job: {
      findFirst: jobMocks.findFirst,
    },
  },
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: jobMocks.enqueueJob,
  claimNextJob: jobMocks.claimNextJob,
  heartbeatJob: jobMocks.heartbeatJob,
  completeJob: jobMocks.completeJob,
  failJob: jobMocks.failJob,
  pruneCompletedJobsByType: jobMocks.pruneCompletedJobsByType,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: infoMock,
    warn: warnMock,
    error: errorMock,
  }),
}));

import { runAlertEvaluationJobWorkerOnce, startAlertEvaluationWorker, stopAlertEvaluationWorkerForTests } from "./alert-worker";

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("alert evaluation worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    jobIds.next = 1;
    evaluateAlertsMock.mockResolvedValue({ evaluated: true });
    jobMocks.findFirst.mockResolvedValue(null);
    jobMocks.enqueueJob.mockResolvedValue({ id: "enqueued-job" });
    jobMocks.claimNextJob.mockImplementation(async () => {
      const id = `job-${jobIds.next++}`;
      return { id, type: "alert.evaluate", payload: {}, status: "RUNNING" };
    });
    jobMocks.heartbeatJob.mockResolvedValue({ count: 1 });
    jobMocks.completeJob.mockResolvedValue({ count: 1 });
    jobMocks.failJob.mockResolvedValue({ count: 1 });
    jobMocks.pruneCompletedJobsByType.mockResolvedValue({ count: 0 });
    stopAlertEvaluationWorkerForTests();
  });

  it("starts once (idempotent), enqueues durable jobs, and evaluates alerts on startup and interval", async () => {
    await startAlertEvaluationWorker();
    await startAlertEvaluationWorker();
    await flushPromises();

    expect(infoMock).toHaveBeenCalledTimes(1);
    expect(jobMocks.enqueueJob).toHaveBeenCalledTimes(1);
    expect(jobMocks.claimNextJob).toHaveBeenCalledWith(expect.objectContaining({ types: ["alert.evaluate"] }));
    expect(evaluateAlertsMock).toHaveBeenCalledTimes(1);
    expect(jobMocks.completeJob).toHaveBeenCalledWith("job-1", expect.stringContaining(":alert:"), { evaluated: true });
    expect(jobMocks.pruneCompletedJobsByType).toHaveBeenCalledWith(expect.objectContaining({ type: "alert.evaluate", keepLatest: 25, olderThan: expect.any(Date) }));

    await vi.runOnlyPendingTimersAsync();
    expect(jobMocks.enqueueJob).toHaveBeenCalledTimes(2);
    expect(evaluateAlertsMock).toHaveBeenCalledTimes(2);
  });

  it("marks durable evaluation jobs failed without throwing", async () => {
    evaluateAlertsMock.mockRejectedValueOnce(new Error("eval boom")).mockResolvedValue({ evaluated: true });

    await expect(startAlertEvaluationWorker()).resolves.toBeDefined();
    await flushPromises();

    expect(jobMocks.failJob).toHaveBeenCalledWith("job-1", expect.stringContaining(":alert:"), "eval boom", { retryAfterMs: 60_000 });
    expect(errorMock).toHaveBeenCalledWith("Alert evaluation failed", expect.objectContaining({ jobId: "job-1", error: "eval boom" }));
  });

  it("keeps alert evaluation successful when completed-job pruning fails", async () => {
    jobMocks.pruneCompletedJobsByType.mockRejectedValueOnce(new Error("prune boom"));

    await runAlertEvaluationJobWorkerOnce("manual-test");

    expect(jobMocks.completeJob).toHaveBeenCalledWith("job-1", expect.stringContaining(":alert:"), { evaluated: true });
    expect(warnMock).toHaveBeenCalledWith("Failed to prune completed alert evaluation jobs", { error: "prune boom" });
    expect(errorMock).not.toHaveBeenCalled();
  });

  it("skips overlapping ticks while a previous evaluation is still running", async () => {
    let release!: () => void;
    evaluateAlertsMock.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = () => resolve();
      }),
    );

    await startAlertEvaluationWorker();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(evaluateAlertsMock).toHaveBeenCalledTimes(1);
    expect(jobMocks.enqueueJob).toHaveBeenCalledTimes(1);
    expect(warnMock).toHaveBeenCalledWith(
      "Skipping alert evaluation tick because a previous tick is still running",
      { reason: "interval" },
    );

    release();
    await vi.runOnlyPendingTimersAsync();
  });

  it("does not enqueue duplicate alert jobs while a pending/running one exists", async () => {
    jobMocks.findFirst.mockResolvedValueOnce({ id: "existing-job" });
    jobMocks.claimNextJob.mockResolvedValueOnce(null);

    await startAlertEvaluationWorker();
    await flushPromises();

    expect(jobMocks.enqueueJob).not.toHaveBeenCalled();
    expect(evaluateAlertsMock).not.toHaveBeenCalled();
  });
});
