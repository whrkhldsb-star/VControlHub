import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, warnMock } = vi.hoisted(() => ({
  mockPrisma: {
    jobEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      groupBy: vi.fn(),
    },
  },
  warnMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: warnMock,
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { listJobEvents, pruneJobEvents, recordJobEvent } = await import("../events");

describe("job events service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.jobEvent.groupBy.mockResolvedValue([]);
  });

  it("returns null when input is missing required fields", async () => {
    const result = await recordJobEvent({ jobId: "", type: "claimed", message: "x" });
    expect(result).toBeNull();
    expect(mockPrisma.jobEvent.create).not.toHaveBeenCalled();
  });

  it("records a normalized event row with defaults", async () => {
    mockPrisma.jobEvent.create.mockResolvedValueOnce({
      id: "evt-1",
      jobId: "job-1",
      type: "claimed",
      level: "info",
      message: "后台执行器 worker-a 认领任务",
      workerId: "worker-a",
      payload: { type: "command.execution" },
      createdAt: new Date("2026-06-15T00:00:00Z"),
    });

    const result = await recordJobEvent({
      jobId: "job-1",
      type: "claimed",
      message: "后台执行器 worker-a 认领任务",
      workerId: "worker-a",
      payload: { type: "command.execution" },
    });

    expect(mockPrisma.jobEvent.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        jobId: "job-1",
        type: "claimed",
        level: "info",
        message: "后台执行器 worker-a 认领任务",
        workerId: "worker-a",
        payload: { type: "command.execution" },
      }),
    });
    expect(result?.id).toBe("evt-1");
  });

  it("truncates overlong messages to 2000 chars", async () => {
    mockPrisma.jobEvent.create.mockResolvedValueOnce({ id: "evt-2", jobId: "job-1", type: "failed", level: "error", message: "x", workerId: null, payload: null, createdAt: new Date() });
    const longMessage = "x".repeat(5000);
    await recordJobEvent({ jobId: "job-1", type: "failed", message: longMessage, level: "error" });
    const call = mockPrisma.jobEvent.create.mock.calls[0]?.[0] as { data: { message: string } };
    expect(call.data.message.length).toBe(2000);
  });

  it("swallows prisma errors and returns null (recording must not break the caller)", async () => {
    mockPrisma.jobEvent.create.mockRejectedValueOnce(new Error("db down"));
    const result = await recordJobEvent({ jobId: "job-1", type: "claimed", message: "x" });
    expect(result).toBeNull();
  });

  it("lists events newest-first with bounded limit", async () => {
    const createdAt = new Date("2026-06-15T00:00:00Z");
    mockPrisma.jobEvent.findMany.mockResolvedValueOnce([
      { id: "evt-1", jobId: "job-1", type: "claimed", level: "info", message: "m1", workerId: "w", payload: null, createdAt },
    ]);
    await listJobEvents({ jobId: "job-1", limit: 50 });
    expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith({
      where: { jobId: "job-1" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    });
  });

  it("clamps list limit to [1, 500]", async () => {
    mockPrisma.jobEvent.findMany.mockResolvedValueOnce([]);
    await listJobEvents({ jobId: "job-1", limit: 10_000 });
    expect(mockPrisma.jobEvent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 500 }));

    mockPrisma.jobEvent.findMany.mockResolvedValueOnce([]);
    await listJobEvents({ jobId: "job-1", limit: 0 });
    expect(mockPrisma.jobEvent.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ take: 1 }));
  });

  it("passes beforeId through as a cursor", async () => {
    mockPrisma.jobEvent.findMany.mockResolvedValueOnce([]);
    await listJobEvents({ jobId: "job-1", beforeId: "evt-50" });
    expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: { lt: "evt-50" } }),
    }));
  });

  it("applies keepLatest per job, so a chatty job cannot consume another job's budget", async () => {
    const olderThan = new Date("2026-06-01T00:00:00Z");
    mockPrisma.jobEvent.groupBy.mockResolvedValueOnce([
      { jobId: "job-chatty" },
      { jobId: "job-quiet" },
    ]);
    mockPrisma.jobEvent.findMany
      .mockResolvedValueOnce([{ id: "chatty-1" }, { id: "chatty-2" }])
      .mockResolvedValueOnce([{ id: "quiet-1" }]);
    mockPrisma.jobEvent.deleteMany
      .mockResolvedValueOnce({ count: 9 })
      .mockResolvedValueOnce({ count: 3 });

    const result = await pruneJobEvents({ keepLatest: 2, olderThan });

    // Only jobs holding prunable events are visited.
    expect(mockPrisma.jobEvent.groupBy).toHaveBeenCalledWith({
      by: ["jobId"],
      where: { createdAt: { lt: olderThan } },
    });
    // Each job gets the full keepLatest, scoped to its own stream.
    expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith({
      where: { jobId: "job-chatty" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      select: { id: true },
    });
    expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith({
      where: { jobId: "job-quiet" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      select: { id: true },
    });
    expect(mockPrisma.jobEvent.deleteMany).toHaveBeenCalledWith({
      where: {
        jobId: "job-quiet",
        id: { notIn: ["quiet-1"] },
        createdAt: { lt: olderThan },
      },
    });
    expect(result).toEqual({ count: 12 });
  });

  it("caps how many jobs one global sweep visits and warns instead of skipping silently", async () => {
    const groups = Array.from({ length: 501 }, (_, index) => ({ jobId: `job-${index}` }));
    mockPrisma.jobEvent.groupBy.mockResolvedValueOnce(groups);
    mockPrisma.jobEvent.findMany.mockResolvedValue([]);
    mockPrisma.jobEvent.deleteMany.mockResolvedValue({ count: 0 });

    await pruneJobEvents({ keepLatest: 10 });

    expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledTimes(500);
    expect(warnMock).toHaveBeenCalledWith(
      "job event prune scope cap reached; remaining jobs prune on the next run",
      { jobs: 501, cap: 500 },
    );
  });

  it("scopes prune to a single job when jobId is provided", async () => {
    mockPrisma.jobEvent.findMany.mockResolvedValueOnce([{ id: "keep-1" }]);
    mockPrisma.jobEvent.deleteMany.mockResolvedValueOnce({ count: 1 });
    await pruneJobEvents({ jobId: "job-1", keepLatest: 1 });
    // No grouping pass needed when the caller already named the job.
    expect(mockPrisma.jobEvent.groupBy).not.toHaveBeenCalled();
    expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "job-1" } }));
    expect(mockPrisma.jobEvent.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ jobId: "job-1", id: { notIn: ["keep-1"] } }),
    }));
  });
});
