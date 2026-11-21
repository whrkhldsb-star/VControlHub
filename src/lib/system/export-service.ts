import { apiCopy } from "@/lib/i18n/api-copy";
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
import { t } from "@/lib/i18n/service-translations";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isPlatformAdmin } from "./platform-admin";

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
  exportTeams,
  exportTeamMembers,
  exportIdentityTemplates,
  exportUserServerAccess,
  exportCommandTemplates,
  exportQuickServices,
  exportPlaybooks,
  exportAlertRules,
  exportSettings,
  exportAiProviders,
  exportAnnouncements,
  exportSnippets,
} from "./export-collectors";
import type { ExportMode, ExportScope } from "./export-types";

export type { ExportMode, ExportScope } from "./export-types";

export type ExportOptions = {
  sourceDomain: string;
  mode?: ExportMode;
  scope?: ExportScope;
  teamId?: string | null;
  session: SessionPayload;
};

export function resolveExportAuthorization(input: {
  session: SessionPayload;
  mode: ExportMode;
  scope: ExportScope;
  teamId?: string | null;
}): { mode: ExportMode; scope: ExportScope; teamId: string | null } {
  const { session } = input;
  let { mode, scope } = input;
  const platformAdmin = isPlatformAdmin(session);
  const teamId = platformAdmin
    ? (input.teamId ?? session.currentTeamId ?? null)
    : (session.currentTeamId ?? null);

  if (!platformAdmin && input.teamId && input.teamId !== teamId) {
    throw new ForbiddenError(t("backend.system.globalExportRequiresPlatformAdmin"));
  }

  if (mode === "full" && !platformAdmin) {
    throw new ForbiddenError(t("backend.system.fullExportWithSecretsRequiresPlatformAdmin"));
  }
  if (scope === "global" && !platformAdmin) {
    throw new ForbiddenError(t("backend.system.globalExportRequiresPlatformAdmin"));
  }
  if (scope === "team" && !teamId) {
    throw new ValidationError(apiCopy("apiCopy.no.current.team.selected.for.team.export.a4844e53"), { field: "teamId" });
  }
  if (!platformAdmin) {
    scope = "team";
    mode = "standard";
  }
  return { mode, scope, teamId: scope === "global" ? null : teamId };
}

/**
 * Build the export payload. The session is mandatory on purpose: the removed
 * `buildExportFile("domain")` overload defaulted to `scope: "global"` with no
 * authorization at all, so any future internal caller would have produced a
 * cross-tenant (and, with `mode: "full"`, secret-bearing) dump unnoticed.
 */
export async function buildExportFile(options: ExportOptions): Promise<ExportFile> {
  const sourceDomain = options.sourceDomain;
  const { mode, scope, teamId } = resolveExportAuthorization({
    session: options.session,
    mode: options.mode ?? "standard",
    scope: options.scope ?? "team",
    teamId: options.teamId,
  });

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    return collectExport(tx, sourceDomain, mode, scope, teamId);
  }, { isolationLevel: "RepeatableRead", maxWait: 20_000, timeout: 120_000 });
}

async function collectExport(tx: Prisma.TransactionClient, sourceDomain: string, mode: ExportMode, scope: ExportScope, teamId: string | null): Promise<ExportFile> {
  const users = await exportUsers(mode, scope, teamId, tx);
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
    exportPermissions(tx),
    exportRoles(tx),
    exportRolePermissions(tx),
    exportUserRoles(scope, userIds, tx),
    exportSshKeys(mode, scope, teamId, tx),
    exportServers(mode, scope, teamId, tx),
    exportStorageNodes(mode, scope, teamId, tx),
    exportCommandTemplates(scope, teamId, tx),
    exportQuickServices(mode, scope, teamId, tx),
    exportPlaybooks(mode, scope, teamId, tx),
    exportAlertRules(mode, scope, teamId, tx),
    exportSettings(mode, scope, tx),
    exportAiProviders(mode, scope, tx),
    exportAnnouncements(scope, tx),
    exportSnippets(scope, userIds, tx),
  ]);

  const storageNodeIds = storageNodes.map((n) => n.id);
  const userStorageAccess = await exportUserStorageAccess(scope, storageNodeIds, userIds, tx);
  const teams = await exportTeams(scope, teamId, tx);
  const teamMembers = await exportTeamMembers(teams.map((team) => team.id), userIds, tx);
  const [identityTemplates, userServerAccess] = await Promise.all([
    exportIdentityTemplates(scope, [...new Set(teamMembers.map((member) => member.identityTemplateId))], tx),
    exportUserServerAccess(userIds, servers.map((server) => server.id), tx),
  ]);

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    sourceDomain,
    exportMode: mode,
    exportScope: scope,
    exportTeamId: teamId,
    tables: {
      teams,
      identityTemplates,
      teamMembers,
      userServerAccess,
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
    teams: t.teams.length,
    identityTemplates: t.identityTemplates.length,
    teamMembers: t.teamMembers.length,
    userServerAccess: t.userServerAccess.length,
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
