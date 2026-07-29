/**
 * Per-table collectors for the system export service.
 *
 * Extracted from export-service.ts so the public API (resolveExportAuthorization,
 * buildExportFile, getExportSummary) stays focused on orchestration. Each
 * collector reads one Prisma table and strips secrets according to mode/scope.
 */

import { prisma } from "@/lib/db";
import { isSensitiveSettingKey } from "@/lib/system/config-schema";

import type { ExportMode, ExportScope } from "./export-types";

function dateToISO(d: Date | null | undefined): string | null {
  return d ? d.toISOString() : null;
}

function teamScopedWhere(teamId: string) {
  return { OR: [{ teamId }, { teamId: null }] as const };
}

export async function exportPermissions() {
  const rows = await prisma.permission.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
  }));
}

export async function exportRoles() {
  const rows = await prisma.role.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({
    id: r.id,
    key: r.key,
    name: r.name,
    description: r.description,
  }));
}

export async function exportRolePermissions() {
  const rows = await prisma.rolePermission.findMany();
  return rows.map((r) => ({
    roleId: r.roleId,
    permissionId: r.permissionId,
  }));
}

export async function exportUsers(
  mode: ExportMode,
  scope: ExportScope,
  teamId: string | null,
) {
  if (scope === "team" && teamId) {
    const memberUserIds = (
      await prisma.teamMember.findMany({
        where: { teamId },
        select: { userId: true },
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

export async function exportUserRoles(scope: ExportScope, userIds: string[]) {
  if (scope === "team") {
    if (userIds.length === 0) return [];
    const rows = await prisma.userRole.findMany({
      where: { userId: { in: userIds } },
    });
    return rows.map((r) => ({
      userId: r.userId,
      roleId: r.roleId,
      assignedAt: dateToISO(r.assignedAt)!,
    }));
  }
  const rows = await prisma.userRole.findMany();
  return rows.map((r) => ({
    userId: r.userId,
    roleId: r.roleId,
    assignedAt: dateToISO(r.assignedAt)!,
  }));
}

export async function exportSshKeys(
  mode: ExportMode,
  scope: ExportScope,
  teamId: string | null,
) {
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

export async function exportServers(
  mode: ExportMode,
  scope: ExportScope,
  teamId: string | null,
) {
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

export async function exportStorageNodes(
  scope: ExportScope,
  teamId: string | null,
) {
  const where = scope === "team" && teamId ? teamScopedWhere(teamId) : {};
  const rows = await prisma.storageNode.findMany({
    where,
    orderBy: { name: "asc" },
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

export async function exportUserStorageAccess(
  scope: ExportScope,
  storageNodeIds: string[],
) {
  if (scope === "team") {
    if (storageNodeIds.length === 0) return [];
    const rows = await prisma.userStorageAccess.findMany({
      where: { storageNodeId: { in: storageNodeIds } },
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

export async function exportCommandTemplates() {
  const rows = await prisma.commandTemplate.findMany({
    orderBy: { name: "asc" },
  });
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

export async function exportQuickServices(
  mode: ExportMode,
  scope: ExportScope,
  teamId: string | null,
) {
  if (scope === "team" && teamId) {
    // Team scope: hub-host (serverId null) + remote services on this team's servers only.
    // Do NOT pull server.teamId==null remotes (cross-tenant leak).
    const rows = await prisma.quickService.findMany({
      where: {
        OR: [{ serverId: null }, { server: { teamId } }],
      },
      orderBy: { name: "asc" },
    });
    return rows.map((r) => mapQuickService(r, mode));
  }
  const rows = await prisma.quickService.findMany({ orderBy: { name: "asc" } });
  return rows.map((r) => mapQuickService(r, mode));
}

function mapQuickService(
  r: {
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
    instanceKey?: string;
    serverId?: string | null;
  },
  mode: ExportMode = "standard",
) {
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
    // Standard exports must not leak service secrets (API tokens, root passwords, etc.).
    envJson: mode === "full" ? r.envJson : "{}",
    volumesJson: mode === "full" ? r.volumesJson : "[]",
    status: r.status,
    createdAt: dateToISO(r.createdAt)!,
    instanceKey: r.instanceKey ?? "hub-host",
    serverId: r.serverId ?? null,
  };
}

export async function exportPlaybooks(
  scope: ExportScope,
  teamId: string | null,
) {
  const where = scope === "team" && teamId ? teamScopedWhere(teamId) : {};
  const rows = await prisma.playbook.findMany({
    where,
    orderBy: { name: "asc" },
  });
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

export async function exportAlertRules(
  scope: ExportScope,
  teamId: string | null,
) {
  const where = scope === "team" && teamId ? teamScopedWhere(teamId) : {};
  const rows = await prisma.alertRule.findMany({
    where,
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    metric: r.metric,
    operator: r.operator,
    threshold: r.threshold,
    durationSeconds: r.durationSeconds,
    serverIds: r.serverIds,
    notifyChannels: r.notifyChannels,
    playbookIds: r.playbookIds,
    webhookUrl: r.webhookUrl,
    cooldownMinutes: r.cooldownMinutes,
    silenceWindows: r.silenceWindows,
    escalationMinutes: r.escalationMinutes,
    onCallUserIds: r.onCallUserIds,
    enabled: r.enabled,
    teamId: r.teamId ?? null,
    createdAt: dateToISO(r.createdAt)!,
  }));
}

export async function exportSettings(mode: ExportMode, scope: ExportScope) {
  if (scope === "team") return [];
  const rows = await prisma.setting.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({
    key: r.key,
    value:
      mode === "full" ? r.value : isSensitiveSettingKey(r.key) ? "" : r.value,
  }));
}

export async function exportAiProviders(mode: ExportMode, scope: ExportScope) {
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

export async function exportAnnouncements(scope: ExportScope) {
  if (scope === "team") return [];
  const rows = await prisma.announcement.findMany({
    orderBy: { createdAt: "desc" },
  });
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

export async function exportSnippets(
  scope: ExportScope,
  memberUserIds: string[],
) {
  if (scope === "team") {
    if (memberUserIds.length === 0) return [];
    const rows = await prisma.snippet.findMany({
      // Snippet has no teamId yet, so team exports must derive ownership from
      // the creator directory. Public visibility is not export ownership.
      where: { createdBy: { in: memberUserIds } },
      orderBy: { title: "asc" },
    });
    return rows.map(mapSnippet);
  }
  const rows = await prisma.snippet.findMany({ orderBy: { title: "asc" } });
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
