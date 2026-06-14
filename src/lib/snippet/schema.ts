import { z } from "zod";

import { idQuerySchema } from "@/lib/http/parse-search-params";

/* ── GET /api/snippets ────────────────────────────────────────────────── */

export const listSnippetsQuerySchema = z.object({
  q: z.string().trim().min(1).optional(),
  language: z.string().trim().min(1).optional(),
});
export type ListSnippetsQuery = z.infer<typeof listSnippetsQuerySchema>;

/* ── POST /api/snippets ───────────────────────────────────────────────── */

export const createSnippetSchema = z.object({
  title: z.string().trim().min(1, "标题不能为空").max(120, "标题最多 120 个字符"),
  content: z.string().min(1, "内容不能为空"),
  language: z.string().trim().min(1).max(40).optional(),
  description: z.string().max(500, "描述最多 500 个字符").optional(),
  tags: z.array(z.string()).max(20, "标签最多 20 个").optional(),
  isPrivate: z.boolean().optional(),
});
export type CreateSnippetInput = z.infer<typeof createSnippetSchema>;

/* ── PATCH /api/snippets ──────────────────────────────────────────────── */

export const updateSnippetSchema = z
  .object({
    id: z.string().trim().min(1, "缺少片段 ID"),
    title: z.string().trim().min(1).max(120).optional(),
    content: z.string().min(1).optional(),
    language: z.string().trim().min(1).max(40).optional(),
    description: z.string().max(500).optional(),
    tags: z.array(z.string()).max(20).optional(),
    isPrivate: z.boolean().optional(),
  })
  .refine(
    (data) =>
      data.title !== undefined ||
      data.content !== undefined ||
      data.language !== undefined ||
      data.description !== undefined ||
      data.tags !== undefined ||
      data.isPrivate !== undefined,
    { message: "至少提供一个更新字段", path: [] },
  );
export type UpdateSnippetInput = z.infer<typeof updateSnippetSchema>;

/* ── DELETE /api/snippets ─────────────────────────────────────────────── */

export const deleteSnippetQuerySchema = idQuerySchema;
export type DeleteSnippetQuery = z.infer<typeof deleteSnippetQuerySchema>;
