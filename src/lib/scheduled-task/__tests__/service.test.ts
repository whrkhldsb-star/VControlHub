import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma, mockCreateCommandRequest } = vi.hoisted(() => ({
  mockPrisma: {
    scheduledTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
  mockCreateCommandRequest: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/command/service", () => ({ createCommandRequest: mockCreateCommandRequest }));

const service = await import("../service");

describe("scheduled task service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("stores scheduled task target server ids exactly once after trimming blanks", async () => {
    mockPrisma.scheduledTask.create.mockResolvedValue({ id: "task1" });

    await service.createScheduledTask({
      name: "Clean logs",
      cronExpression: "0 2 * * *",
      command: "df -h",
      serverIds: [" srv1 ", "srv1", "", "srv2"],
      createdById: "u1",
    });

    expect(mockPrisma.scheduledTask.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        serverIds: ["srv1", "srv2"],
      }),
    });
  });

  it("updates scheduled task target server ids exactly once after trimming blanks", async () => {
    mockPrisma.scheduledTask.update.mockResolvedValue({ id: "task1" });

    await service.updateScheduledTask("task1", {
      serverIds: ["srv1", " srv2 ", "srv1", ""],
    });

    expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
      where: { id: "task1" },
      data: { serverIds: ["srv1", "srv2"] },
    });
  });

  it("bounds scheduled task list hydration newest-first", async () => {
    mockPrisma.scheduledTask.findMany.mockResolvedValue([]);

    await service.listScheduledTasks();

    expect(mockPrisma.scheduledTask.findMany).toHaveBeenCalledWith({
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { creator: { select: { username: true, displayName: true } } },
    });
  });

  it("retries a scheduled task by creating a command request and recording the manual trigger", async () => {
    mockPrisma.scheduledTask.findUnique
      .mockResolvedValueOnce({
        id: "task1",
        name: "Clean logs",
        cronExpression: "0 2 * * *",
        command: "df -h",
        reason: "maintenance",
        serverIds: ["srv1"],
        createdById: "u1",
      })
      .mockResolvedValueOnce({ cronExpression: "0 2 * * *", runCount: 3 });
    mockCreateCommandRequest.mockResolvedValue({ id: "cmd1" });
    mockPrisma.scheduledTask.update.mockResolvedValue({ id: "task1", runCount: 4 });
    mockPrisma.scheduledTask.findUniqueOrThrow.mockResolvedValue({ id: "task1", lastResult: "Manual retry has triggered command request cmd1" });

    const result = await service.retryScheduledTask("task1");

    expect(mockCreateCommandRequest).toHaveBeenCalledWith({
      title: "Scheduled task retry: Clean logs",
      command: "df -h",
      reason: "maintenance",
      submissionMode: "user",
      requesterId: "u1",
      serverIds: ["srv1"],
    });
    expect(mockPrisma.scheduledTask.update).toHaveBeenCalledWith({
      where: { id: "task1" },
      data: expect.objectContaining({
        lastResult: "Manual retry has triggered command request cmd1",
        runCount: 4,
      }),
    });
    expect(result).toEqual({ id: "task1", lastResult: "Manual retry has triggered command request cmd1" });
  });
});
