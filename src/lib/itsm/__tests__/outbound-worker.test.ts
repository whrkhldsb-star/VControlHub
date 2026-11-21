import { beforeEach, describe, expect, it, vi } from "vitest";

const { jobMocks, deliveryMock } = vi.hoisted(() => ({
  jobMocks: {
    claimNextJob: vi.fn(),
    heartbeatJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
  },
  deliveryMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => jobMocks);
vi.mock("../service-outbound", () => ({ deliverQueuedEvent: deliveryMock }));

const { runItsmOutboundWorkerOnce, stopItsmOutboundWorkerForTests } =
  await import("../outbound-worker");

const validPayload = { eventId: "event-1" };

describe("ITSM outbound worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopItsmOutboundWorkerForTests();
    jobMocks.claimNextJob.mockResolvedValue({ id: "job-1", payload: validPayload });
    jobMocks.heartbeatJob.mockResolvedValue({ count: 1 });
    jobMocks.completeJob.mockResolvedValue({ count: 1 });
    jobMocks.failJob.mockResolvedValue({ count: 1 });
    deliveryMock.mockResolvedValue({ sent: 2, failed: 0 });
  });

  it("completes a durable job after all connections accept the event", async () => {
    await expect(runItsmOutboundWorkerOnce()).resolves.toBe(true);

    expect(deliveryMock).toHaveBeenCalledWith("event-1");
    expect(jobMocks.completeJob).toHaveBeenCalledWith(
      "job-1",
      expect.stringContaining(":itsm-outbound:"),
      { sent: 2, failed: 0 },
    );
    expect(jobMocks.failJob).not.toHaveBeenCalled();
  });

  it("retries when any connection fails and does not mark the job complete", async () => {
    deliveryMock.mockResolvedValue({ sent: 1, failed: 1 });

    await expect(runItsmOutboundWorkerOnce()).resolves.toBe(true);

    expect(jobMocks.failJob).toHaveBeenCalledWith(
      "job-1",
      expect.stringContaining(":itsm-outbound:"),
      "1 ITSM connection(s) failed; 1 delivered",
      { retryAfterMs: 30_000 },
    );
    expect(jobMocks.completeJob).not.toHaveBeenCalled();
  });

  it("records malformed payloads as failed attempts", async () => {
    jobMocks.claimNextJob.mockResolvedValue({ id: "job-2", payload: { ticketId: "ticket-1" } });

    await expect(runItsmOutboundWorkerOnce()).resolves.toBe(true);

    expect(deliveryMock).not.toHaveBeenCalled();
    expect(jobMocks.failJob).toHaveBeenCalledWith(
      "job-2",
      expect.stringContaining(":itsm-outbound:"),
      expect.stringContaining("Invalid ITSM outbound payload field"),
      { retryAfterMs: 30_000 },
    );
  });

  it("returns false when no outbound job is ready", async () => {
    jobMocks.claimNextJob.mockResolvedValue(null);
    await expect(runItsmOutboundWorkerOnce()).resolves.toBe(false);
    expect(deliveryMock).not.toHaveBeenCalled();
  });
});
