import { beforeEach, describe, expect, it, vi } from "vitest";

const { jobMocks, fanOutMock } = vi.hoisted(() => ({
  jobMocks: {
    claimNextJob: vi.fn(),
    heartbeatJob: vi.fn(),
    completeJob: vi.fn(),
    failJob: vi.fn(),
  },
  fanOutMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => jobMocks);
vi.mock("../service-outbound", () => ({ fanOutTicketEvent: fanOutMock }));

const { runItsmOutboundWorkerOnce, stopItsmOutboundWorkerForTests } =
  await import("../outbound-worker");

const validPayload = {
  ticketId: "ticket-1",
  eventType: "ticket.updated",
  title: "Database alert",
  description: "Connection saturation",
  status: "OPEN",
  priority: "HIGH",
  category: "database",
  teamId: "team-1",
};

describe("ITSM outbound worker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopItsmOutboundWorkerForTests();
    jobMocks.claimNextJob.mockResolvedValue({ id: "job-1", payload: validPayload });
    jobMocks.heartbeatJob.mockResolvedValue({ count: 1 });
    jobMocks.completeJob.mockResolvedValue({ count: 1 });
    jobMocks.failJob.mockResolvedValue({ count: 1 });
    fanOutMock.mockResolvedValue({ sent: 2, failed: 0 });
  });

  it("completes a durable job after all connections accept the event", async () => {
    await expect(runItsmOutboundWorkerOnce()).resolves.toBe(true);

    expect(fanOutMock).toHaveBeenCalledWith({
      ...validPayload,
      commentBody: undefined,
      deliveryKey: "job-1",
    });
    expect(jobMocks.completeJob).toHaveBeenCalledWith(
      "job-1",
      expect.stringContaining(":itsm-outbound:"),
      { sent: 2, failed: 0 },
    );
    expect(jobMocks.failJob).not.toHaveBeenCalled();
  });

  it("retries when any connection fails and does not mark the job complete", async () => {
    fanOutMock.mockResolvedValue({ sent: 1, failed: 1 });

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

    expect(fanOutMock).not.toHaveBeenCalled();
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
    expect(fanOutMock).not.toHaveBeenCalled();
  });
});
