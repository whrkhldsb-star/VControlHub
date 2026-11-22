/**
 * TR-042: 系统配置导入服务 — 预览模块（dryRun）。
 *
 * 对每张表使用单次 batch findMany 替代 N 次 per-record findUnique，
 * 统计将创建/更新/跳过的记录数，不实际写入数据库。
 *
 * 依赖顺序：
 *  Permission → Role → RolePermission
 *  → User → UserRole
 *  → SshKey → Server
 *  → StorageNode → UserStorageAccess
 *  → CommandTemplate → QuickService → Playbook → AlertRule
 *  → Setting → AiProvider → Announcement → Snippet
 */

import { decrypt, isEncrypted } from "@/lib/crypto/service";
import { prisma } from "@/lib/db";
import { parseImportFile, type ExportFile, type ImportIssue, type ImportOptions, type ImportPreview } from "@/lib/system/config-schema";

import { alignImportIds, findMissingTeamIds } from "./import-id-alignment";

import {
  previewPermissions,
  previewRoles,
  previewRolePermissions,
  previewUsers,
  previewUserRoles,
  previewSshKeys,
  previewServers,
  previewStorageNodes,
  previewUserStorageAccess,
  previewCommandTemplates,
  previewQuickServices,
  previewPlaybooks,
  previewAlertRules,
  previewSettings,
  previewAiProviders,
  previewAnnouncements,
  previewSnippets,
  previewTeams,
  previewIdentityTemplates,
  previewTeamMembers,
  previewUserServerAccess,
  previewServerKeysMissing,
  previewStorageServersMissing,
} from "./import-preview-tables";

/**
 * Both `summary` keys and `warnings` entries are i18n keys, not display text.
 * The preview is rendered verbatim in the settings UI, and a server-side `t()`
 * has no request locale here — it would pin every operator to zh. The client
 * translates these with its own locale instead.
 */
const T = {
  permissions: "systemConfig.import.preview.table.permissions",
  roles: "systemConfig.import.preview.table.roles",
  rolePermissions: "systemConfig.import.preview.table.rolePermissions",
  users: "systemConfig.import.preview.table.users",
  userRoles: "systemConfig.import.preview.table.userRoles",
  sshKeys: "systemConfig.import.preview.table.sshKeys",
  servers: "systemConfig.import.preview.table.servers",
  storageNodes: "systemConfig.import.preview.table.storageNodes",
  storageAccess: "systemConfig.import.preview.table.storageAccess",
  commandTemplates: "systemConfig.import.preview.table.commandTemplates",
  quickServices: "systemConfig.import.preview.table.quickServices",
  playbooks: "systemConfig.import.preview.table.playbooks",
  alertRules: "systemConfig.import.preview.table.alertRules",
  settings: "systemConfig.import.preview.table.settings",
  aiProviders: "systemConfig.import.preview.table.aiProviders",
  announcements: "systemConfig.import.preview.table.announcements",
  snippets: "systemConfig.import.preview.table.snippets",
  teams: "systemConfig.import.preview.table.teams",
  identityTemplates: "systemConfig.import.preview.table.identityTemplates",
  teamMembers: "systemConfig.import.preview.table.teamMembers",
  serverAccess: "systemConfig.import.preview.table.serverAccess",
} as const;

const W = {
  usersSkipped: "systemConfig.import.preview.warning.usersSkipped",
  settingsSkipped: "systemConfig.import.preview.warning.settingsSkipped",
  passwordsStripped: "systemConfig.import.preview.warning.passwordsStripped",
  sshKeysStripped: "systemConfig.import.preview.warning.sshKeysStripped",
  serverPasswordsStripped: "systemConfig.import.preview.warning.serverPasswordsStripped",
  aiKeysStripped: "systemConfig.import.preview.warning.aiKeysStripped",
  settingsCleared: "systemConfig.import.preview.warning.settingsCleared",
  fullModeSensitive: "systemConfig.import.preview.warning.fullModeSensitive",
  missingCustomers: "systemConfig.import.preview.warning.missingCustomers",
  agentReinstall: "systemConfig.import.preview.warning.agentReinstall",
  credentialsNeedSourceKey: "systemConfig.import.preview.warning.credentialsNeedSourceKey",
  legacyRecoveryCodes: "systemConfig.import.preview.warning.legacyRecoveryCodes",
  serverKeysMissing: "systemConfig.import.preview.warning.serverKeysMissing",
  storageServersMissing: "systemConfig.import.preview.warning.storageServersMissing",
} as const;

