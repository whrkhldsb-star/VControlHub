/**
 * TR-042: 系统配置导入服务
 *
 * 按依赖顺序事务性 upsert，支持 dryRun 预览（不写入）。
 * 敏感字段（passwordHash/privateKey/apiKey 等）在导出时已置 null，
 * 导入后需用户手动重新设置。
 *
 * 依赖顺序：
 *  Permission → Role → RolePermission
 *  → User → UserRole
 *  → SshKey → Server
 *  → StorageNode → UserStorageAccess
 *  → CommandTemplate → QuickService → Playbook → AlertRule
 *  → Setting → AiProvider → Announcement → Snippet
 */

import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions, ImportPreview } from "@/lib/system/config-schema";

// ── 类型与工具函数 ──────────────────────────────────────

/** Prisma 事务客户端类型（$transaction 回调中的 tx） */
type Tx = Prisma.TransactionClient;

/** 导入计数器，在各 helper 间共享并累加 */
type Counts = { created: number; updated: number; skipped: number };

function parseDate(s: string): Date {
  return new Date(s);
}

function parseBigInt(s: string | null): bigint | null {
  if (s === null || s === "") return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}

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

// ── 真实导入 ──────────────────────────────────────────────

type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
};

// ── 导入辅助函数 ──────────────────────────────────────────
//
// 每张表使用 batch findMany + createMany + per-record update
// 替代 N 次 per-record findUnique + create。
// N findUnique + N create → 1 findMany + 1 createMany + M updates（M = 已存在数）。

