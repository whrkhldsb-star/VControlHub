/**
 * TR-042: 系统配置导出/导入 — zod schema 定义
 *
 * 导出格式 `.vch.json`（gzip 可选），包含 schema 版本 + 导出时间 + 来源域名 +
 * 各配置表的脱敏快照。导入时按依赖顺序事务性 upsert。
 *
 * 安全原则：
 * - User.passwordHash → null（导入后需重新设置密码）
 * - User.twoFactorSecret → null
 * - SshKey.privateKey → null
 * - Server.password → null
 * - AiProvider.apiKey → null
 * - Setting 中以 _key/_secret/_token/_password 结尾的 key → 值置为空字符串
 */

import { z } from "zod";

// ── 导出文件顶层结构 ──────────────────────────────────────

export const EXPORT_SCHEMA_VERSION = 1;

/** 敏感 Setting key 模式 — 值在导出时清空 */
const SENSITIVE_SETTING_PATTERN = /(_key|_secret|_token|_password|_url|\.(password|secret|token|api_key|apikey|botToken|s3SecretKey|s3AccessKey))$/i;

export function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_PATTERN.test(key);
}

// ── 各表导出 schema ──────────────────────────────────────

const permissionSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});

const roleSchema = z.object({
  id: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
});

const rolePermissionSchema = z.object({
  roleId: z.string(),
  permissionId: z.string(),
});

const userExportSchema = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string().nullable(),
  // passwordHash: null in standard mode, actual hash in full mode
  passwordHash: z.string().nullable(),
  status: z.string(),
  mustChangePassword: z.boolean(),
  twoFactorEnabled: z.boolean(),
  // twoFactorSecret: null in standard mode, actual secret in full mode
  twoFactorSecret: z.string().nullable(),
  preferences: z.unknown().nullable(),
  createdAt: z.string(),
});

const userRoleSchema = z.object({
  userId: z.string(),
  roleId: z.string(),
  assignedAt: z.string(),
});

const sshKeyExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  fingerprint: z.string(),
  publicKey: z.string(),
  // privateKey: null in standard mode, actual key in full mode
  privateKey: z.string().nullable(),
  passphrase: z.string().nullable(),
  description: z.string().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
});

const serverExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  sshKeyId: z.string().nullable(),
  // password: null in standard mode, actual password in full mode
  password: z.string().nullable(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  enabled: z.boolean(),
  connectionType: z.string(),
  publicUrl: z.string().nullable(),
  fileProxyPort: z.number(),
  osDialect: z.string().nullable(),
  osInfo: z.string().nullable(),
  createdAt: z.string(),
});

const storageNodeExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  driver: z.string(),
  isDefault: z.boolean(),
  basePath: z.string(),
  directAccessMode: z.string(),
  publicBaseUrl: z.string().nullable(),
  directAccessExpiresSeconds: z.number(),
  host: z.string().nullable(),
  port: z.number().nullable(),
  username: z.string().nullable(),
  serverId: z.string().nullable(),
  healthStatus: z.string(),
  createdAt: z.string(),
});

const userStorageAccessSchema = z.object({
  id: z.string(),
  userId: z.string(),
  storageNodeId: z.string(),
  pathPrefix: z.string(),
  canRead: z.boolean(),
  canWrite: z.boolean(),
  canDelete: z.boolean(),
  quotaBytes: z.string().nullable(),
  maxFileBytes: z.string().nullable(),
  createdAt: z.string(),
});

const commandTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  command: z.string(),
  rollbackCommand: z.string().nullable(),
  variables: z.array(z.string()),
  tags: z.array(z.string()),
  isBuiltin: z.boolean(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
});

const quickServiceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  category: z.string(),
  icon: z.string(),
  description: z.string(),
  image: z.string(),
  port: z.number(),
  path: z.string(),
  internalPort: z.number().nullable(),
  extraPortsJson: z.string(),
  command: z.string().nullable(),
  envJson: z.string(),
  volumesJson: z.string(),
  status: z.string(),
  createdAt: z.string(),
});

const playbookSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  triggerType: z.string(),
  triggerConfig: z.unknown(),
  steps: z.unknown(),
  chainRetry: z.number(),
  enabled: z.boolean(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
});

const alertRuleSchema = z.object({
  id: z.string(),
  name: z.string(),
  metric: z.string(),
  operator: z.string(),
  threshold: z.number(),
  durationSeconds: z.number(),
  serverIds: z.array(z.string()),
  notifyChannels: z.array(z.string()),
  webhookUrl: z.string().nullable(),
  cooldownMinutes: z.number(),
  silenceWindows: z.array(z.string()),
  enabled: z.boolean(),
  createdAt: z.string(),
});

const settingSchema = z.object({
  key: z.string(),
  // 敏感 key 的值导出时清空
  value: z.string(),
});

const aiProviderExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  // apiKey: null in standard mode, actual key in full mode
  apiKey: z.string().nullable(),
  baseUrl: z.string(),
  defaultModel: z.string(),
  availableModels: z.string(),
  isDefault: z.boolean(),
  enabled: z.boolean(),
  settings: z.unknown(),
  createdBy: z.string(),
  createdAt: z.string(),
});

const announcementSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  level: z.string(),
  pinned: z.boolean(),
  published: z.boolean(),
  startsAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

const snippetSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string().nullable(),
  language: z.string(),
  content: z.string(),
  tags: z.array(z.string()),
  isPrivate: z.boolean(),
  createdBy: z.string().nullable(),
  createdAt: z.string(),
});

// ── 完整导出文件 schema ──────────────────────────────────

export const exportFileSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: z.string(),
  sourceDomain: z.string(),
  exportMode: z.enum(["standard", "full"]).optional(),
  tables: z.object({
    permissions: z.array(permissionSchema),
    roles: z.array(roleSchema),
    rolePermissions: z.array(rolePermissionSchema),
    users: z.array(userExportSchema),
    userRoles: z.array(userRoleSchema),
    sshKeys: z.array(sshKeyExportSchema),
    servers: z.array(serverExportSchema),
    storageNodes: z.array(storageNodeExportSchema),
    userStorageAccess: z.array(userStorageAccessSchema),
    commandTemplates: z.array(commandTemplateSchema),
    quickServices: z.array(quickServiceSchema),
    playbooks: z.array(playbookSchema),
    alertRules: z.array(alertRuleSchema),
    settings: z.array(settingSchema),
    aiProviders: z.array(aiProviderExportSchema),
    announcements: z.array(announcementSchema),
    snippets: z.array(snippetSchema),
  }),
});

export type ExportFile = z.infer<typeof exportFileSchema>;

// ── 导入预览结构 ──────────────────────────────────────────

export type ImportPreview = {
  summary: Record<string, { create: number; update: number; skip: number }>;
  warnings: string[];
  totalRecords: number;
};

// ── 导入选项 ──────────────────────────────────────────────

export const importOptionsSchema = z.object({
  dryRun: z.boolean().default(false),
  overwriteExisting: z.boolean().default(true),
  importUsers: z.boolean().default(true),
  importSettings: z.boolean().default(true),
});

export type ImportOptions = z.infer<typeof importOptionsSchema>;