type CredentialTable = "servers" | "sshKeys" | "aiProviders" | "storageNodes" | "users" | "settings";
function credentialIssues(t: ExportFile["tables"], applied: Record<CredentialTable, Set<string>>) {
  const issues: ImportIssue[] = [];
  const tested = new Map<string, boolean>();
  function check(table: CredentialTable, id: string, values: Array<string | null | undefined>) {
    if (!applied[table].has(id)) return;
    for (const value of values) {
      if (!value) continue;
      if (!tested.has(value)) {
        try { decrypt(value); tested.set(value, true); } catch { tested.set(value, false); }
      }
      if (!tested.get(value)) {
        issues.push({ table, id, reason: W.credentialsNeedSourceKey });
        break;
      }
    }
  }
  const envelope = (value?: string | null) => value && isEncrypted(value) ? value : null;
  for (const r of t.servers) check("servers", r.id, [envelope(r.password?.replace(/^enc:v1:/, "")), envelope(r.rdpPassword)]);
  for (const r of t.sshKeys) check("sshKeys", r.id, [envelope(r.privateKey), envelope(r.passphrase)]);
  for (const r of t.aiProviders) check("aiProviders", r.id, [envelope(r.apiKey)]);
  for (const r of t.storageNodes) check("storageNodes", r.id, [r.webdavConfigEncrypted]);
  for (const r of t.users) check("users", r.id, [envelope(r.twoFactorSecret), ...(Array.isArray(r.twoFactorRecoveryCodes)
    ? r.twoFactorRecoveryCodes.flatMap((hash) => typeof hash === "string" && hash.startsWith("v2:") ? [hash.slice(3)] : []) : [])]);
  for (const r of t.settings) check("settings", r.key, [envelope(r.value)]);
  return issues;
}

// ── 预览模式 ──────────────────────────────────────────────

/**
 * 计算 dryRun 预览：对每张表统计将创建/更新/跳过多少条记录，
 * 不实际写入数据库。
 */
