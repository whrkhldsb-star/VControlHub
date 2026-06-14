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
  title: z.string().trim().min(1, "标题不能为空").max(120, "标题最多 120 个字符"),
  content: z.string().trim().min(1, "内容不能为空").max(5_000, "内容最多 5000 个字符"),
  type: z.enum(ANNOUNCEMENT_LEVELS, { message: "公告类型无效" }).optional(),
  pinned: z.boolean().optional(),
  published: z.boolean().optional(),
  startsAt: z
    .string()
    .datetime({ message: "startsAt 必须是 ISO 时间" })
    .optional(),
  expiresAt: z
    .string()
    .datetime({ message: "expiresAt 必须是 ISO 时间" })
    .nullable()
    .optional(),
});
export type CreateAnnouncementInput = z.infer<typeof createAnnouncementSchema>;

/* ── PATCH /api/announcements ────────────────────────────────────────── */

export const updateAnnouncementSchema = z
  .object({
    id: z.string().trim().min(1, "缺少公告 ID"),
    title: z.string().trim().min(1).max(120).optional(),
    content: z.string().trim().min(1).max(5_000).optional(),
    type: z.enum(ANNOUNCEMENT_LEVELS).optional(),
    pinned: z.boolean().optional(),
    published: z.boolean().optional(),
    expiresAt: z
      .union([
        z.string().datetime({ message: "expiresAt 必须是 ISO 时间" }),
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
    { message: "至少提供一个更新字段", path: [] },
  );
export type UpdateAnnouncementInput = z.infer<typeof updateAnnouncementSchema>;

/* ── DELETE /api/announcements ───────────────────────────────────────── */

export const deleteAnnouncementQuerySchema = idQuerySchema;
export type DeleteAnnouncementQuery = z.infer<typeof deleteAnnouncementQuerySchema>;
