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

import { createPlaybookSchema } from "@/lib/playbook/schema";
import { createServerSchema } from "@/lib/server/schema";
import { createAnnouncementSchema, isAnnouncementWindowValid } from "@/lib/announcement/schema";
import { isSensitiveKey } from "@/lib/settings/schema";
import { EXPORT_SCHEMA_VERSION } from "./config-format";

export { CONFIG_IMPORT_MAX_BODY_BYTES, EXPORT_SCHEMA_VERSION } from "./config-format";

/** 敏感 Setting key 模式 — 值在导出时清空 */
const SENSITIVE_SETTING_PATTERN =
  /(_key|_secret|_token|_password|_url|\.(password|secret|token|api_key|apikey|botToken|s3SecretKey|s3AccessKey))$/i;

/**
 * Also every key the settings service treats as a secret (and stores
 * encrypted): smtp.pass, offsite.accessKeyId and offsite.secretAccessKey
 * matched neither suffix, so a "sanitized" export carried their ciphertext —
 * which another instance cannot decrypt and used as the SMTP password and S3
 * keys, while the settings page showed them as configured.
 */
export function isSensitiveSettingKey(key: string): boolean {
  return isSensitiveKey(key) || SENSITIVE_SETTING_PATTERN.test(key);
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
  /** Hashed 2FA recovery codes, full mode only (optional for older packages). */
  twoFactorRecoveryCodes: z.unknown().nullable().optional(),
  preferences: z.unknown().nullable(),
  createdAt: z.string(),
});

const userRoleSchema = z.object({
  userId: z.string(),
  roleId: z.string(),
  assignedAt: z.string(),
});

const sshKeyExportSchema = z.object({
  teamId: z.string().nullable().optional(),

  id: z.string(),
  name: z.string(),
  fingerprint: z.string(),
  publicKey: z.string(),
  // privateKey: null in standard mode, actual key in full mode
  privateKey: z.string().nullable().optional(),
  passphrase: z.string().nullable().optional(),
  description: z.string().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.string(),
});

const serverExportSchema = z.object({
  teamId: z.string().nullable().optional(),

  id: z.string(),
  name: z.string(),
  host: z.string(),
  port: z.number(),
  username: z.string(),
  sshKeyId: z.string().nullable(),
  // password: null in standard mode, actual password in full mode
  password: z.string().nullable().optional(),
  description: z.string().nullable(),
  tags: z.array(z.string()),
  enabled: z.boolean(),
  connectionType: z.string(),
  publicUrl: z.string().nullable(),
  fileProxyPort: z.number(),
  osDialect: z.string().nullable(),
  osInfo: z.string().nullable(),
  createdAt: z.string(),
  // Optional: packages exported before these were carried still import (with
  // the column defaults, as they did before).
  operatingSystem: z.enum(["LINUX", "WINDOWS"]).optional(),
  /** AGENT nodes come back without their Agent token: the Agent must be reinstalled. */
  managementMode: z.enum(["DIRECT", "AGENT"]).optional(),
  origin: z.enum(["PLATFORM", "CUSTOMER"]).optional(),
  hostKeySha256: z.string().nullable().optional(),
  rdpDomain: z.string().nullable().optional(),
  // rdpPassword: null in standard mode, actual (encrypted) password in full mode
  rdpPassword: z.string().nullable().optional(),
  rdpIgnoreCertificate: z.boolean().optional(),
  rdpCertificateSha256: z.string().nullable().optional(),
  costAutoSync: z.boolean().optional(),
  costMonthlyAmount: z.string().nullable().optional(),
  costCurrency: z.string().optional(),
  costProvider: z.string().nullable().optional(),
  expiresAt: z.string().nullable().optional(),
  trafficQuotaBytes: z.string().nullable().optional(),
  trafficQuotaMode: z.string().optional(),
  syncTargetAuth: z.enum(["inherit", "credential", "one-time-key"]).optional(),
});

// Customers and who belongs to them: resources carry their teamId, so a
// package must bring the customers it refers to.
const teamExportSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  /** Set for a deleted customer, kept so its retained resources still have an owner. */
  deletedAt: z.string().nullable().optional(),
});

const identityTemplateExportSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  permissions: z.array(z.string()),
  isBuiltin: z.boolean(),
});