export async function previewImport(
  file: ExportFile,
  options: ImportOptions,
): Promise<ImportPreview> {
  // Counted as the import will see it: ids aligned with this instance first.
  const t = await alignImportIds(prisma, parseImportFile(file).tables, options.overwriteExisting);
  const summary: ImportPreview["summary"] = {};
  const warnings: string[] = [];
  const issues: ImportIssue[] = [];
  const applied = { servers: new Set<string>(), users: new Set<string>(), sshKeys: new Set<string>(), aiProviders: new Set<string>(),
    storageNodes: new Set<string>(), settings: new Set<string>() };
  let totalRecords = 0;

  // The import refuses a package whose resources name customers it cannot find.
  if ((await findMissingTeamIds(prisma, t, options.overwriteExisting)).length > 0) warnings.push(W.missingCustomers);
  if (t.servers.some((server) => server.managementMode === "AGENT")) warnings.push(W.agentReinstall);
  // What the import leaves out instead of failing on (import-executors-infrastructure).
  if (await previewServerKeysMissing(t, options)) warnings.push(W.serverKeysMissing);
  if (await previewStorageServersMissing(t, options)) warnings.push(W.storageServersMissing);

  // ── Permissions ──
  {
    const r = await previewPermissions(t, options);
    summary[T.permissions] = r;
    totalRecords += r.create + r.update;
  }

  // ── Roles ──
  {
    const r = await previewRoles(t, options);
    summary[T.roles] = r;
    totalRecords += r.create + r.update;
  }

  // ── RolePermissions ──
  {
    const r = await previewRolePermissions(t, options);
    summary[T.rolePermissions] = r;
    totalRecords += r.create;
  }

  // ── Customers and identity templates ──
  for (const [label, r] of [
    [T.teams, await previewTeams(t, options)],
    [T.identityTemplates, await previewIdentityTemplates(t, options)],
  ] as const) {
    summary[label] = r;
    totalRecords += r.create + r.update;
  }

  // ── Users ──
  {
    if (options.importUsers) {
      const r = await previewUsers(t, options, applied.users);
      summary[T.users] = r;
      totalRecords += r.create + r.update;
    } else {
      summary[T.users] = { create: 0, update: 0, skip: t.users.length };
      warnings.push(W.usersSkipped);
    }
  }

  // ── UserRoles ──
  {
    const r = await previewUserRoles(t, options);
    summary[T.userRoles] = r;
    totalRecords += r.create;
  }

  // ── Customer memberships ──
  {
    const r = await previewTeamMembers(t, options);
    summary[T.teamMembers] = r;
    totalRecords += r.create + r.update;
  }

  // ── SshKeys ──
  {
    const r = await previewSshKeys(t, options, issues, applied.sshKeys);
    summary[T.sshKeys] = r;
    totalRecords += r.create + r.update;
  }

  // ── Servers ──
  {
    const r = await previewServers(t, options, issues, applied.servers);
    summary[T.servers] = r;
    totalRecords += r.create + r.update;
  }

  // ── Per-server permissions ──
  {
    const r = await previewUserServerAccess(t, options);
    summary[T.serverAccess] = r;
    totalRecords += r.create + r.update;
  }

  // ── StorageNodes ──
  {
    const r = await previewStorageNodes(t, options, issues, applied.storageNodes);
    summary[T.storageNodes] = r;
    totalRecords += r.create + r.update;
  }

  // ── UserStorageAccess ──
  {
    const r = await previewUserStorageAccess(t, options, issues);
    summary[T.storageAccess] = r;
    totalRecords += r.create + r.update;
  }

  // ── CommandTemplates ──
  {
    const r = await previewCommandTemplates(t, options, issues);
    summary[T.commandTemplates] = r;
    totalRecords += r.create + r.update;
  }

  // ── QuickServices ──
  {
    const r = await previewQuickServices(t, options);
    summary[T.quickServices] = r;
    totalRecords += r.create + r.update;
  }

  // ── Playbooks ──
  {
    const r = await previewPlaybooks(t, options, issues);
    summary[T.playbooks] = r;
    totalRecords += r.create + r.update;
  }

  // ── AlertRules ──
  {
    const r = await previewAlertRules(t, options, file.exportMode, issues);
    summary[T.alertRules] = r;
    totalRecords += r.create + r.update;
  }

  // ── Settings ──
  {
    if (options.importSettings) {
      const r = await previewSettings(t, options, file.exportMode, issues, applied.settings);
      summary[T.settings] = r;
      totalRecords += r.create + r.update;
    } else {
      summary[T.settings] = { create: 0, update: 0, skip: t.settings.length };
      warnings.push(W.settingsSkipped);
    }
  }

  // ── AiProviders ──
  {
    const r = await previewAiProviders(t, options, issues, applied.aiProviders);
    summary[T.aiProviders] = r;
    totalRecords += r.create + r.update;
  }

  // ── Announcements ──
  {
    const r = await previewAnnouncements(t, options, issues);
    summary[T.announcements] = r;
    totalRecords += r.create + r.update;
  }

  // ── Snippets ──
  {
    const r = await previewSnippets(t, options);
    summary[T.snippets] = r;
    totalRecords += r.create + r.update;
  }

  // 安全警告 — only show for standard mode (full mode includes secrets)
  const isFullMode = file.exportMode === "full";
  if (file.exportMode === "standard") {
    if (t.users.length > 0) {
      warnings.push(W.passwordsStripped);
    }
    if (t.sshKeys.length > 0) {
      warnings.push(W.sshKeysStripped);
    }
    if (t.servers.length > 0) {
      warnings.push(W.serverPasswordsStripped);
    }
    if (t.aiProviders.length > 0) {
      warnings.push(W.aiKeysStripped);
    }
    if (t.settings.some((s) => s.value === "")) {
      warnings.push(W.settingsCleared);
    }
  } else {
    if (isFullMode) warnings.push(W.fullModeSensitive);
    if (options.importUsers && t.users.some((user) => Array.isArray(user.twoFactorRecoveryCodes) && user.twoFactorRecoveryCodes.some((hash) => typeof hash === "string" && !hash.startsWith("v2:")))) {
      warnings.push(W.legacyRecoveryCodes);
    }
    const failed = credentialIssues(t, applied);
    const reported = new Set(issues.filter((issue) => issue.reason === W.credentialsNeedSourceKey).map((issue) => JSON.stringify([issue.table, issue.id])));
    for (const issue of failed) {
      const key = JSON.stringify([issue.table, issue.id]);
      if (!reported.has(key)) { issues.push(issue); reported.add(key); }
    }
    if (issues.some((issue) => issue.reason === W.credentialsNeedSourceKey)) warnings.push(W.credentialsNeedSourceKey);
  }

  if (issues.some((issue) => issue.blocking) || warnings.includes(W.missingCustomers)) {
    for (const counts of Object.values(summary)) {
      counts.skip += counts.create + counts.update;
      counts.create = counts.update = 0;
    }
    totalRecords = 0;
  }
  return { summary, warnings, totalRecords, ...(issues.length ? { issues } : {}) };
}
