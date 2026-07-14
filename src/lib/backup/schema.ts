/**
 * Backup API request/response DTOs.
 *
 * Centralises the zod schemas that 3 backup route handlers
 * (`/api/backups`, `/api/backups/[id]/restore`, `/api/backups/[id]/void`)
 * and the `/backups` form action all use to validate user input. The
 * service layer (`@/lib/backup/service`) is unaffected — it still owns the
 * runtime/business side (record creation, command execution, restore flow).
 *
 * Why a single schema file:
 *  - Chinese error copy lives in one place instead of being scattered
 *    across route files.
 *  - The same `createBackupSchema` is reused by both the JSON API and the
 *    server action (the action builds a `{ type, note }` object from
 *    FormData and parses it with the same schema).
 *  - The TR-019 DTO boundary pattern mirrors `src/lib/ai/provider-http.ts`
 *    (R12) and `src/lib/storage/schema.ts` (existing): one focused module
 *    per slice, types + validation co-located, no caller-side duplication.
 *
 * Behavior contract: every consumer must see 1:1 identical validation
 * results (success/error) compared to the previous inline schemas. In
 * particular the server action must still return `"备份类型无效"` for
 * unknown types — this is enforced by the `{ message }` override on
 * `backupTypeSchema`.
 */

import { z } from "zod";

export const BACKUP_TYPE_VALUES = ["DATABASE", "FILES", "FULL"] as const;
export type BackupTypeValue = (typeof BACKUP_TYPE_VALUES)[number];

export const backupTypeSchema = z.enum(BACKUP_TYPE_VALUES, {
  message: "Invalid backup type",
});

const trimmedNote = z
  .string()
  .trim()
  .max(500, "Note must be at most 500 characters")
  .transform((value) => (value ? value : undefined))
  .optional();

export const createBackupSchema = z.object({
  type: backupTypeSchema,
  note: trimmedNote,
});

export type CreateBackupInput = z.input<typeof createBackupSchema>;
export type CreateBackupOutput = z.output<typeof createBackupSchema>;

export const restoreBackupSchema = z.object({
  confirm: z.enum(["RESTORE"], { message: "Restore confirmation text does not match" }),
  component: z.enum(["database", "files", "all"]).optional().default("all"),
});

export type RestoreBackupInput = z.input<typeof restoreBackupSchema>;
export type RestoreBackupOutput = z.output<typeof restoreBackupSchema>;

export const voidBackupSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1, "Void reason is required")
    .max(500, "Void reason must be at most 500 characters"),
});

export type VoidBackupInput = z.input<typeof voidBackupSchema>;
export type VoidBackupOutput = z.output<typeof voidBackupSchema>;

export const backupRetentionInputSchema = z.object({
  olderThanDays: z.number().int().positive().max(3650).optional(),
  keepLatestPerType: z.number().int().min(0).max(1000).optional(),
});

export type BackupRetentionInput = z.input<typeof backupRetentionInputSchema>;
export type BackupRetentionOutput = z.output<typeof backupRetentionInputSchema>;
