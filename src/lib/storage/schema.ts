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
