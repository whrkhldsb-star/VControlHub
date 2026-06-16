import { z } from "zod";

import { safeNormalizePublicBaseUrl } from "./direct-access-url";

export const storageAccessModeSchema = z.enum(["PROXY", "DIRECT", "AUTO"]);

const publicBaseUrlSchema = z
  .string()
  .trim()
  .max(2048, "直连基础 URL 过长")
  .optional()
  .or(z.literal(""))
  .superRefine((value, ctx) => {
    if (!value) return;
    const result = safeNormalizePublicBaseUrl(value);
    if (!result.ok) {
      ctx.addIssue({ code: "custom", message: result.error });
    }
  });

export const createStorageNodeSchema = z.object({
  name: z.string().trim().min(2, "存储节点名称至少 2 个字符").max(64, "存储节点名称最多 64 个字符"),
  driver: z.enum(["LOCAL", "SFTP"]),
  basePath: z.string().trim().min(1, "存储根路径不能为空").max(255, "存储根路径过长"),
  directAccessMode: storageAccessModeSchema.optional().default("PROXY"),
  publicBaseUrl: publicBaseUrlSchema,
  directAccessExpiresSeconds: z.coerce.number().int().min(60, "直连链接最短 60 秒").max(86400, "直连链接最长 24 小时").optional().default(300),
  isDefault: z.boolean().optional().default(false),
  host: z.string().trim().max(255, "主机名过长").optional(),
  port: z.coerce.number().int().min(1, "端口最小为 1").max(65535, "端口最大为 65535").optional(),
  username: z.string().trim().max(64, "用户名过长").optional(),
  serverId: z.string().trim().optional(),
});

export const updateStorageNodeSchema = z.object({
  storageNodeId: z.string().trim().min(1, "存储节点不能为空"),
  name: z.string().trim().min(2, "存储节点名称至少 2 个字符").max(64, "存储节点名称最多 64 个字符").optional(),
  driver: z.enum(["LOCAL", "SFTP"]).optional(),
  basePath: z.string().trim().min(1, "存储根路径不能为空").max(255, "存储根路径过长").optional(),
  directAccessMode: storageAccessModeSchema.optional(),
  publicBaseUrl: publicBaseUrlSchema,
  directAccessExpiresSeconds: z.coerce.number().int().min(60, "直连链接最短 60 秒").max(86400, "直连链接最长 24 小时").optional(),
  isDefault: z.boolean().optional(),
  host: z.string().trim().max(255, "主机名过长").optional().nullable(),
  port: z.coerce.number().int().min(1, "端口最小为 1").max(65535, "端口最大为 65535").optional().nullable(),
  username: z.string().trim().max(64, "用户名过长").optional().nullable(),
  serverId: z.string().trim().optional().nullable(),
});

export const createFileEntrySchema = z.object({
  storageNodeId: z.string().trim().min(1, "存储节点不能为空"),
  name: z.string().trim().min(1, "文件名不能为空").max(255, "文件名过长"),
  entryType: z.enum(["FILE", "DIRECTORY"]),
  mimeType: z.string().trim().max(255, "MIME 类型过长").optional(),
  size: z.coerce.number().int().min(0, "文件大小不能小于 0").optional(),
  checksumSha256: z.string().trim().max(128, "校验值过长").optional(),
  relativePath: z.string().trim().min(1, "相对路径不能为空").max(1024, "相对路径过长"),
  parentId: z.string().trim().optional(),
});

export const updateFileEntrySchema = z.object({
  fileEntryId: z.string().trim().min(1, "文件条目不能为空"),
  storageNodeId: z.string().trim().min(1, "存储节点不能为空").optional(),
  name: z.string().trim().min(1, "文件名不能为空").max(255, "文件名过长").optional(),
  mimeType: z.string().trim().max(255, "MIME 类型过长").optional(),
  size: z.coerce.number().int().min(0, "文件大小不能小于 0").optional(),
  checksumSha256: z.string().trim().max(128, "校验值过长").optional(),
  relativePath: z.string().trim().min(1, "相对路径不能为空").max(1024, "相对路径过长").optional(),
  parentId: z.string().trim().optional(),
});

export const fileEntryMutationSchema = z.object({
  fileEntryId: z.string().trim().min(1, "文件条目不能为空"),
});

