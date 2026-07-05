import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";

// ── 预览辅助函数 ──────────────────────────────────────────
//
// 每张表使用单次 batch findMany 替代 N 次 per-record findUnique，
// 统计将创建/更新/跳过的记录数，不实际写入数据库。

export async function previewPermissions(
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

export async function previewRoles(
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

export async function previewRolePermissions(
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

export async function previewUsers(
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

export async function previewUserRoles(
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

export async function previewSshKeys(
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

export async function previewServers(
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

export async function previewStorageNodes(
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

export async function previewUserStorageAccess(
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

export async function previewCommandTemplates(
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

export async function previewQuickServices(
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

export async function previewPlaybooks(
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

export async function previewAlertRules(
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

export async function previewSettings(
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

export async function previewAiProviders(
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

export async function previewAnnouncements(
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

export async function previewSnippets(
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
