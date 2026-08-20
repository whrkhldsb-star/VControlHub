import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    jobFindFirst: vi.fn(),
    tryAcquireAdvisoryLock: vi.fn(),
    releaseLock: vi.fn(),
    enqueueJob: vi.fn(),
    claimNextJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
    heartbeatJob: vi.fn(),
    pruneCompletedJobsByType: vi.fn(),
    initializeUnscheduledCronPlaybooks: vi.fn(),
    dispatchDueCronPlaybooks: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: { job: { findFirst: mocks.jobFindFirst } } }));
vi.mock("@/lib/config/env", () => ({ config: { app: { hostname: "test-host" } } }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ tryAcquireAdvisoryLock: mocks.tryAcquireAdvisoryLock }));
vi.mock("@/lib/job/lease", () => ({ computeLeaseMs: () => 300_000 }));
vi.mock("@/lib/job/service", () => ({
  claimNextJob: mocks.claimNextJob,
  completeJob: mocks.completeJob,
  enqueueJob: mocks.enqueueJob,
  failJob: mocks.failJob,
  heartbeatJob: mocks.heartbeatJob,
  pruneCompletedJobsByType: mocks.pruneCompletedJobsByType,
}));
vi.mock("@/lib/job/heartbeat-runner", () => ({
  runWithLeaseHeartbeat: vi.fn(async ({ run }: { run: () => Promise<unknown> }) => run()),
}));
vi.mock("@/lib/logging", () => ({ createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }) }));
vi.mock("../trigger-service", () => ({
  initializeUnscheduledCronPlaybooks: mocks.initializeUnscheduledCronPlaybooks,
  dispatchDueCronPlaybooks: mocks.dispatchDueCronPlaybooks,
}));

import {
  PLAYBOOK_TRIGGER_TICK_JOB_TYPE,
  runPlaybookTriggerTickJobWorkerOnce,
  stopPlaybookTriggerWorkerForTests,
} from "../trigger-worker";

describe("Playbook Cron trigger worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopPlaybookTriggerWorkerForTests();
    mocks.releaseLock.mockResolvedValue(undefined);
    mocks.tryAcquireAdvisoryLock.mockResolvedValue(mocks.releaseLock);
    mocks.jobFindFirst.mockResolvedValue(null);
    mocks.enqueueJob.mockResolvedValue({ id: "enqueue-1" });
    mocks.claimNextJob.mockResolvedValue({ id: "tick-1" });
    mocks.heartbeatJob.mockResolvedValue({ count: 1 });
    mocks.initializeUnscheduledCronPlaybooks.mockResolvedValue(2);
    mocks.dispatchDueCronPlaybooks.mockResolvedValue({ dispatched: 1, advanced: 1 });
    mocks.completeJob.mockResolvedValue(undefined);
    mocks.failJob.mockResolvedValue(undefined);
    mocks.pruneCompletedJobsByType.mockResolvedValue({ count: 0 });
  });

  afterEach(() => stopPlaybookTriggerWorkerForTests());

  it("enqueues, claims and completes a durable Cron dispatch tick", async () => {
    await expect(runPlaybookTriggerTickJobWorkerOnce("test")).resolves.toBe(true);

    expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
      type: PLAYBOOK_TRIGGER_TICK_JOB_TYPE,
      priority: -5,
    }));
    expect(mocks.claimNextJob).toHaveBeenCalledWith(expect.objectContaining({
      types: [PLAYBOOK_TRIGGER_TICK_JOB_TYPE],
    }));
    expect(mocks.completeJob).toHaveBeenCalledWith(
      "tick-1",
      expect.stringContaining(":playbook-trigger:"),
      { initialized: 2, dispatched: 1, advanced: 1 },
    );
  });

  it("marks the tick retryable when scheduling fails", async () => {
    mocks.dispatchDueCronPlaybooks.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(runPlaybookTriggerTickJobWorkerOnce("test")).resolves.toBe(true);

    expect(mocks.failJob).toHaveBeenCalledWith(
      "tick-1",
      expect.stringContaining(":playbook-trigger:"),
      "database unavailable",
      { retryAfterMs: 60_000 },
    );
  });
});
