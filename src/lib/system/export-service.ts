/**
 * TR-042: 系统配置导出服务
 *
 * Multi-tenant design (2026-07):
 * - Default scope = current team (tenant-safe).
 * - Platform-global scope only for role `admin`.
 * - Full (secrets) mode only for role `admin`.
 *
 * Tables without teamId:
 * - permissions/roles always (RBAC catalog, no secrets)
 * - settings/aiProviders/announcements only on global scope
 * - commandTemplates shared catalog (no secrets)
 * - snippets: public + team members' private on team scope
 *
 * Sensitive fields stripped in standard mode; full mode includes secrets.
 */

import { prisma } from "@/lib/db";
import {
  EXPORT_SCHEMA_VERSION,
  isSensitiveSettingKey,
  type ExportFile,
} from "@/lib/system/config-schema";
import type { SessionPayload } from "@/lib/auth/session";
import { ValidationError, ForbiddenError } from "@/lib/errors";

function dateToISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

export type ExportMode = "standard" | "full";
export type ExportScope = "team" | "global";

export type ExportOptions = {
  sourceDomain: string;
  mode?: ExportMode;
  scope?: ExportScope;
  teamId?: string | null;
  session: SessionPayload;
};

function isPlatformAdmin(session: SessionPayload): boolean {
  return session.roles.includes("admin");
}

function teamScopedWhere(teamId: string) {
  return { OR: [{ teamId }, { teamId: null }] as const };
}

async function exportPermissions() {
  const rows = await prisma.permission.findMany({ orderBy: { key: "asc" }, take: 1000 });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
  }));
}

async function exportRoles() {
  const rows = await prisma.role.findMany({ orderBy: { key: "asc" }, take: 1000 });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
  }));
}

async function exportRolePermissions() {
  const rows = await prisma.rolePermission.findMany({ take: 1000 });
  return rows.map((r) => ({
    roleId: r.roleId,
    permissionId: r.permissionId,
  }));
}

