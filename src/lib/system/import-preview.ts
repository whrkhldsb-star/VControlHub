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

import type { ExportFile, ImportOptions, ImportPreview } from "@/lib/system/config-schema";

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
} as const;

// ── 预览模式 ──────────────────────────────────────────────

/**
 * 计算 dryRun 预览：对每张表统计将创建/更新/跳过多少条记录，
 * 不实际写入数据库。
 */
export async function previewImport(
  file: ExportFile,
  options: ImportOptions,
): Promise<ImportPreview> {
  const t = file.tables;
  const summary: ImportPreview["summary"] = {};
  const warnings: string[] = [];
  let totalRecords = 0;

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
    const r = await previewRolePermissions(t);
    summary[T.rolePermissions] = r;
    totalRecords += r.create;
  }

  // ── Users ──
  {
    if (options.importUsers) {
      const r = await previewUsers(t, options);
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

  // ── SshKeys ──
  {
    const r = await previewSshKeys(t, options);
    summary[T.sshKeys] = r;
    totalRecords += r.create + r.update;
  }

  // ── Servers ──
  {
    const r = await previewServers(t, options);
    summary[T.servers] = r;
    totalRecords += r.create + r.update;
  }

  // ── StorageNodes ──
  {
    const r = await previewStorageNodes(t, options);
    summary[T.storageNodes] = r;
    totalRecords += r.create + r.update;
  }

  // ── UserStorageAccess ──
  {
    const r = await previewUserStorageAccess(t, options);
    summary[T.storageAccess] = r;
    totalRecords += r.create + r.update;
  }

  // ── CommandTemplates ──
  {
    const r = await previewCommandTemplates(t, options);
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
    const r = await previewPlaybooks(t, options);
    summary[T.playbooks] = r;
    totalRecords += r.create + r.update;
  }

  // ── AlertRules ──
  {
    const r = await previewAlertRules(t, options);
    summary[T.alertRules] = r;
    totalRecords += r.create + r.update;
  }

  // ── Settings ──
  {
    if (options.importSettings) {
      const r = await previewSettings(t, options);
      summary[T.settings] = r;
      totalRecords += r.create + r.update;
    } else {
      summary[T.settings] = { create: 0, update: 0, skip: t.settings.length };
      warnings.push(W.settingsSkipped);
    }
  }

  // ── AiProviders ──
  {
    const r = await previewAiProviders(t, options);
    summary[T.aiProviders] = r;
    totalRecords += r.create + r.update;
  }

  // ── Announcements ──
  {
    const r = await previewAnnouncements(t, options);
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
  if (!isFullMode) {
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
    warnings.push(W.fullModeSensitive);
  }

  return { summary, warnings, totalRecords };
}
