/**
 * Zod schemas for the backup-schedule API (TR-038).
 *
 * Mirrors the validation in `schedule-service.ts` but as declarative zod
 * schemas so `withApiRoute({ bodySchema })` can surface field-level errors
 * without the route handler repeating validation logic.
 */
import { z } from "zod";

export const backupTypeSchema = z.enum(["DATABASE", "FILES", "FULL"]);

export const createBackupScheduleSchema = z.object({
  name: z.string().trim().min(1, "计划名称不能为空").max(100, "计划名称过长"),
  cronExpression: z.string().trim().min(1, "cron 表达式不能为空"),
  backupType: backupTypeSchema,
  note: z.string().trim().max(500, "备注过长").optional(),
  retentionDays: z.number().int().min(1).max(3650, "保留天数必须在 1-3650 之间").nullable().optional(),
});

export const updateBackupScheduleSchema = createBackupScheduleSchema
  .partial()
  .extend({
    id: z.string().trim().min(1),
    status: z.enum(["ACTIVE", "PAUSED", "DISABLED"]).optional(),
  });

export const toggleBackupScheduleSchema = z.object({
  toggleId: z.string().trim().min(1),
});

export const patchBackupScheduleSchema = z.union([
  toggleBackupScheduleSchema,
  updateBackupScheduleSchema,
]);