async function exportUsers(mode: ExportMode, scope: ExportScope, teamId: string | null) {
  if (scope === "team" && teamId) {
    const memberUserIds = (
      await prisma.teamMember.findMany({
        where: { teamId },
        select: { userId: true },
        take: 5000,
      })
    ).map((m) => m.userId);
    if (memberUserIds.length === 0) return [];
    const rows = await prisma.user.findMany({
      where: { id: { in: memberUserIds } },
      orderBy: { username: "asc" },
      select: {
        id: true,
        username: true,
        displayName: true,
        status: true,
        mustChangePassword: true,
        twoFactorEnabled: true,
        preferences: true,
        createdAt: true,
        passwordHash: mode === "full",
        twoFactorSecret: mode === "full",
      },
      take: 1000,
    });
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

  const rows = await prisma.user.findMany({
    orderBy: { username: "asc" },
    select: {
      id: true,
      username: true,
      displayName: true,
      status: true,
      mustChangePassword: true,
      twoFactorEnabled: true,
      preferences: true,
      createdAt: true,
      passwordHash: mode === "full",
      twoFactorSecret: mode === "full",
    },
    take: 1000,
  });
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

async function exportUserRoles(scope: ExportScope, userIds: string[]) {
  if (scope === "team") {
    if (userIds.length === 0) return [];
    const rows = await prisma.userRole.findMany({
      where: { userId: { in: userIds } },
      take: 5000,
    });
    return rows.map((r) => ({
      userId: r.userId,
      roleId: r.roleId,
      assignedAt: dateToISO(r.assignedAt)!,
    }));
  }
  const rows = await prisma.userRole.findMany({ take: 5000 });
  return rows.map((r) => ({
    userId: r.userId,
    roleId: r.roleId,
    assignedAt: dateToISO(r.assignedAt)!,
  }));
}

async function exportSshKeys(mode: ExportMode, scope: ExportScope, teamId: string | null) {
  const where = scope === "team" && teamId ? teamScopedWhere(teamId) : {};
  const rows = await prisma.sshKey.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      fingerprint: true,
      publicKey: true,
      description: true,
      createdById: true,
      createdAt: true,
      teamId: true,
      privateKey: mode === "full",
      passphrase: mode === "full",
    },
    take: 1000,
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    fingerprint: r.fingerprint,
    publicKey: r.publicKey,
    privateKey: mode === "full" ? r.privateKey : null,
    passphrase: mode === "full" ? r.passphrase : null,
    description: r.description,
    createdById: r.createdById,
    teamId: r.teamId ?? null,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportServers(mode: ExportMode, scope: ExportScope, teamId: string | null) {
  const where = scope === "team" && teamId ? teamScopedWhere(teamId) : {};
  const rows = await prisma.server.findMany({
    where,
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      host: true,
      port: true,
      username: true,
      sshKeyId: true,
      description: true,
      tags: true,
      enabled: true,
      connectionType: true,
      publicUrl: true,
      fileProxyPort: true,
      osDialect: true,
      osInfo: true,
      createdAt: true,
      teamId: true,
      password: mode === "full",
    },
    take: 1000,
  });
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
    teamId: r.teamId ?? null,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportStorageNodes(scope: ExportScope, teamId: string | null) {
  const where = scope === "team" && teamId ? teamScopedWhere(teamId) : {};
  const rows = await prisma.storageNode.findMany({
    where,
    orderBy: { name: "asc" },
    take: 1000,
  });
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
    teamId: r.teamId ?? null,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportUserStorageAccess(scope: ExportScope, storageNodeIds: string[]) {
  if (scope === "team") {
    if (storageNodeIds.length === 0) return [];
    const rows = await prisma.userStorageAccess.findMany({
      where: { storageNodeId: { in: storageNodeIds } },
      take: 5000,
    });
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
  const rows = await prisma.userStorageAccess.findMany({ take: 5000 });
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
  const rows = await prisma.commandTemplate.findMany({ orderBy: { name: "asc" }, take: 1000 });
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

async function exportQuickServices(scope: ExportScope, teamId: string | null) {
  if (scope === "team" && teamId) {
    const rows = await prisma.quickService.findMany({
      where: {
        OR: [{ server: { teamId } }, { server: { teamId: null }, serverId: { not: null } }],
      },
      orderBy: { name: "asc" },
      take: 1000,
    });
    return rows.map(mapQuickService);
  }
  const rows = await prisma.quickService.findMany({ orderBy: { name: "asc" }, take: 1000 });
  return rows.map(mapQuickService);
}

function mapQuickService(r: {
  id: string;
  slug: string;
  name: string;
  category: string;
  icon: string;
  description: string;
  image: string;
  port: number;
  path: string;
  internalPort: number | null;
  extraPortsJson: string;
  command: string | null;
  envJson: string;
  volumesJson: string;
  status: string;
  createdAt: Date;
}) {
  return {
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
  };
}

async function exportPlaybooks(scope: ExportScope, teamId: string | null) {
  const where = scope === "team" && teamId ? teamScopedWhere(teamId) : {};
  const rows = await prisma.playbook.findMany({ where, orderBy: { name: "asc" }, take: 1000 });
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
    teamId: r.teamId ?? null,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportAlertRules(scope: ExportScope, teamId: string | null) {
  const where = scope === "team" && teamId ? teamScopedWhere(teamId) : {};
  const rows = await prisma.alertRule.findMany({ where, orderBy: { name: "asc" }, take: 1000 });
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
    teamId: r.teamId ?? null,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

async function exportSettings(mode: ExportMode, scope: ExportScope) {
  if (scope === "team") return [];
  const rows = await prisma.setting.findMany({ orderBy: { key: "asc" }, take: 1000 });
  return rows.map((r) => ({
    key: r.key,
    value: mode === "full" ? r.value : isSensitiveSettingKey(r.key) ? "" : r.value,
  }));
}

async function exportAiProviders(mode: ExportMode, scope: ExportScope) {
  if (scope === "team") return [];
  const rows = await prisma.aiProvider.findMany({
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      type: true,
      baseUrl: true,
      defaultModel: true,
      availableModels: true,
      isDefault: true,
      enabled: true,
      settings: true,
      createdBy: true,
      createdAt: true,
      apiKey: mode === "full",
    },
    take: 1000,
  });
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

async function exportAnnouncements(scope: ExportScope) {
  if (scope === "team") return [];
  const rows = await prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 1000 });
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

async function exportSnippets(scope: ExportScope, memberUserIds: string[]) {
  if (scope === "team") {
    const rows = await prisma.snippet.findMany({
      where: {
        OR: [
          { isPrivate: false },
          ...(memberUserIds.length ? [{ createdBy: { in: memberUserIds } }] : []),
        ],
      },
      orderBy: { title: "asc" },
      take: 1000,
    });
    return rows.map(mapSnippet);
  }
  const rows = await prisma.snippet.findMany({ orderBy: { title: "asc" }, take: 1000 });
  return rows.map(mapSnippet);
}

function mapSnippet(r: {
  id: string;
  title: string;
  description: string | null;
  language: string;
  content: string;
  tags: string[];
  isPrivate: boolean;
  createdBy: string | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    language: r.language,
    content: r.content,
    tags: r.tags,
    isPrivate: r.isPrivate,
    createdBy: r.createdBy,
    createdAt: dateToISO(r.createdAt)!,
  };
}

export function resolveExportAuthorization(input: {
  session: SessionPayload;
  mode: ExportMode;
  scope: ExportScope;
  teamId?: string | null;
}): { mode: ExportMode; scope: ExportScope; teamId: string | null } {
  const { session } = input;
  let { mode, scope } = input;
  const teamId = input.teamId ?? session.currentTeamId ?? null;

  if (mode === "full" && !isPlatformAdmin(session)) {
    throw new ForbiddenError("Full export (with secrets) requires platform admin");
  }
  if (scope === "global" && !isPlatformAdmin(session)) {
    throw new ForbiddenError("Global export requires platform admin");
  }
  if (scope === "team" && !teamId) {
    throw new ValidationError("No current team selected for team export", { field: "teamId" });
  }
  if (!isPlatformAdmin(session)) {
    scope = "team";
    mode = "standard";
  }
  return { mode, scope, teamId: scope === "global" ? null : teamId };
}

export async function buildExportFile(
  sourceDomainOrOptions: string | ExportOptions,
  legacyMode: ExportMode = "standard",
): Promise<ExportFile> {
  let sourceDomain: string;
  let mode: ExportMode;
  let scope: ExportScope;
  let teamId: string | null;

  if (typeof sourceDomainOrOptions === "string") {
    sourceDomain = sourceDomainOrOptions;
    mode = legacyMode;
    scope = "global";
    teamId = null;
  } else {
    const opts = sourceDomainOrOptions;
    sourceDomain = opts.sourceDomain;
    const resolved = resolveExportAuthorization({
      session: opts.session,
      mode: opts.mode ?? "standard",
      scope: opts.scope ?? "team",
      teamId: opts.teamId,
    });
    mode = resolved.mode;
    scope = resolved.scope;
    teamId = resolved.teamId;
  }

  const users = await exportUsers(mode, scope, teamId);
  const userIds = users.map((u) => u.id);

  const [
    permissions,
    roles,
    rolePermissions,
    userRoles,
    sshKeys,
    servers,
    storageNodes,
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
    exportUserRoles(scope, userIds),
    exportSshKeys(mode, scope, teamId),
    exportServers(mode, scope, teamId),
    exportStorageNodes(scope, teamId),
    exportCommandTemplates(),
    exportQuickServices(scope, teamId),
    exportPlaybooks(scope, teamId),
    exportAlertRules(scope, teamId),
    exportSettings(mode, scope),
    exportAiProviders(mode, scope),
    exportAnnouncements(scope),
    exportSnippets(scope, userIds),
  ]);

  const storageNodeIds = storageNodes.map((n) => n.id);
  const userStorageAccess = await exportUserStorageAccess(scope, storageNodeIds);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceDomain,
    exportMode: mode,
    exportScope: scope,
    exportTeamId: teamId,
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
