/**
 * TR-042: 系统配置导出服务
 *
 * 从 Prisma 导出各配置表为脱敏 JSON，不含密码/密钥/SSH 凭据。
 * 导入时按依赖顺序事务性 upsert（见 import-service.ts）。
 */

import { prisma } from "@/lib/db";
import {
  EXPORT_SCHEMA_VERSION,
  isSensitiveSettingKey,
  type ExportFile,
} from "@/lib/system/config-schema";

function dateToISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

// ── 各表导出器 ────────────────────────────────────────────

async function exportPermissions() {
  const rows = await prisma.permission.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
  }));
}

async function exportRoles() {
  const rows = await prisma.role.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
  }));
}

async function exportRolePermissions() {
  const rows = await prisma.rolePermission.findMany();
  return rows.map((r) => ({
    roleId: r.roleId,
    permissionId: r.permissionId,
  }));
}

export type ExportMode = "standard" | "full";

async function exportUsers(mode: ExportMode) {
  const rows = await prisma.user.findMany({ orderBy: { username: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    displayName: r.displayName,
    passwordHash: mode === "full" ? r.passwordHash : null,
    status: r.status,
    mustChangePassword: r.mustChangePassword,
    twoFactorEnabled: r.twoFactorEnabled,
    twoFactorSecret: mode === "full" ? r.twoFactorSecret : null,
    preferences: r.preferences,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportUserRoles() {
  const rows = await prisma.userRole.findMany();
  return rows.map((r) => ({
    userId: r.userId,
    roleId: r.roleId,
    assignedAt: dateToISO(r.assignedAt)!,
  }));
}

async function exportSshKeys(mode: ExportMode) {
  const rows = await prisma.sshKey.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    fingerprint: r.fingerprint,
    publicKey: r.publicKey,
    privateKey: mode === "full" ? r.privateKey : null,
    passphrase: mode === "full" ? r.passphrase : null,
    description: r.description,
    createdById: r.createdById,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportServers(mode: ExportMode) {
  const rows = await prisma.server.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    host: r.host,
    port: r.port,
    username: r.username,
    sshKeyId: r.sshKeyId,
    password: mode === "full" ? r.password : null,
    description: r.description,
    tags: r.tags,
    enabled: r.enabled,
    connectionType: r.connectionType,
    publicUrl: r.publicUrl,
    fileProxyPort: r.fileProxyPort,
    osDialect: r.osDialect,
    osInfo: r.osInfo,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportStorageNodes() {
  const rows = await prisma.storageNode.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    driver: r.driver,
    isDefault: r.isDefault,
    basePath: r.basePath,
    directAccessMode: r.directAccessMode,
    publicBaseUrl: r.publicBaseUrl,
    directAccessExpiresSeconds: r.directAccessExpiresSeconds,
    host: r.host,
    port: r.port,
    username: r.username,
    serverId: r.serverId,
    healthStatus: r.healthStatus,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportUserStorageAccess() {
  const rows = await prisma.userStorageAccess.findMany();
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    storageNodeId: r.storageNodeId,
    pathPrefix: r.pathPrefix,
    canRead: r.canRead,
    canWrite: r.canWrite,
    canDelete: r.canDelete,
    quotaBytes: r.quotaBytes?.toString() ?? null,
    maxFileBytes: r.maxFileBytes?.toString() ?? null,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportCommandTemplates() {
  const rows = await prisma.commandTemplate.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    command: r.command,
    rollbackCommand: r.rollbackCommand,
    variables: r.variables,
    tags: r.tags,
    isBuiltin: r.isBuiltin,
    createdById: r.createdById,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportQuickServices() {
  const rows = await prisma.quickService.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    category: r.category,
    icon: r.icon,
    description: r.description,
    image: r.image,
    port: r.port,
    path: r.path,
    internalPort: r.internalPort,
    extraPortsJson: r.extraPortsJson,
    command: r.command,
    envJson: r.envJson,
    volumesJson: r.volumesJson,
    status: r.status,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportPlaybooks() {
  const rows = await prisma.playbook.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    description: r.description,
    triggerType: r.triggerType,
    triggerConfig: r.triggerConfig,
    steps: r.steps,
    chainRetry: r.chainRetry,
    enabled: r.enabled,
    createdById: r.createdById,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportAlertRules() {
  const rows = await prisma.alertRule.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    metric: r.metric,
    operator: r.operator,
    threshold: r.threshold,
    durationSeconds: r.durationSeconds,
    serverIds: r.serverIds,
    notifyChannels: r.notifyChannels,
    webhookUrl: r.webhookUrl,
    cooldownMinutes: r.cooldownMinutes,
    silenceWindows: r.silenceWindows,
    enabled: r.enabled,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportSettings(mode: ExportMode) {
  const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({
    key: r.key,
    value: mode === "full" ? r.value : (isSensitiveSettingKey(r.key) ? "" : r.value),
  }));
}

async function exportAiProviders(mode: ExportMode) {
  const rows = await prisma.aiProvider.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    apiKey: mode === "full" ? r.apiKey : null,
    baseUrl: r.baseUrl,
    defaultModel: r.defaultModel,
    availableModels: r.availableModels,
    isDefault: r.isDefault,
    enabled: r.enabled,
    settings: r.settings,
    createdBy: r.createdBy,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportAnnouncements() {
  const rows = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" } });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    body: r.body,
    level: r.level,
    pinned: r.pinned,
    published: r.published,
    startsAt: dateToISO(r.startsAt),
    expiresAt: dateToISO(r.expiresAt),
    createdBy: r.createdBy,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportSnippets() {
  const rows = await prisma.snippet.findMany({ orderBy: { title: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description,
    language: r.language,
    content: r.content,
    tags: r.tags,
    isPrivate: r.isPrivate,
    createdBy: r.createdBy,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

// ── 主导出函数 ────────────────────────────────────────────

export async function buildExportFile(sourceDomain: string, mode: ExportMode = "standard"): Promise<ExportFile> {
  const [
    permissions,
    roles,
    rolePermissions,
    users,
    userRoles,
    sshKeys,
    servers,
    storageNodes,
    userStorageAccess,
    commandTemplates,
    quickServices,
    playbooks,
    alertRules,
    settings,
    aiProviders,
    announcements,
    snippets,
  ] = await Promise.all([
    exportPermissions(),
    exportRoles(),
    exportRolePermissions(),
    exportUsers(mode),
    exportUserRoles(),
    exportSshKeys(mode),
    exportServers(mode),
    exportStorageNodes(),
    exportUserStorageAccess(),
    exportCommandTemplates(),
    exportQuickServices(),
    exportPlaybooks(),
    exportAlertRules(),
    exportSettings(mode),
    exportAiProviders(mode),
    exportAnnouncements(),
    exportSnippets(),
  ]);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceDomain,
    exportMode: mode,
    tables: {
      permissions,
      roles,
      rolePermissions,
      users,
      userRoles,
      sshKeys,
      servers,
      storageNodes,
      userStorageAccess,
      commandTemplates,
      quickServices,
      playbooks,
      alertRules,
      settings,
      aiProviders,
      announcements,
      snippets,
    },
  };
}

// ── 统计摘要（UI 显示用）──────────────────────────────────

export function getExportSummary(file: ExportFile): Record<string, number> {
  const t = file.tables;
  return {
    permissions: t.permissions.length,
    roles: t.roles.length,
    rolePermissions: t.rolePermissions.length,
    users: t.users.length,
    userRoles: t.userRoles.length,
    sshKeys: t.sshKeys.length,
    servers: t.servers.length,
    storageNodes: t.storageNodes.length,
    userStorageAccess: t.userStorageAccess.length,
    commandTemplates: t.commandTemplates.length,
    quickServices: t.quickServices.length,
    playbooks: t.playbooks.length,
    alertRules: t.alertRules.length,
    settings: t.settings.length,
    aiProviders: t.aiProviders.length,
    announcements: t.announcements.length,
    snippets: t.snippets.length,
  };
}