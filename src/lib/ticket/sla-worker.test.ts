import { beforeEach, describe, expect, it, vi } from "vitest";

const { escalateMock, loggerMocks, jobMocks } = vi.hoisted(() => ({
  escalateMock: vi.fn(),
  loggerMocks: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
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

vi.mock("./sla", () => ({ escalateBreachedTickets: escalateMock }));
vi.mock("@/lib/db", () => ({ prisma: { job: { findFirst: jobMocks.findFirst } } }));
vi.mock("@/lib/job/service", () => ({
  enqueueJob: jobMocks.enqueueJob,
  claimNextJob: jobMocks.claimNextJob,
  heartbeatJob: jobMocks.heartbeatJob,
  completeJob: jobMocks.completeJob,
  failJob: jobMocks.failJob,
  pruneCompletedJobsByType: jobMocks.pruneCompletedJobsByType,
}));
vi.mock("@/lib/logging", () => ({ createLogger: () => loggerMocks }));

import { runTicketSlaJobWorkerOnce, startTicketSlaWorker, stopTicketSlaWorkerForTests } from "./sla-worker";

describe("ticket SLA durable worker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    stopTicketSlaWorkerForTests();
    jobMocks.findFirst.mockResolvedValue(null);
    jobMocks.enqueueJob.mockResolvedValue({ id: "queued" });
    jobMocks.claimNextJob.mockResolvedValue({ id: "job-1", type: "ticket.sla-escalate", status: "RUNNING", payload: {} });
    jobMocks.heartbeatJob.mockResolvedValue({ count: 1 });
    jobMocks.completeJob.mockResolvedValue({ count: 1 });
    jobMocks.failJob.mockResolvedValue({ count: 1 });
    jobMocks.pruneCompletedJobsByType.mockResolvedValue({ count: 0 });
    escalateMock.mockResolvedValue(3);
  });

  it("enqueues, leases and completes one SLA sweep", async () => {
    await runTicketSlaJobWorkerOnce("test");

    expect(jobMocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "ticket.sla-escalate" }));
    expect(jobMocks.claimNextJob).toHaveBeenCalledWith(expect.objectContaining({ types: ["ticket.sla-escalate"], leaseMs: expect.any(Number) }));
    expect(jobMocks.heartbeatJob).toHaveBeenCalledWith("job-1", expect.stringContaining(":ticket-sla:"), expect.objectContaining({ leaseMs: expect.any(Number) }));
    expect(escalateMock).toHaveBeenCalledTimes(1);
    expect(jobMocks.completeJob).toHaveBeenCalledWith("job-1", expect.stringContaining(":ticket-sla:"), { escalated: 3 });
  });

  it("starts idempotently and schedules a sweep every minute", async () => {
    await startTicketSlaWorker();
    await startTicketSlaWorker();
    await vi.runAllTicks();

    expect(jobMocks.enqueueJob).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(jobMocks.enqueueJob).toHaveBeenCalledTimes(2);
  });

  it("fails the durable job and retries after a minute when escalation throws", async () => {
    escalateMock.mockRejectedValueOnce(new Error("database unavailable"));

    await runTicketSlaJobWorkerOnce("test");

    expect(jobMocks.failJob).toHaveBeenCalledWith("job-1", expect.stringContaining(":ticket-sla:"), "database unavailable", { retryAfterMs: 60_000 });
  });
});
