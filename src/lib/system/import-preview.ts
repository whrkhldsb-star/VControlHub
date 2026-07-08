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
    summary["Permissions"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Roles ──
  {
    const r = await previewRoles(t, options);
    summary["Roles"] = r;
    totalRecords += r.create + r.update;
  }

  // ── RolePermissions ──
  {
    const r = await previewRolePermissions(t);
    summary["Role Permissions"] = r;
    totalRecords += r.create;
  }

  // ── Users ──
  {
    if (options.importUsers) {
      const r = await previewUsers(t, options);
      summary["Users"] = r;
      totalRecords += r.create + r.update;
    } else {
      summary["Users"] = { create: 0, update: 0, skip: t.users.length };
      warnings.push("User import skipped (per option setting)");
    }
  }

  // ── UserRoles ──
  {
    const r = await previewUserRoles(t);
    summary["User Roles"] = r;
    totalRecords += r.create;
  }

  // ── SshKeys ──
  {
    const r = await previewSshKeys(t, options);
    summary["SSH Keys"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Servers ──
  {
    const r = await previewServers(t, options);
    summary["Servers"] = r;
    totalRecords += r.create + r.update;
  }

  // ── StorageNodes ──
  {
    const r = await previewStorageNodes(t, options);
    summary["Storage Nodes"] = r;
    totalRecords += r.create + r.update;
  }

  // ── UserStorageAccess ──
  {
    const r = await previewUserStorageAccess(t, options);
    summary["Storage Access"] = r;
    totalRecords += r.create + r.update;
  }

  // ── CommandTemplates ──
  {
    const r = await previewCommandTemplates(t, options);
    summary["Command Templates"] = r;
    totalRecords += r.create + r.update;
  }

  // ── QuickServices ──
  {
    const r = await previewQuickServices(t, options);
    summary["Quick Services"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Playbooks ──
  {
    const r = await previewPlaybooks(t, options);
    summary["Playbook"] = r;
    totalRecords += r.create + r.update;
  }

  // ── AlertRules ──
  {
    const r = await previewAlertRules(t, options);
    summary["Alert Rules"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Settings ──
  {
    if (options.importSettings) {
      const r = await previewSettings(t, options);
      summary["System Settings"] = r;
      totalRecords += r.create + r.update;
    } else {
      summary["System Settings"] = { create: 0, update: 0, skip: t.settings.length };
      warnings.push("System settings import skipped (per option setting)");
    }
  }

  // ── AiProviders ──
  {
    const r = await previewAiProviders(t, options);
    summary["AI Providers"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Announcements ──
  {
    const r = await previewAnnouncements(t, options);
    summary["Announcements"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Snippets ──
  {
    const r = await previewSnippets(t, options);
    summary["Snippets"] = r;
    totalRecords += r.create + r.update;
  }

  // 安全警告 — only show for standard mode (full mode includes secrets)
  const isFullMode = file.exportMode === "full";
  if (!isFullMode) {
    if (t.users.length > 0) {
      warnings.push("User password hashes have been stripped; passwords must be reset after import");
    }
    if (t.sshKeys.length > 0) {
      warnings.push("SSH private keys have been stripped; private keys must be re-uploaded or pasted after import");
    }
    if (t.servers.length > 0) {
      warnings.push("Server passwords have been stripped; passwords must be re-entered after import (or use SSH keys)");
    }
    if (t.aiProviders.length > 0) {
      warnings.push("AI provider API keys have been stripped; API keys must be re-entered after import");
    }
    if (t.settings.some((s) => s.value === "")) {
      warnings.push("Some sensitive system setting values have been cleared; they must be reconfigured after import");
    }
  } else {
    warnings.push("⚠ This file is in full export mode and contains sensitive information such as passwords and keys; please store it securely");
  }

  return { summary, warnings, totalRecords };
}
