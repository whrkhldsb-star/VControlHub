import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  vpsBackupSchedule: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    delete: vi.fn(),
  },
  vpsBackupRecord: {
    count: vi.fn(),
    updateMany: vi.fn(),
  },
}));

const { enqueueJobMock, createVpsBackupRecordMock, pruneOldVpsBackupRecordsMock } = vi.hoisted(() => ({
  enqueueJobMock: vi.fn(),
  createVpsBackupRecordMock: vi.fn(),
  pruneOldVpsBackupRecordsMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

vi.mock("@/lib/job/service", () => ({ enqueueJob: enqueueJobMock }));

vi.mock("../vps-backup-service", () => ({
  createVpsBackupRecord: createVpsBackupRecordMock,
  pruneOldVpsBackupRecords: pruneOldVpsBackupRecordsMock,
  VPS_BACKUP_CREATE_JOB_TYPE: "vps-backup.create",
}));

vi.mock("cron-parser", () => ({
  CronExpressionParser: {
    parse: vi.fn(() => ({ next: () => ({ toDate: () => new Date() }) })),
  },
}));

const {
  createVpsBackupSchedule,
  deleteVpsBackupSchedule,
  updateVpsBackupSchedule,
  dispatchDueVpsBackupSchedules,
} = await import("../vps-backup-schedule-service");

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

  it("rejects out-of-range retentionDays (defense-in-depth beyond the route zod)", async () => {
    await expect(createVpsBackupSchedule({
      serverId: "server-1",
      name: "Nightly",
      cronExpression: "0 3 * * *",
      backupType: "nginx-config",
      retentionDays: 0,
    })).rejects.toThrow();

    await expect(createVpsBackupSchedule({
      serverId: "server-1",
      name: "Nightly",
      cronExpression: "0 3 * * *",
      backupType: "nginx-config",
      retentionDays: 9999,
    })).rejects.toThrow();

    await expect(
      updateVpsBackupSchedule("schedule-1", "server-1", { retentionDays: 9999 }),
    ).rejects.toThrow();
  });

  it("accepts retentionDays within range and null (keep forever)", async () => {
    await createVpsBackupSchedule({
      serverId: "server-1",
      name: "Nightly",
      cronExpression: "0 3 * * *",
      backupType: "nginx-config",
      retentionDays: 30,
    });
    expect(prismaMock.vpsBackupSchedule.create).toHaveBeenCalled();

    await updateVpsBackupSchedule("schedule-1", "server-1", { retentionDays: null });
    expect(prismaMock.vpsBackupSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ retentionDays: null }) }),
    );
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

describe("dispatchDueVpsBackupSchedules overlap guard", () => {
  const dueSchedule = {
    id: "schedule-1",
    serverId: "server-1",
    name: "Nightly",
    backupType: "nginx-config",
    cronExpression: "0 3 * * *",
    retentionDays: null,
    nextRunAt: new Date("2020-01-01T00:00:00Z"),
    server: { id: "server-1", teamId: "team-1", name: "web" },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.vpsBackupSchedule.findMany.mockResolvedValue([dueSchedule]);
    prismaMock.vpsBackupSchedule.updateMany.mockResolvedValue({ count: 1 }); // CAS claim wins
    prismaMock.vpsBackupSchedule.update.mockResolvedValue({ id: "schedule-1" });
    createVpsBackupRecordMock.mockResolvedValue({ id: "record-1" });
    enqueueJobMock.mockResolvedValue(undefined);
  });

  it("skips dispatch and marks SKIPPED_OVERLAP when a prior run is still in flight", async () => {
    prismaMock.vpsBackupRecord.count.mockResolvedValue(1); // previous run still PENDING/RUNNING

    const dispatched = await dispatchDueVpsBackupSchedules();

    expect(dispatched).toBe(0);
    expect(createVpsBackupRecordMock).not.toHaveBeenCalled();
    expect(enqueueJobMock).not.toHaveBeenCalled();
    expect(prismaMock.vpsBackupSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "schedule-1" },
        data: expect.objectContaining({ lastResult: "SKIPPED_OVERLAP" }),
      }),
    );
  });

  it("dispatches normally when no prior run is in flight", async () => {
    prismaMock.vpsBackupRecord.count.mockResolvedValue(0);

    const dispatched = await dispatchDueVpsBackupSchedules();

    expect(dispatched).toBe(1);
    expect(createVpsBackupRecordMock).toHaveBeenCalledTimes(1);
    expect(enqueueJobMock).toHaveBeenCalledTimes(1);
  });
});
