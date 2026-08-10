import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  vpsBackupSchedule: {
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("cron-parser", () => ({
  CronExpressionParser: {
    parse: vi.fn(() => ({ next: () => ({ toDate: () => new Date() }) })),
  },
}));

const { deleteVpsBackupSchedule, updateVpsBackupSchedule } = await import(
  "../vps-backup-schedule-service"
);

describe("VPS backup schedule ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vpsBackupSchedule.update.mockResolvedValue({ id: "schedule-1" });
    prismaMock.vpsBackupSchedule.delete.mockResolvedValue({ id: "schedule-1" });
  });

  it("pins the parent server when updating a schedule", async () => {
    await updateVpsBackupSchedule("schedule-1", "server-1", {
      name: "Nightly",
    });

    expect(prismaMock.vpsBackupSchedule.update).toHaveBeenCalledWith({
      where: { id: "schedule-1", serverId: "server-1" },
      data: { name: "Nightly" },
    });
  });

  it("pins the parent server when deleting a schedule", async () => {
    await deleteVpsBackupSchedule("schedule-1", "server-1");

    expect(prismaMock.vpsBackupSchedule.delete).toHaveBeenCalledWith({
      where: { id: "schedule-1", serverId: "server-1" },
    });
  });
});