// 1. Permissions
async function importPermissions(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.permissions;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.permission.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.permission.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.permission.update({
        where: { id: r.id },
        data: { key: r.key, name: r.name, description: r.description },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 2. Roles
async function importRoles(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.roles;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.role.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.role.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.role.update({
        where: { id: r.id },
        data: { key: r.key, name: r.name, description: r.description },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 3. RolePermissions (create-only junction table, no try/catch)
async function importRolePermissions(
  tx: Tx,
  t: ExportFile["tables"],
  _options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.rolePermissions;
  if (records.length === 0) return;
  const result = await tx.rolePermission.createMany({
    data: records.map((r) => ({
      roleId: r.roleId,
      permissionId: r.permissionId,
    })),
    skipDuplicates: true,
  });
  counts.created += result.count;
  counts.skipped += records.length - result.count;
}

// 4. Users (可选，条件性密码处理)
async function importUsers(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  if (!options.importUsers) {
    counts.skipped += t.users.length;
    return;
  }
  const records = t.users;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.user.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        username: r.username,
        displayName: r.displayName,
        // Full mode: restore actual hash; Standard: force password reset
        passwordHash: r.passwordHash ?? "DISABLED_IMPORT_RESET",
        status: r.status as never,
        mustChangePassword: r.passwordHash ? r.mustChangePassword : true,
        twoFactorEnabled: r.twoFactorEnabled,
        twoFactorSecret: r.twoFactorSecret,
        preferences: r.preferences as Prisma.InputJsonValue | undefined,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.user.update({
        where: { id: r.id },
        data: {
          username: r.username,
          displayName: r.displayName,
          // In full mode, restore password hash; otherwise keep existing
          ...(r.passwordHash ? { passwordHash: r.passwordHash } : {}),
          status: r.status as never,
          mustChangePassword: r.mustChangePassword,
          twoFactorEnabled: r.twoFactorEnabled,
          // In full mode, restore 2FA secret; otherwise keep existing
          ...(r.twoFactorSecret !== null ? { twoFactorSecret: r.twoFactorSecret } : {}),
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 5. UserRoles (create-only junction table, FK try/catch → pre-filter FK validity)
async function importUserRoles(
  tx: Tx,
  t: ExportFile["tables"],
  _options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.userRoles;
  if (records.length === 0) return;

  // Batch existence check by composite key
  const userIds = [...new Set(records.map((r) => r.userId))];
  const existing = await tx.userRole.findMany({
    where: { userId: { in: userIds } },
    select: { userId: true, roleId: true },
  });
  const existingKeys = new Set(
    existing.map((e) => `${e.userId}:${e.roleId}`),
  );
  const toCreate = records.filter(
    (r) => !existingKeys.has(`${r.userId}:${r.roleId}`),
  );
  counts.skipped += records.length - toCreate.length;

  if (toCreate.length === 0) return;

  // Pre-filter FK validity (userId, roleId) — original used try/catch per record
  const createUserIds = [...new Set(toCreate.map((r) => r.userId))];
  const createRoleIds = [...new Set(toCreate.map((r) => r.roleId))];
  const validUsers = await tx.user.findMany({
    where: { id: { in: createUserIds } },
    select: { id: true },
  });
  const validRoles = await tx.role.findMany({
    where: { id: { in: createRoleIds } },
    select: { id: true },
  });
  const validUserIds = new Set(validUsers.map((u) => u.id));
  const validRoleIds = new Set(validRoles.map((r) => r.id));
  const validToCreate = toCreate.filter(
    (r) => validUserIds.has(r.userId) && validRoleIds.has(r.roleId),
  );
  // FK 不存在 → skip
  counts.skipped += toCreate.length - validToCreate.length;

  if (validToCreate.length > 0) {
    const result = await tx.userRole.createMany({
      data: validToCreate.map((r) => ({
        userId: r.userId,
        roleId: r.roleId,
        assignedAt: parseDate(r.assignedAt),
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
    counts.skipped += validToCreate.length - result.count;
  }
}

// 6. SshKeys
async function importSshKeys(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.sshKeys;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.sshKey.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.sshKey.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        name: r.name,
        fingerprint: r.fingerprint,
        publicKey: r.publicKey,
        privateKey: r.privateKey,
        passphrase: r.passphrase,
        description: r.description,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.sshKey.update({
        where: { id: r.id },
        data: {
          name: r.name,
          fingerprint: r.fingerprint,
          publicKey: r.publicKey,
          // Full mode: restore private key + passphrase; Standard: keep existing
          ...(r.privateKey ? { privateKey: r.privateKey } : {}),
          ...(r.passphrase !== null && r.passphrase !== undefined
            ? { passphrase: r.passphrase }
            : {}),
          description: r.description,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 7. Servers
async function importServers(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.servers;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.server.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.server.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        name: r.name,
        host: r.host,
        port: r.port,
        username: r.username,
        sshKeyId: r.sshKeyId,
        // Full mode: restore actual password; Standard: null
        password: r.password,
        description: r.description,
        tags: r.tags,
        enabled: r.enabled,
        connectionType: r.connectionType as never,
        publicUrl: r.publicUrl,
        fileProxyPort: r.fileProxyPort,
        osDialect: r.osDialect,
        osInfo: r.osInfo,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.server.update({
        where: { id: r.id },
        data: {
          name: r.name,
          host: r.host,
          port: r.port,
          username: r.username,
          // Full mode: restore password; Standard: keep existing
          ...(r.password ? { password: r.password } : {}),
          sshKeyId: r.sshKeyId,
          description: r.description,
          tags: r.tags,
          enabled: r.enabled,
          connectionType: r.connectionType as never,
          publicUrl: r.publicUrl,
          fileProxyPort: r.fileProxyPort,
          osDialect: r.osDialect,
          osInfo: r.osInfo,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 8. StorageNodes
async function importStorageNodes(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.storageNodes;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.storageNode.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.storageNode.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        name: r.name,
        driver: r.driver as never,
        isDefault: r.isDefault,
        basePath: r.basePath,
        directAccessMode: r.directAccessMode as never,
        publicBaseUrl: r.publicBaseUrl,
        directAccessExpiresSeconds: r.directAccessExpiresSeconds,
        host: r.host,
        port: r.port,
        username: r.username,
        serverId: r.serverId,
        healthStatus: r.healthStatus,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.storageNode.update({
        where: { id: r.id },
        data: {
          name: r.name,
          driver: r.driver as never,
          isDefault: r.isDefault,
          basePath: r.basePath,
          directAccessMode: r.directAccessMode as never,
          publicBaseUrl: r.publicBaseUrl,
          directAccessExpiresSeconds: r.directAccessExpiresSeconds,
          host: r.host,
          port: r.port,
          username: r.username,
          serverId: r.serverId,
          healthStatus: r.healthStatus,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 9. UserStorageAccess (FK try/catch on create → pre-filter FK validity)
async function importUserStorageAccess(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.userStorageAccess;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.userStorageAccess.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.userStorageAccess.update({
        where: { id: r.id },
        data: {
          userId: r.userId,
          storageNodeId: r.storageNodeId,
          pathPrefix: r.pathPrefix,
          canRead: r.canRead,
          canWrite: r.canWrite,
          canDelete: r.canDelete,
          quotaBytes: parseBigInt(r.quotaBytes),
          maxFileBytes: parseBigInt(r.maxFileBytes),
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }

  if (toCreate.length === 0) return;

  // Pre-filter FK validity (userId, storageNodeId) — original used try/catch per record
  const createUserIds = [...new Set(toCreate.map((r) => r.userId))];
  const createStorageNodeIds = [...new Set(toCreate.map((r) => r.storageNodeId))];
  const validUsers = await tx.user.findMany({
    where: { id: { in: createUserIds } },
    select: { id: true },
  });
  const validStorageNodes = await tx.storageNode.findMany({
    where: { id: { in: createStorageNodeIds } },
    select: { id: true },
  });
  const validUserIds = new Set(validUsers.map((u) => u.id));
  const validStorageNodeIds = new Set(validStorageNodes.map((s) => s.id));
  const validToCreate = toCreate.filter(
    (r) => validUserIds.has(r.userId) && validStorageNodeIds.has(r.storageNodeId),
  );
  // FK 不存在 → skip
  counts.skipped += toCreate.length - validToCreate.length;

  if (validToCreate.length > 0) {
    const result = await tx.userStorageAccess.createMany({
      data: validToCreate.map((r) => ({
        id: r.id,
        userId: r.userId,
        storageNodeId: r.storageNodeId,
        pathPrefix: r.pathPrefix,
        canRead: r.canRead,
        canWrite: r.canWrite,
        canDelete: r.canDelete,
        quotaBytes: parseBigInt(r.quotaBytes),
        maxFileBytes: parseBigInt(r.maxFileBytes),
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
    counts.skipped += validToCreate.length - result.count;
  }
}

// 10. CommandTemplates
async function importCommandTemplates(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.commandTemplates;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.commandTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.commandTemplate.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        command: r.command,
        rollbackCommand: r.rollbackCommand,
        variables: r.variables,
        tags: r.tags,
        isBuiltin: r.isBuiltin,
        createdById: r.createdById,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.commandTemplate.update({
        where: { id: r.id },
        data: {
          name: r.name,
          description: r.description,
          command: r.command,
          rollbackCommand: r.rollbackCommand,
          variables: r.variables,
          tags: r.tags,
          isBuiltin: r.isBuiltin,
          createdById: r.createdById,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 11. QuickServices
async function importQuickServices(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.quickServices;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.quickService.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.quickService.createMany({
      data: toCreate.map((r) => ({
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
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.quickService.update({
        where: { id: r.id },
        data: {
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
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 12. Playbooks
async function importPlaybooks(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.playbooks;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.playbook.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.playbook.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        triggerType: r.triggerType,
        triggerConfig: r.triggerConfig as Prisma.InputJsonValue,
        steps: r.steps as Prisma.InputJsonValue,
        chainRetry: r.chainRetry,
        enabled: r.enabled,
        createdById: r.createdById,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.playbook.update({
        where: { id: r.id },
        data: {
          name: r.name,
          description: r.description,
          triggerType: r.triggerType,
          triggerConfig: r.triggerConfig as Prisma.InputJsonValue,
          steps: r.steps as Prisma.InputJsonValue,
          chainRetry: r.chainRetry,
          enabled: r.enabled,
          createdById: r.createdById,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 13. AlertRules
async function importAlertRules(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.alertRules;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.alertRule.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.alertRule.createMany({
      data: toCreate.map((r) => ({
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
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.alertRule.update({
        where: { id: r.id },
        data: {
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
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 14. Settings (可选，key-based where，敏感 key 空值不覆盖)
async function importSettings(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  if (!options.importSettings) {
    counts.skipped += t.settings.length;
    return;
  }
  const records = t.settings;
  if (records.length === 0) return;
  const keys = records.map((r) => r.key);
  const existing = await tx.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true },
  });
  const existingKeys = new Set(existing.map((e) => e.key));
  const toCreate = records.filter((r) => !existingKeys.has(r.key));
  const toUpdate = records.filter((r) => existingKeys.has(r.key));

  if (toCreate.length > 0) {
    const result = await tx.setting.createMany({
      data: toCreate.map((r) => ({ key: r.key, value: r.value })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      // 敏感 key（空值）不覆盖
      if (r.value !== "") {
        await tx.setting.update({
          where: { key: r.key },
          data: { value: r.value },
        });
        counts.updated++;
      } else {
        counts.skipped++;
      }
    }
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 15. AiProviders (FK try/catch on create → pre-filter FK validity for createdBy)
async function importAiProviders(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.aiProviders;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.aiProvider.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.aiProvider.update({
        where: { id: r.id },
        data: {
          name: r.name,
          type: r.type as never,
          // Full mode: restore apiKey; Standard: keep existing
          ...(r.apiKey ? { apiKey: r.apiKey } : {}),
          baseUrl: r.baseUrl,
          defaultModel: r.defaultModel,
          availableModels: r.availableModels,
          isDefault: r.isDefault,
          enabled: r.enabled,
          settings: r.settings as Prisma.InputJsonValue,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }

  if (toCreate.length === 0) return;

  // Pre-filter FK validity (createdBy → User) — original used try/catch per record
  const createdByIds = [...new Set(toCreate.map((r) => r.createdBy))];
  const validUsers = await tx.user.findMany({
    where: { id: { in: createdByIds } },
    select: { id: true },
  });
  const validUserIds = new Set(validUsers.map((u) => u.id));
  const validToCreate = toCreate.filter((r) => validUserIds.has(r.createdBy));
  // FK 不存在 → skip
  counts.skipped += toCreate.length - validToCreate.length;

  if (validToCreate.length > 0) {
    const result = await tx.aiProvider.createMany({
      data: validToCreate.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type as never,
        apiKey: r.apiKey ?? "",
        baseUrl: r.baseUrl,
        defaultModel: r.defaultModel,
        availableModels: r.availableModels,
        isDefault: r.isDefault,
        enabled: r.enabled,
        settings: r.settings as Prisma.InputJsonValue,
        createdBy: r.createdBy,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
    counts.skipped += validToCreate.length - result.count;
  }
}

// 16. Announcements
async function importAnnouncements(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.announcements;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.announcement.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.announcement.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        level: r.level,
        pinned: r.pinned,
        published: r.published,
        startsAt: r.startsAt ? parseDate(r.startsAt) : new Date(),
        expiresAt: r.expiresAt ? parseDate(r.expiresAt) : null,
        createdBy: r.createdBy,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.announcement.update({
        where: { id: r.id },
        data: {
          title: r.title,
          body: r.body,
          level: r.level,
          pinned: r.pinned,
          published: r.published,
          startsAt: r.startsAt ? parseDate(r.startsAt) : undefined,
          expiresAt: r.expiresAt ? parseDate(r.expiresAt) : null,
          createdBy: r.createdBy,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 17. Snippets
async function importSnippets(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.snippets;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.snippet.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.snippet.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        language: r.language,
        content: r.content,
        tags: r.tags,
        isPrivate: r.isPrivate,
        createdBy: r.createdBy,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.snippet.update({
        where: { id: r.id },
        data: {
          title: r.title,
          description: r.description,
          language: r.language,
          content: r.content,
          tags: r.tags,
          isPrivate: r.isPrivate,
          createdBy: r.createdBy,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

/**
 * 按依赖顺序事务性导入所有配置表。
 * 整个导入在一个 Prisma 事务中完成，任一步骤失败则全部回滚。
 */
export async function executeImport(
  file: ExportFile,
  options: ImportOptions,
): Promise<ImportResult> {
  const t = file.tables;
  const counts: Counts = { created: 0, updated: 0, skipped: 0 };
  const errors: string[] = [];

  await prisma.$transaction(async (tx) => {
    // 1. Permissions
    await importPermissions(tx, t, options, counts);
    // 2. Roles
    await importRoles(tx, t, options, counts);
    // 3. RolePermissions
    await importRolePermissions(tx, t, options, counts);
    // 4. Users (可选)
    await importUsers(tx, t, options, counts);
    // 5. UserRoles
    await importUserRoles(tx, t, options, counts);
    // 6. SshKeys
    await importSshKeys(tx, t, options, counts);
    // 7. Servers
    await importServers(tx, t, options, counts);
    // 8. StorageNodes
    await importStorageNodes(tx, t, options, counts);
    // 9. UserStorageAccess
    await importUserStorageAccess(tx, t, options, counts);
    // 10. CommandTemplates
    await importCommandTemplates(tx, t, options, counts);
    // 11. QuickServices
    await importQuickServices(tx, t, options, counts);
    // 12. Playbooks
    await importPlaybooks(tx, t, options, counts);
    // 13. AlertRules
    await importAlertRules(tx, t, options, counts);
    // 14. Settings (可选)
    await importSettings(tx, t, options, counts);
    // 15. AiProviders
    await importAiProviders(tx, t, options, counts);
    // 16. Announcements
    await importAnnouncements(tx, t, options, counts);
    // 17. Snippets
    await importSnippets(tx, t, options, counts);
  }).catch((err: unknown) => {
    // 事务失败 → 记录错误，不部分提交
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`事务失败: ${msg}`);
    throw err;
  });

  return { created: counts.created, updated: counts.updated, skipped: counts.skipped, errors };
}
