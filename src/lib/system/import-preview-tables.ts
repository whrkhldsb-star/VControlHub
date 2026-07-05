import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";

async function chunkedExistingIds<T extends { id: string }>(
  ids: string[],
  findMany: (chunk: string[]) => Promise<T[]>,
  chunkSize = 500,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < ids.length; i += chunkSize) {
    const rows = await findMany(ids.slice(i, i + chunkSize));
    for (const row of rows) out.add(row.id);
  }
  return out;
}

async function previewById<T extends { id: string }>(
  records: T[],
  options: ImportOptions,
  findMany: (chunk: string[]) => Promise<{ id: string }[]>,
): Promise<{ create: number; update: number; skip: number }> {
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const existingIds = await chunkedExistingIds(records.map((r) => r.id), findMany);
  const existingCount = records.filter((r) => existingIds.has(r.id)).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) return { create: newCount, update: existingCount, skip: 0 };
  return { create: newCount, update: 0, skip: existingCount };
}

async function chunkedExistingKeys<T extends Record<K, string>, K extends string>(
  keys: string[],
  keyName: K,
  findMany: (chunk: string[]) => Promise<T[]>,
  chunkSize = 500,
): Promise<Set<string>> {
  const out = new Set<string>();
  for (let i = 0; i < keys.length; i += chunkSize) {
    const rows = await findMany(keys.slice(i, i + chunkSize));
    for (const row of rows) out.add(row[keyName]);
  }
  return out;
}

async function previewByKey<T extends Record<K, string>, K extends string>(
  records: T[],
  keyName: K,
  options: ImportOptions,
  findMany: (chunk: string[]) => Promise<Record<K, string>[]>,
): Promise<{ create: number; update: number; skip: number }> {
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  const existingKeys = await chunkedExistingKeys(records.map((r) => r[keyName]), keyName, findMany);
  const existingCount = records.filter((r) => existingKeys.has(r[keyName])).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) return { create: newCount, update: existingCount, skip: 0 };
  return { create: newCount, update: 0, skip: existingCount };
}

// ── 预览辅助函数 ──────────────────────────────────────────
//
// 每张表使用单次 batch findMany 替代 N 次 per-record findUnique，
// 统计将创建/更新/跳过的记录数，不实际写入数据库。

export async function previewPermissions(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.permissions;
  return previewById(records, options, (ids) => prisma.permission.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewRoles(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.roles;
  return previewById(records, options, (ids) => prisma.role.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
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
  return previewById(records, options, (ids) => prisma.user.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
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
  return previewById(records, options, (ids) => prisma.sshKey.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewServers(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.servers;
  return previewById(records, options, (ids) => prisma.server.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewStorageNodes(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.storageNodes;
  return previewById(records, options, (ids) => prisma.storageNode.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewUserStorageAccess(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.userStorageAccess;
  return previewById(records, options, (ids) => prisma.userStorageAccess.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewCommandTemplates(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.commandTemplates;
  return previewById(records, options, (ids) => prisma.commandTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewQuickServices(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.quickServices;
  return previewById(records, options, (ids) => prisma.quickService.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewPlaybooks(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.playbooks;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  return previewById(records, options, (ids) => prisma.playbook.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewAlertRules(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.alertRules;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  return previewById(records, options, (ids) => prisma.alertRule.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewSettings(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.settings;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  return previewByKey(records, "key", options, (keys) => prisma.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true },
  }));
}

export async function previewAiProviders(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.aiProviders;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  return previewById(records, options, (ids) => prisma.aiProvider.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewAnnouncements(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.announcements;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  return previewById(records, options, (ids) => prisma.announcement.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewSnippets(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<{ create: number; update: number; skip: number }> {
  const records = t.snippets;
  if (records.length === 0) return { create: 0, update: 0, skip: 0 };
  return previewById(records, options, (ids) => prisma.snippet.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}