const teamMemberExportSchema = z.object({
  teamId: z.string(),
  userId: z.string(),
  identityTemplateId: z.string(),
  joinedAt: z.string(),
});

const userServerAccessExportSchema = z.object({
  userId: z.string(),
  serverId: z.string(),
  canRead: z.boolean(),
  canConnect: z.boolean(),
  canManage: z.boolean(),
  canFileRead: z.boolean(),
  canFileWrite: z.boolean(),
  canFileDelete: z.boolean(),
});

const storageNodeExportSchema = z.object({
  teamId: z.string().nullable().optional(),

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
  healthStatus: z.enum(["UNKNOWN", "HEALTHY", "UNHEALTHY"]),
  createdAt: z.string(),
  // Optional for packages exported before these were carried.
  /** SFTP host-key pin. */
  hostKeySha256: z.string().nullable().optional(),
  /** WebDAV endpoint and credentials (encrypted): null in standard mode. */
  webdavConfigEncrypted: z.string().nullable().optional(),
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
  teamId: z.string().nullable().optional(),
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
  envJson: z.string().optional(),
  volumesJson: z.string().optional(),
  status: z.string(),
  createdAt: z.string(),
  // Multi-instance target (optional for older export packages)
  instanceKey: z.string().optional(),
  serverId: z.string().nullable().optional(),
});

