import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    jobEvent: {
      create: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

const { listJobEvents, pruneJobEvents, recordJobEvent } = await import("../events");

describe("job events service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("prunes by keepLatest excluding the most recent ids", async () => {
    mockPrisma.jobEvent.findMany.mockResolvedValueOnce([{ id: "keep-1" }, { id: "keep-2" }]);
    mockPrisma.jobEvent.deleteMany.mockResolvedValueOnce({ count: 9 });
    const olderThan = new Date("2026-06-01T00:00:00Z");

    const result = await pruneJobEvents({ keepLatest: 2, olderThan });

    expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 2,
      select: { id: true },
    });
    expect(mockPrisma.jobEvent.deleteMany).toHaveBeenCalledWith({
      where: { id: { notIn: ["keep-1", "keep-2"] }, createdAt: { lt: olderThan } },
    });
    expect(result).toEqual({ count: 9 });
  });

  it("scopes prune to a single job when jobId is provided", async () => {
    mockPrisma.jobEvent.findMany.mockResolvedValueOnce([{ id: "keep-1" }]);
    mockPrisma.jobEvent.deleteMany.mockResolvedValueOnce({ count: 1 });
    await pruneJobEvents({ jobId: "job-1", keepLatest: 1 });
    expect(mockPrisma.jobEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { jobId: "job-1" } }));
    expect(mockPrisma.jobEvent.deleteMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ jobId: "job-1", id: { notIn: ["keep-1"] } }),
    }));
  });
});
