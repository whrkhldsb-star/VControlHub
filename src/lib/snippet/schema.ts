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
  title: z.string().trim().min(1, "Title is required").max(120, "Title must be at most 120 characters"),
  content: z.string().min(1, "Content is required"),
  language: z.string().trim().min(1).max(40).optional(),
  description: z.string().max(500, "Description must be at most 500 characters").optional(),
  tags: z.array(z.string()).max(20, "At most 20 tags are allowed").optional(),
  isPrivate: z.boolean().optional(),
});
export type CreateSnippetInput = z.infer<typeof createSnippetSchema>;

/* ── PATCH /api/snippets ──────────────────────────────────────────────── */

export const updateSnippetSchema = z
  .object({
    id: z.string().trim().min(1, "Snippet ID is required"),
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
    { message: "At least one update field must be provided", path: [] },
  );
export type UpdateSnippetInput = z.infer<typeof updateSnippetSchema>;

/* ── DELETE /api/snippets ─────────────────────────────────────────────── */

export const deleteSnippetQuerySchema = idQuerySchema;
export type DeleteSnippetQuery = z.infer<typeof deleteSnippetQuerySchema>;
