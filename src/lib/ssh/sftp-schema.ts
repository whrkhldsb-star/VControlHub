/**
 * Zod schemas for SFTP API request bodies.
 */

import { z } from "zod";

export const listDirSchema = z.object({
  path: z.string().min(1).max(4096),
});

export const mkdirSchema = z.object({
  path: z.string().min(1).max(4096),
});

export const renameSchema = z.object({
  oldPath: z.string().min(1).max(4096),
  newPath: z.string().min(1).max(4096),
});

export const downloadQuerySchema = z.object({
  path: z.string().min(1).max(4096),
});

export const deleteQuerySchema = z.object({
  path: z.string().min(1).max(4096),
});

export type ListDirInput = z.infer<typeof listDirSchema>;
export type MkdirInput = z.infer<typeof mkdirSchema>;
export type RenameInput = z.infer<typeof renameSchema>;
