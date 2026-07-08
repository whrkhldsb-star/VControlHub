import { z } from "zod";

import { idQuerySchema } from "@/lib/http/parse-search-params";

/* ── 公告级别 (共享给 schema + service) ──────────────────────────────── */

export const ANNOUNCEMENT_LEVELS = ["info", "warning", "urgent"] as const;
export type AnnouncementLevel = (typeof ANNOUNCEMENT_LEVELS)[number];

/* ── GET /api/announcements ──────────────────────────────────────────── */
/* (list 端点当前无 query 参数,留作占位以备将来扩展) */

export const listAnnouncementsQuerySchema = z.object({}).optional();

/* ── POST /api/announcements ─────────────────────────────────────────── */

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be at most 120 characters"),
  content: z.string().trim().min(1, "Content is required").max(5_000, "Content must be at most 5000 characters"),
  type: z.enum(ANNOUNCEMENT_LEVELS, { message: "Invalid announcement type" }).optional(),
  pinned: z.boolean().optional(),
  published: z.boolean().optional(),
  startsAt: z
    .string()
    .datetime({ message: "startsAt must be an ISO datetime" })
    .optional(),
  expiresAt: z
    .string()
    .datetime({ message: "expiresAt must be an ISO datetime" })
    .nullable()
    .optional(),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

/* ── PATCH /api/announcements ────────────────────────────────────────── */

export const updateAnnouncementSchema = z
  .object({
    id: z.string().trim().min(1, "Announcement ID is required"),
    title: z.string().trim().min(1).max(120).optional(),
    content: z.string().trim().min(1).max(5_000).optional(),
    type: z.enum(ANNOUNCEMENT_LEVELS).optional(),
    pinned: z.boolean().optional(),
    published: z.boolean().optional(),
    expiresAt: z
      .union([
        z.string().datetime({ message: "expiresAt must be an ISO datetime" }),
        z.null(),
      ])
      .optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.content !== undefined ||
      data.type !== undefined ||
      data.pinned !== undefined ||
      data.published !== undefined ||
      data.expiresAt !== undefined,
    { message: "At least one update field must be provided", path: [] },
  );
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;

/* ── DELETE /api/announcements ───────────────────────────────────────── */

export const deleteAnnouncementQuerySchema = idQuerySchema;
export type DeleteAnnouncementQuery = z.infer<typeof deleteAnnouncementQuerySchema>;