export type CreateStorageNodeInput = z.input<typeof createStorageNodeSchema>;
export type UpdateStorageNodeInput = z.input<typeof updateStorageNodeSchema>;
export type CreateFileEntryInput = z.infer<typeof createFileEntrySchema>;
export type UpdateFileEntryInput = z.infer<typeof updateFileEntrySchema>;
export type FileEntryMutationInput = z.infer<typeof fileEntryMutationSchema>;

// === TR-037 R6: API route inline zod migration for storage routes ===
//
// Background: 8 storage routes (`archive-download`, `direct-access`, `local`,
// `sftp`, `sftp-download`, `sftp-ops`, `sftp-stale-inventory`, `sftp-sync`)
// used to inline `z.object({...})` either at module scope or inside
// `parseSearchParams(...)` calls. To centralise the boundary (so that the
// audit script can verify coverage), each route now imports the relevant
// schema from this file. Behaviour is identical to the inline versions:
// same keys, same validators, same defaults.

// Shared "node + relative path" query schema for content download endpoints
// (archive-download, sftp-download). Both routes accept optional `nodeId`
// and optional `path` — the application layer decides what to do when the
// caller omits them.
export const storageFileQuerySchema = z.object({
  nodeId: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).optional(),
});

// SFTP directory listing query schema. Differs from `storageFileQuerySchema`
// only in that `path` defaults to `/` (root of the SFTP node).
export const sftpListQuerySchema = z.object({
  nodeId: z.string().trim().min(1).optional(),
  path: z.string().trim().min(1).default("/"),
});

// Content download query schema. Shared by sftp-download and local
// (used by the LOCAL driver GET handler in `local/route.ts`). Extends
// `storageFileQuerySchema` with an optional `download` flag —
// `?download=1` asks the server to send a
// `Content-Disposition: attachment` header. Coerces the string value to a
// boolean.
export const contentDownloadQuerySchema = storageFileQuerySchema.extend({
  download: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
});

// SFTP-OPS POST body: action enum + target path + optional
// newPath/content/isDirectory. `action` is exported separately so call
// sites can narrow types if they want to.
export const sftpOpsActionSchema = z.enum(["delete", "rename", "read", "write"]);
export const sftpOpsBodySchema = z.object({
  nodeId: z.string().min(1),
  action: sftpOpsActionSchema,
  path: z.string().min(1),
  newPath: z.string().optional(),
  content: z.string().optional(),
  isDirectory: z.boolean().optional(),
});

// SFTP stale inventory POST body: optional nodeId + maxDepth + dryRun +
// reason. `reason` is short text the operator can attach to the audit log.
export const sftpStaleInventoryBodySchema = z.object({
  nodeId: z.string().min(1).optional(),
  maxDepth: z.number().int().min(0).max(10).optional(),
  dryRun: z.boolean().optional(),
  reason: z.string().trim().min(1).max(120).optional(),
});

// SFTP sync POST body: required nodeId + optional remotePath + recursive +
// maxDepth. `maxDepth` is bounded 1-10 to prevent pathological recursion.
export const sftpSyncBodySchema = z.object({
  nodeId: z.string().min(1),
  remotePath: z.string().optional(),
  recursive: z.boolean().optional(),
  maxDepth: z.number().int().min(1).max(10).optional(),
});

// `?wait=1` / `?wait=true` query shared by sftp-stale-inventory and
// sftp-sync. Coerces the string value to a boolean — `true` only when the
// caller explicitly asks to block.
export const sftpWaitQuerySchema = z.object({
  wait: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
});

// Direct-access POST body (and the corresponding GET query when the call
// site builds an object literal from `URLSearchParams`).
export const directAccessInputSchema = z.object({
  nodeId: z.string().min(1),
  relativePath: z.string().min(1),
});

// `?download=1` / `?download=true` query for the direct-access GET
// endpoint. Coerces the string value to a boolean.
export const directAccessDownloadQuerySchema = z.object({
  download: z
    .string()
    .optional()
    .transform((value) => value === "1" || value === "true"),
});

export type SftpOpsBody = z.infer<typeof sftpOpsBodySchema>;
export type SftpOpsAction = z.infer<typeof sftpOpsActionSchema>;
export type SftpStaleInventoryBody = z.infer<typeof sftpStaleInventoryBodySchema>;
export type SftpSyncBody = z.infer<typeof sftpSyncBodySchema>;
export type SftpWaitQuery = z.infer<typeof sftpWaitQuerySchema>;
export type DirectAccessInput = z.infer<typeof directAccessInputSchema>;
export type DirectAccessDownloadQuery = z.infer<typeof directAccessDownloadQuerySchema>;
