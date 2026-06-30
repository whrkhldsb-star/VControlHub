import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  backupScheduleCreateMock,
  backupScheduleFindManyMock,
  backupScheduleFindUniqueMock,
  backupScheduleUpdateMock,
  backupScheduleUpdateManyMock,
  backupScheduleDeleteMock,
  createBackupRecordMock,
  enqueueJobMock,
} = vi.hoisted(() => ({
  backupScheduleCreateMock: vi.fn(),
  backupScheduleFindManyMock: vi.fn(),
  backupScheduleFindUniqueMock: vi.fn(),
  backupScheduleUpdateMock: vi.fn(),
  backupScheduleUpdateManyMock: vi.fn(),
  backupScheduleDeleteMock: vi.fn(),
  createBackupRecordMock: vi.fn(),
  enqueueJobMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  prisma: {
    backupSchedule: {
      create: backupScheduleCreateMock,
      findMany: backupScheduleFindManyMock,
      findUnique: backupScheduleFindUniqueMock,
      update: backupScheduleUpdateMock,
      updateMany: backupScheduleUpdateManyMock,
      delete: backupScheduleDeleteMock,
    },
  },
}));

vi.mock("@/lib/scheduled-task/service", () => ({
  computeNextRun: vi.fn((expr: string) => {
    // Simple stub: return 1 hour from now for valid expressions.
    if (!expr || expr.trim().length === 0) throw new Error("empty cron");
    return new Date(Date.now() + 60 * 60 * 1000);
  }),
  describeCron: vi.fn(() => "每天 03:00"),
}));

// Mock cron-parser so validateCronExpression surfaces real errors.
vi.mock("cron-parser", () => ({
  CronExpressionParser: {
    parse: vi.fn((expr: string) => {
      if (expr === "invalid") throw new Error("invalid cron");
      return { next: () => ({ toDate: () => new Date() }) };
    }),
  },
}));

vi.mock("@/lib/backup/service-crud", () => ({
  createBackupRecord: createBackupRecordMock,
}));

vi.mock("@/lib/backup/job-worker", () => ({
  BACKUP_CREATE_JOB_TYPE: "backup.create",
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: enqueueJobMock,
}));

vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

import {
  createBackupSchedule,
  validateCronExpression,
  validateBackupType,
  validateRetentionDays,
  toggleBackupSchedule,
  deleteBackupSchedule,
  dispatchDueSchedule,
} from "../schedule-service";
import { ValidationError, NotFoundError } from "@/lib/errors";

