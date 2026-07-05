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
    summary["权限"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Roles ──
  {
    const r = await previewRoles(t, options);
    summary["角色"] = r;
    totalRecords += r.create + r.update;
  }

  // ── RolePermissions ──
  {
    const r = await previewRolePermissions(t);
    summary["角色权限"] = r;
    totalRecords += r.create;
  }

  // ── Users ──
  {
    if (options.importUsers) {
      const r = await previewUsers(t, options);
      summary["用户"] = r;
      totalRecords += r.create + r.update;
    } else {
      summary["用户"] = { create: 0, update: 0, skip: t.users.length };
      warnings.push("已跳过用户导入（按选项设置）");
    }
  }

  // ── UserRoles ──
  {
    const r = await previewUserRoles(t);
    summary["用户角色"] = r;
    totalRecords += r.create;
  }

  // ── SshKeys ──
  {
    const r = await previewSshKeys(t, options);
    summary["SSH 密钥"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Servers ──
  {
    const r = await previewServers(t, options);
    summary["服务器"] = r;
    totalRecords += r.create + r.update;
  }

  // ── StorageNodes ──
  {
    const r = await previewStorageNodes(t, options);
    summary["存储节点"] = r;
    totalRecords += r.create + r.update;
  }

  // ── UserStorageAccess ──
  {
    const r = await previewUserStorageAccess(t, options);
    summary["存储访问"] = r;
    totalRecords += r.create + r.update;
  }

  // ── CommandTemplates ──
  {
    const r = await previewCommandTemplates(t, options);
    summary["命令模板"] = r;
    totalRecords += r.create + r.update;
  }

  // ── QuickServices ──
  {
    const r = await previewQuickServices(t, options);
    summary["快捷服务"] = r;
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
    summary["告警规则"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Settings ──
  {
    if (options.importSettings) {
      const r = await previewSettings(t, options);
      summary["系统设置"] = r;
      totalRecords += r.create + r.update;
    } else {
      summary["系统设置"] = { create: 0, update: 0, skip: t.settings.length };
      warnings.push("已跳过系统设置导入（按选项设置）");
    }
  }

  // ── AiProviders ──
  {
    const r = await previewAiProviders(t, options);
    summary["AI 提供者"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Announcements ──
  {
    const r = await previewAnnouncements(t, options);
    summary["公告"] = r;
    totalRecords += r.create + r.update;
  }

  // ── Snippets ──
  {
    const r = await previewSnippets(t, options);
    summary["代码片段"] = r;
    totalRecords += r.create + r.update;
  }

  // 安全警告 — only show for standard mode (full mode includes secrets)
  const isFullMode = file.exportMode === "full";
  if (!isFullMode) {
    if (t.users.length > 0) {
      warnings.push("用户密码哈希已剥离，导入后需重新设置密码");
    }
    if (t.sshKeys.length > 0) {
      warnings.push("SSH 私钥已剥离，导入后需重新上传或粘贴私钥");
    }
    if (t.servers.length > 0) {
      warnings.push("服务器密码已剥离，导入后需重新填写（或使用 SSH 密钥）");
    }
    if (t.aiProviders.length > 0) {
      warnings.push("AI 提供者 API Key 已剥离，导入后需重新填写");
    }
    if (t.settings.some((s) => s.value === "")) {
      warnings.push("部分敏感系统设置值已清空，导入后需重新配置");
    }
  } else {
    warnings.push("⚠ 此文件为完整导出模式，包含密码、密钥等敏感信息，请妥善保管");
  }

  return { summary, warnings, totalRecords };
}
