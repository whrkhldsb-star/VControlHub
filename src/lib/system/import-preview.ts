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

import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions, ImportPreview } from "@/lib/system/config-schema";

// ── 预览辅助函数 ──────────────────────────────────────────
//
// 每张表使用单次 batch findMany 替代 N 次 per-record findUnique，
// 统计将创建/更新/跳过的记录数，不实际写入数据库。

async function previewPermissions(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.permissions;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.permission.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewRoles(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.roles;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.role.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewRolePermissions(
  t: ExportFile["tables"],
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.rolePermissions;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const roleIds = [...new Set(records.map((r) => r.roleId))];
  const existing = await prisma.rolePermission.findMany({
    where: { roleId: { in: roleIds } },
    select: { roleId: true, permissionId: true },
  });
  const existingKeys = new Set(
    existing.map((e) => `${e.roleId}:${e.permissionId}`),
  );
  const existingCount = records.filter(
    (r) => existingKeys.has(`${r.roleId}:${r.permissionId}`),
  ).length;
  return { create: records.length - existingCount, update: 0, skip: existingCount };
}

async function previewUsers(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.users;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewUserRoles(
  t: ExportFile["tables"],
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.userRoles;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const userIds = [...new Set(records.map((r) => r.userId))];
  const existing = await prisma.userRole.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, roleId: true },
  });
  const existingKeys = new Set(
    existing.map((e) => `${e.userId}:${e.roleId}`),
  );
  const existingCount = records.filter(
    (r) => existingKeys.has(`${r.userId}:${r.roleId}`),
  ).length;
  return { create: records.length - existingCount, update: 0, skip: existingCount };
}

async function previewSshKeys(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.sshKeys;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.sshKey.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewServers(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.servers;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.server.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewStorageNodes(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.storageNodes;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.storageNode.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewUserStorageAccess(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.userStorageAccess;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.userStorageAccess.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewCommandTemplates(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.commandTemplates;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.commandTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewQuickServices(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.quickServices;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.quickService.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewPlaybooks(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.playbooks;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.playbook.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewAlertRules(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.alertRules;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.alertRule.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewSettings(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.settings;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const keys = records.map((r) => r.key);
  const existing = await prisma.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true },
  });
  const existingKeys = new Set(existing.map((e) => e.key));
  const existingCount = records.filter((r) => existingKeys.has(r.key)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewAiProviders(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.aiProviders;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.aiProvider.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewAnnouncements(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.announcements;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.announcement.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
}

async function previewSnippets(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.snippets;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const ids = records.map((r) => r.id);
  const existing = await prisma.snippet.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) {
    return { create: newCount, update: existingCount, skip: 0 };
  }
  return { create: newCount, update: 0, skip: existingCount };
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
