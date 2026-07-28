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
 *
 * Per-table collectors live in ./export-collectors.ts.
 */

import {
  EXPORT_SCHEMA_VERSION,
  type ExportFile,
} from "@/lib/system/config-schema";
import type { SessionPayload } from "@/lib/auth/session";
import { ValidationError, ForbiddenError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";

import {
  exportPermissions,
  exportRoles,
  exportRolePermissions,
  exportUsers,
  exportUserRoles,
  exportSshKeys,
  exportServers,
  exportStorageNodes,
  exportUserStorageAccess,
  exportCommandTemplates,
  exportQuickServices,
  exportPlaybooks,
  exportAlertRules,
  exportSettings,
  exportAiProviders,
  exportAnnouncements,
  exportSnippets,
} from "./export-collectors";

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
    throw new ForbiddenError(t("backend.system.fullExportWithSecretsRequiresPlatformAdmin"));
  }
  if (scope === "global" && !isPlatformAdmin(session)) {
    throw new ForbiddenError(t("backend.system.globalExportRequiresPlatformAdmin"));
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
    exportQuickServices(mode, scope, teamId),
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