describe("backup schedule service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    backupScheduleCreateMock.mockResolvedValue({ id: "s1" });
    backupScheduleFindUniqueMock.mockResolvedValue({
      id: "s1",
      status: "ACTIVE",
      cronExpression: "0 3 * * *",
      runCount: 0,
    });
    backupScheduleUpdateMock.mockResolvedValue({ id: "s1" });
    backupScheduleDeleteMock.mockResolvedValue({});
    createBackupRecordMock.mockResolvedValue({ id: "b1" });
    enqueueJobMock.mockResolvedValue({ id: "j1" });
  });

  describe("validateCronExpression", () => {
    it("accepts a valid 5-field cron expression", () => {
      expect(validateCronExpression("0 3 * * *")).toBe("0 3 * * *");
    });
    it("rejects an empty expression", () => {
      expect(() => validateCronExpression("  ")).toThrow(ValidationError);
    });
    it("rejects an invalid expression", () => {
      expect(() => validateCronExpression("invalid")).toThrow(ValidationError);
    });
  });

  describe("validateBackupType", () => {
    it("accepts DATABASE / FILES / FULL", () => {
      expect(validateBackupType("DATABASE")).toBe("DATABASE");
      expect(validateBackupType("FILES")).toBe("FILES");
      expect(validateBackupType("FULL")).toBe("FULL");
    });
    it("rejects unknown types", () => {
      expect(() => validateBackupType("WAL")).toThrow(ValidationError);
    });
  });

  describe("validateRetentionDays", () => {
    it("returns null for null/undefined", () => {
      expect(validateRetentionDays(null)).toBeNull();
      expect(validateRetentionDays(undefined)).toBeNull();
    });
    it("returns a floored integer for valid input", () => {
      expect(validateRetentionDays(30)).toBe(30);
    });
    it("rejects non-positive or non-finite values", () => {
      expect(() => validateRetentionDays(0)).toThrow(ValidationError);
      expect(() => validateRetentionDays(-1)).toThrow(ValidationError);
      expect(() => validateRetentionDays(Number.NaN)).toThrow(ValidationError);
    });
    it("rejects values over 3650", () => {
      expect(() => validateRetentionDays(3651)).toThrow(ValidationError);
    });
  });

  describe("createBackupSchedule", () => {
    it("creates a schedule with validated fields and computes nextRunAt", async () => {
      await createBackupSchedule({
        name: "Nightly DB",
        cronExpression: "0 3 * * *",
        backupType: "DATABASE",
        createdById: "u1",
      });
      expect(backupScheduleCreateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            name: "Nightly DB",
            cronExpression: "0 3 * * *",
            backupType: "DATABASE",
            nextRunAt: expect.any(Date),
          }),
        }),
      );
    });
    it("rejects an empty name", async () => {
      await expect(
        createBackupSchedule({
          name: "  ",
          cronExpression: "0 3 * * *",
          backupType: "DATABASE",
        }),
      ).rejects.toThrow(ValidationError);
    });
    it("rejects an invalid cron expression", async () => {
      await expect(
        createBackupSchedule({
          name: "Bad cron",
          cronExpression: "invalid",
          backupType: "DATABASE",
        }),
      ).rejects.toThrow(ValidationError);
    });
  });

  describe("toggleBackupSchedule", () => {
    it("flips ACTIVE → PAUSED and clears nextRunAt", async () => {
      await toggleBackupSchedule("s1");
      // The toggle path goes through updateBackupSchedule → prisma.update
      expect(backupScheduleUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "s1" },
          data: expect.objectContaining({ status: "PAUSED", nextRunAt: null }),
        }),
      );
    });
    it("flips PAUSED → ACTIVE and recomputes nextRunAt", async () => {
      // toggleBackupSchedule calls findUnique once; updateBackupSchedule
      // calls findUnique again to verify existing state. Both must return
      // PAUSED so the recompute-nextRunAt branch triggers.
      backupScheduleFindUniqueMock
        .mockResolvedValueOnce({
          id: "s1",
          status: "PAUSED",
          cronExpression: "0 3 * * *",
          runCount: 0,
        })
        .mockResolvedValueOnce({
          id: "s1",
          status: "PAUSED",
          cronExpression: "0 3 * * *",
          runCount: 0,
        });
      await toggleBackupSchedule("s1");
      expect(backupScheduleUpdateMock).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "s1" },
          data: expect.objectContaining({ status: "ACTIVE", nextRunAt: expect.any(Date) }),
        }),
      );
    });
    it("throws NotFoundError when schedule does not exist", async () => {
      backupScheduleFindUniqueMock.mockResolvedValueOnce(null);
      await expect(toggleBackupSchedule("missing")).rejects.toThrow(NotFoundError);
    });
  });

  describe("deleteBackupSchedule", () => {
    it("deletes an existing schedule", async () => {
      const result = await deleteBackupSchedule("s1");
      expect(result).toEqual({ id: "s1" });
      expect(backupScheduleDeleteMock).toHaveBeenCalledWith({ where: { id: "s1" } });
    });
    it("throws NotFoundError when schedule does not exist", async () => {
      backupScheduleFindUniqueMock.mockResolvedValueOnce(null);
      await expect(deleteBackupSchedule("missing")).rejects.toThrow(NotFoundError);
    });
  });

  describe("dispatchDueSchedule", () => {
    it("creates a BackupRecord + enqueues a backup.create job", async () => {
      const result = await dispatchDueSchedule({
        id: "s1",
        name: "Nightly DB",
        backupType: "DATABASE",
        note: null,
        retentionDays: null,
        createdById: "u1",
        nextRunAt: new Date(),
      });
      expect(result).toEqual({
        scheduleId: "s1",
        backupRecordId: "b1",
        jobId: "j1",
      });
      expect(createBackupRecordMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "DATABASE",
          createdBy: "u1",
          note: expect.stringContaining("Nightly DB"),
        }),
      );
      expect(enqueueJobMock).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "backup.create",
          createdBy: "u1",
        }),
      );
    });
    it("returns null and records skip when createdById is null", async () => {
      const result = await dispatchDueSchedule({
        id: "s1",
        name: "Orphan",
        backupType: "DATABASE",
        note: null,
        retentionDays: null,
        createdById: null,
        nextRunAt: new Date(),
      });
      expect(result).toBeNull();
    });
    it("returns null and records skip when backupType is invalid", async () => {
      const result = await dispatchDueSchedule({
        id: "s1",
        name: "Bad type",
        backupType: "WAL",
        note: null,
        retentionDays: null,
        createdById: "u1",
        nextRunAt: new Date(),
      });
      expect(result).toBeNull();
    });
  });
});
