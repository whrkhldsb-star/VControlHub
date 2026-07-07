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
  name: z.string().trim().min(1, "Schedule name is required").max(100, "Schedule name is too long"),
  cronExpression: z.string().trim().min(1, "Cron expression is required"),
  backupType: backupTypeSchema,
  note: z.string().trim().max(500, "Note is too long").optional(),
  retentionDays: z.number().int().min(1).max(3650, "Retention days must be between 1 and 3650").nullable().optional(),
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
