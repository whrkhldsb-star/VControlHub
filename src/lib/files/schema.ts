/**
 * Files API zod request schemas (TR-037 R7).
 *
 * Per-route query/body validation schemas that were previously declared
 * inline in the files API routes. Centralising them in this module lets
 * the `scripts/tr-019-dto-audit.ts` boundary audit count these routes
 * as "boundary-imported" instead of "inline-zod" gaps, and lets the
 * `__tests__/schema.test.ts` unit tests exercise the schemas without
 * spinning up the API route handlers.
 *
 * Pure schemas — no runtime side effects, no Prisma, no DB.
 *
 * Naming convention: <verb><Resource>QuerySchema / <verb><Resource>BodySchema.
 * Tense follows the route's export (GET uses *QuerySchema, POST/PUT/PATCH
 * use *BodySchema, DELETE typically uses *QuerySchema).
 */
import { z } from "zod";

/**
 * GET /api/files/archive-list
 *
 * `driver` accepts only LOCAL or SFTP (defaults to LOCAL). SFTP is
 * rejected by the route handler with a 400 — we keep the union exhaustive
 * so the audit reports a clean schema and a future SFTP implementation
 * can flip the default without changing this file.
 */
export const archiveListQuerySchema = z.object({
  nodeId: z.string().trim().optional(),
  relativePath: z.string().trim().optional(),
  driver: z.enum(["LOCAL", "SFTP"]).default("LOCAL"),
  name: z.string().trim().min(1).default("archive"),
});

export type ArchiveListQuery = z.infer<typeof archiveListQuerySchema>;

/**
 * GET /api/files/list
 *
 * `path` is optional — when omitted the browser root listing is returned.
 * `q` is an optional case-insensitive substring filter (handled by the
 * route after normalisation). `scope` toggles between "current" (one
 * directory) and "all" (recursively under the current path). `nodeId`
 * narrows the listing to a single storage node.
 */
export const listFilesQuerySchema = z.object({
  path: z.string().trim().min(1).optional(),
  q: z.string().trim().optional(),
  scope: z.enum(["all", "current"]).default("current"),
  nodeId: z.string().trim().optional(),
});

export type ListFilesQuery = z.infer<typeof listFilesQuerySchema>;

/**
 * POST /api/files/compress
 *
 * Creates a local .tar.gz archive from selected file/folder paths under a
 * single storage node. The route resolves every path inside the node base and
 * feeds tar via a null-delimited file list, so names starting with '-' or
 * containing whitespace never become command-line flags.
 */
export const compressFilesBodySchema = z.object({
  storageNodeId: z.string().trim().min(1),
  relativePaths: z.array(z.string().trim().min(1)).min(1).max(200),
  outputName: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[^/\\\0]+$/, "压缩包名称不能包含路径分隔符"),
  targetDir: z.string().trim().optional(),
});

export type CompressFilesBody = z.infer<typeof compressFilesBodySchema>;

/**
 * PUT /api/files/editable/[id]
 *
 * `content` is capped at 512 KB — anything larger is rejected as "too
 * big for the in-browser editor". `expectedUpdatedAt` /
 * `expectedLastModifiedMs` are optimistic-concurrency tokens carried
 * by the editable preview client; both are optional + nullable because
 * the first save on a freshly opened draft has no prior timestamp.
 */
export const saveEditableFileBodySchema = z.object({
  content: z.string().max(512 * 1024, "File exceeds 512 KB, online editing is not supported"),
  expectedUpdatedAt: z.string().datetime().optional().nullable(),
  expectedLastModifiedMs: z
    .number()
    .finite()
    .nonnegative()
    .optional()
    .nullable(),
});

export type SaveEditableFileBody = z.infer<typeof saveEditableFileBodySchema>;