const playbookSchema = z.object({
  teamId: z.string().nullable().optional(),

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

export const importPlaybooksSchema = z.array(createPlaybookSchema.safeExtend({
  id: playbookSchema.shape.id, teamId: playbookSchema.shape.teamId, createdById: playbookSchema.shape.createdById,
  createdAt: playbookSchema.shape.createdAt, description: playbookSchema.shape.description,
}));

const alertRuleSchema = z.object({
  teamId: z.string().nullable().optional(),

  id: z.string(),
  name: z.string(),
  metric: z.string(),
  operator: z.string(),
  threshold: z.number(),
  durationSeconds: z.number(),
  serverIds: z.array(z.string()),
  notifyChannels: z.array(z.string()),
  playbookIds: z.array(z.string()).optional().default([]),
  webhookUrl: z.string().nullable(),
  cooldownMinutes: z.number(),
  silenceWindows: z.array(z.string()),
  escalationMinutes: z.number().nullable().optional().default(null),
  onCallUserIds: z.array(z.string()).optional().default([]),
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
  apiKey: z.string().nullable().optional(),
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

const snapshotSchema = z.object({
  schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  exportedAt: z.string(),
  sourceDomain: z.string(),
  exportMode: z.enum(["standard", "full"]).optional(),
  /** team = current tenant only; global = platform admin full dump */
  exportScope: z.enum(["team", "global"]).optional(),
  /** team id when exportScope=team */
  exportTeamId: z.string().nullable().optional(),
  tables: z.object({
    // Added after schemaVersion 1 shipped: absent in older packages.
    teams: z.array(teamExportSchema).optional().default([]),
    identityTemplates: z.array(identityTemplateExportSchema).optional().default([]),
    teamMembers: z.array(teamMemberExportSchema).optional().default([]),
    userServerAccess: z.array(userServerAccessExportSchema).optional().default([]),
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

// Snapshots preserve the stored JSON, including legacy rows. Validate their
// executable configuration when accepting a snapshot for preview or import.
export type ExportFile = z.infer<typeof snapshotSchema>;
const timestamp = z.string().refine((s) => Number.isFinite(Date.parse(s)));
const importedServer = serverExportSchema.extend({
  host: z.string().trim(), username: z.string().trim(),
  port: z.number().int().min(1).max(65535),
  fileProxyPort: z.number().int().min(0).max(65535),
  connectionType: z.enum(["SSH_KEY", "PASSWORD"]),
}).superRefine((row, ctx) => {
  const fields = row.operatingSystem === "WINDOWS" ? createServerSchema.options[1].shape : createServerSchema.options[0].shape;
  for (const key of ["host", "username", "connectionType"] as const) {
    if (!fields[key].safeParse(row[key]).success) ctx.addIssue({ code: "custom", path: [key] });
  }
});

export const importAlertConditions = {
  metric: z.enum(["cpu_usage", "mem_usage", "disk_usage", "server_offline", "network_in", "network_out", "load_avg",
    "swap_usage", "capacity_cpu_days", "capacity_mem_days", "capacity_disk_days"]),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq"]),
  threshold: z.number().min(0).max(100000),
  durationSeconds: z.number().int().min(0).max(86400),
  cooldownMinutes: z.number().int().min(1).max(10080),
  escalationMinutes: z.number().int().min(1).max(10080).nullable().optional().default(null),
};

export const exportFileSchema = snapshotSchema.extend({
  tables: snapshotSchema.shape.tables.extend({
    playbooks: importPlaybooksSchema,
    users: z.array(userExportSchema.extend({ status: z.enum(["ACTIVE", "DISABLED", "PENDING_PASSWORD_RESET"]) })),
    servers: z.array(importedServer),
    alertRules: z.array(alertRuleSchema.extend(importAlertConditions)),
    aiProviders: z.array(aiProviderExportSchema.extend({ type: z.enum(["OPENAI", "OPENAI_COMPATIBLE", "ANTHROPIC", "GOOGLE", "CUSTOM"]) })),
    storageNodes: z.array(storageNodeExportSchema.extend({ driver: z.enum(["LOCAL", "SFTP", "WEBDAV", "AGENT"]), directAccessMode: z.enum(["PROXY", "DIRECT", "AUTO"]) })),
    snippets: z.array(snippetSchema.extend({ title: z.string().trim().min(1), content: z.string().refine((s) => Boolean(s.trim())), createdAt: timestamp })),
    announcements: z.array(announcementSchema.extend({
      title: createAnnouncementSchema.shape.title, body: createAnnouncementSchema.shape.content,
      level: createAnnouncementSchema.shape.type.unwrap(), createdAt: timestamp, startsAt: timestamp.nullable(), expiresAt: timestamp.nullable(),
    }).refine((r) => r.startsAt === null ||
      isAnnouncementWindowValid(Date.parse(r.startsAt), r.expiresAt === null ? null : Date.parse(r.expiresAt)), {
      message: "expiresAt must be after startsAt", path: ["expiresAt"],
    })),
  }),
}).superRefine((file, ctx) => {
  if (file.exportMode !== "standard") return;
  const reject = (table: string, index: number, field: string) => ctx.addIssue({ code: "custom", path: ["tables", table, index, field] });
  const sensitive = { users: ["passwordHash", "twoFactorSecret", "twoFactorRecoveryCodes"], servers: ["password", "rdpPassword"],
    sshKeys: ["privateKey", "passphrase"], storageNodes: ["webdavConfigEncrypted"], aiProviders: ["apiKey"], alertRules: ["webhookUrl"] } as const;
  for (const [table, fields] of Object.entries(sensitive)) {
    file.tables[table as keyof typeof sensitive].forEach((row: Record<string, unknown>, i) => {
      for (const field of fields) if (row[field] != null && row[field] !== "") reject(table, i, field);
    });
  }
  file.tables.settings.forEach((r, i) => { if (isSensitiveSettingKey(r.key) && r.value) reject("settings", i, "value"); });
  file.tables.quickServices.forEach((r, i) => {
    if (r.envJson && r.envJson !== "{}") reject("quickServices", i, "envJson");
    if (r.volumesJson && r.volumesJson !== "[]") reject("quickServices", i, "volumesJson");
  });
  file.tables.playbooks.forEach((r, i) => {
    if (r.steps.some((s) => s.type === "call_webhook" && (!/^https:\/\/redacted\.invalid\/vch-webhook\/[a-f0-9]{64}$/.test(s.config.url)
      || s.config.body || Object.values(s.config.headers ?? {}).some(Boolean)))) reject("playbooks", i, "steps");
  });
});

/** Every public service caller accepts the same input contract as the HTTP route. */
export function parseImportFile(file: ExportFile): ExportFile {
  return exportFileSchema.parse(file);
}

// ── 导入预览结构 ──────────────────────────────────────────

export type ImportIssue = {
  table: "servers" | "storageNodes" | "sshKeys" | "aiProviders" | "alertRules" | "commandTemplates" | "playbooks" | "storageAccess" | "settings" | "announcements" | "users";
  id: string;
  reason: string;
  blocking?: boolean;
  ownerMismatch?: { incoming: string | null; existing: string | null };
  replacementId?: string;
};

export type ImportPreview = {
  issues?: ImportIssue[];
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
