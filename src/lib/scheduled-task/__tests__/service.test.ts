import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    scheduledTask: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));

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
});
