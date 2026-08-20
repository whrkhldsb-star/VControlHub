import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  vpsBackupSchedule: {
    create: vi.fn(),
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

const { createVpsBackupSchedule, deleteVpsBackupSchedule, updateVpsBackupSchedule } = await import(
  "../vps-backup-schedule-service"
);

describe("VPS backup schedule ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vpsBackupSchedule.findUnique.mockResolvedValue({
      backupType: "nginx-config",
      paths: [],
      cronExpression: "0 3 * * *",
      status: "ACTIVE",
    });
    prismaMock.vpsBackupSchedule.create.mockResolvedValue({ id: "schedule-created" });
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

  it("normalizes a new schedule name and custom paths before storing it", async () => {
    await createVpsBackupSchedule({
      serverId: "server-1",
      name: "  Nightly app backup  ",
      cronExpression: "0 3 * * *",
      backupType: "custom",
      paths: [" /srv/app ", "", "  /var/lib/app  "],
      note: "  important data  ",
    });

    expect(prismaMock.vpsBackupSchedule.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        name: "Nightly app backup",
        paths: ["/srv/app", "/var/lib/app"],
        note: "important data",
      }),
    });
  });

  it("rejects whitespace-only names and custom paths", async () => {
    await expect(createVpsBackupSchedule({
      serverId: "server-1",
      name: "   ",
      cronExpression: "0 3 * * *",
      backupType: "nginx-config",
    })).rejects.toThrow();

    await expect(createVpsBackupSchedule({
      serverId: "server-1",
      name: "Custom",
      cronExpression: "0 3 * * *",
      backupType: "custom",
      paths: ["  "],
    })).rejects.toThrow();
  });

  it("clears the next run while paused so a delayed worker cannot dispatch it", async () => {
    await updateVpsBackupSchedule("schedule-1", "server-1", { status: "PAUSED" });

    expect(prismaMock.vpsBackupSchedule.update).toHaveBeenCalledWith({
      where: { id: "schedule-1", serverId: "server-1" },
      data: { status: "PAUSED", nextRunAt: null },
    });
  });

  it("recomputes the next run when a paused schedule is resumed", async () => {
    prismaMock.vpsBackupSchedule.findUnique.mockResolvedValueOnce({
      backupType: "nginx-config",
      paths: [],
      cronExpression: "0 3 * * *",
      status: "PAUSED",
    });

    await updateVpsBackupSchedule("schedule-1", "server-1", { status: "ACTIVE" });

    expect(prismaMock.vpsBackupSchedule.update).toHaveBeenCalledWith({
      where: { id: "schedule-1", serverId: "server-1" },
      data: expect.objectContaining({
        status: "ACTIVE",
        nextRunAt: expect.any(Date),
      }),
    });
  });

  it("keeps a paused schedule unscheduled even when its cron is edited", async () => {
    prismaMock.vpsBackupSchedule.findUnique.mockResolvedValueOnce({
      backupType: "nginx-config",
      paths: [],
      cronExpression: "0 3 * * *",
      status: "PAUSED",
    });

    await updateVpsBackupSchedule("schedule-1", "server-1", {
      cronExpression: "0 4 * * *",
    });

    expect(prismaMock.vpsBackupSchedule.update).toHaveBeenCalledWith({
      where: { id: "schedule-1", serverId: "server-1" },
      data: { cronExpression: "0 4 * * *", nextRunAt: null },
    });
  });

  it("pins the parent server when deleting a schedule", async () => {
    await deleteVpsBackupSchedule("schedule-1", "server-1");

    expect(prismaMock.vpsBackupSchedule.delete).toHaveBeenCalledWith({
      where: { id: "schedule-1", serverId: "server-1" },
    });
  });
});
