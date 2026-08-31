import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";

/** dryRun 预览的单表统计。 */
export type PreviewCounts = { create: number; update: number; skip: number };

const ZERO: PreviewCounts = { create: 0, update: 0, skip: 0 };
const CHUNK = 500;

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
): Promise<PreviewCounts> {
  if (records.length === 0) return { ...ZERO };
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
): Promise<PreviewCounts> {
  if (records.length === 0) return { ...ZERO };
  const existingKeys = await chunkedExistingKeys(records.map((r) => r[keyName]), keyName, findMany);
  const existingCount = records.filter((r) => existingKeys.has(r[keyName])).length;
  const newCount = records.length - existingCount;
  if (options.overwriteExisting) return { create: newCount, update: existingCount, skip: 0 };
  return { create: newCount, update: 0, skip: existingCount };
}

/**
 * Mirror of the executors' secondary-unique handling.
 *
 * Every id-keyed executor also owns a unique business key (permission.key,
 * role.key, user.username, sshKey.fingerprint) and *skips* a row whose key is
 * already held by a different live row, because inserting it would violate the
 * unique index and roll the whole bundle back. A preview that ignored this
 * promised "create" for rows the import will refuse.
 */
async function previewByIdAndSecondaryKey<T extends { id: string }>(
  records: T[],
  options: ImportOptions,
  findIds: (chunk: string[]) => Promise<{ id: string }[]>,
  keyOf: (record: T) => string | null,
  findByKeys: (chunk: string[]) => Promise<{ id: string; key: string | null }[]>,
): Promise<PreviewCounts> {
  if (records.length === 0) return { ...ZERO };
  const existingIds = await chunkedExistingIds(records.map((r) => r.id), findIds);

  const keys = [...new Set(records.map(keyOf).filter((k): k is string => Boolean(k)))];
  const ownerByKey = new Map<string, string>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const rows = await findByKeys(keys.slice(i, i + CHUNK));
    for (const row of rows) {
      if (row.key !== null) ownerByKey.set(row.key, row.id);
    }
  }

  const out: PreviewCounts = { create: 0, update: 0, skip: 0 };
  for (const record of records) {
    const key = keyOf(record);
    const owner = key === null ? undefined : ownerByKey.get(key);
    if (!existingIds.has(record.id)) {
      // A live row already owns this key under a different id.
      if (owner === undefined) out.create += 1;
      else out.skip += 1;
    } else if (!options.overwriteExisting) {
      out.skip += 1;
    } else if (owner !== undefined && owner !== record.id) {
      out.skip += 1;
    } else {
      out.update += 1;
    }
  }
  return out;
}

/**
 * Resolve which foreign keys a join/child table can point at *after* the import.
 *
 * The executors run in dependency order, so a role that only exists in the
 * bundle is already in the database by the time rolePermissions runs. Checking
 * the live database alone would report every row of a first-time import as
 * skipped — and `totalRecords === 0` disables the Execute button, so the
 * operator could not import at all. The bundle's own ids count as available,
 * except for tables the options exclude (users under `importUsers: false` are
 * never created, so their children really are skipped).
 */
async function availableIds(
  referenced: string[],
  bundleIds: string[],
  findIds: (chunk: string[]) => Promise<{ id: string }[]>,
): Promise<Set<string>> {
  const unique = [...new Set(referenced)];
  const live = await chunkedExistingIds(unique, findIds);
  for (const id of bundleIds) live.add(id);
  return live;
}

// ── 预览辅助函数 ──────────────────────────────────────────
//
// 每张表使用单次 batch findMany 替代 N 次 per-record findUnique，
// 统计将创建/更新/跳过的记录数，不实际写入数据库。

export async function previewPermissions(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  return previewByIdAndSecondaryKey(
    t.permissions,
    options,
    (ids) => prisma.permission.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (r) => r.key,
    (keys) => prisma.permission.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    }),
  );
}

export async function previewRoles(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  return previewByIdAndSecondaryKey(
    t.roles,
    options,
    (ids) => prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (r) => r.key,
    (keys) => prisma.role.findMany({
      where: { key: { in: keys } },
      select: { id: true, key: true },
    }),
  );
}

export async function previewRolePermissions(
  t: ExportFile["tables"],
): Promise<PreviewCounts> {
  const records = t.rolePermissions;
  if (records.length === 0) return { ...ZERO };
  const roleIds = [...new Set(records.map((r) => r.roleId))];
  const [existing, roles, permissions] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      select: { roleId: true, permissionId: true },
    }),
    availableIds(
      records.map((r) => r.roleId),
      t.roles.map((r) => r.id),
      (ids) => prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    ),
    availableIds(
      records.map((r) => r.permissionId),
      t.permissions.map((r) => r.id),
      (ids) => prisma.permission.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    ),
  ]);
  const existingPairs = new Set(existing.map((e) => `${e.roleId}:${e.permissionId}`));
  const out: PreviewCounts = { create: 0, update: 0, skip: 0 };
  for (const r of records) {
    // A grant is a pure join row: it is either inserted or skipped, never updated.
    if (existingPairs.has(`${r.roleId}:${r.permissionId}`)) out.skip += 1;
    else if (!roles.has(r.roleId) || !permissions.has(r.permissionId)) out.skip += 1;
    else out.create += 1;
  }
  return out;
}

export async function previewUsers(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  return previewByIdAndSecondaryKey(
    t.users,
    options,
    (ids) => prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (r) => r.username,
    (keys) => prisma.user.findMany({
      where: { username: { in: keys } },
      select: { id: true, username: true },
    }).then((rows) => rows.map((row) => ({ id: row.id, key: row.username }))),
  );
}

export async function previewUserRoles(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.userRoles;
  if (records.length === 0) return { ...ZERO };
  const userIds = [...new Set(records.map((r) => r.userId))];
  const [existing, users, roles] = await Promise.all([
    prisma.userRole.findMany({
      where: { userId: { in: userIds } },
      select: { userId: true, roleId: true },
    }),
    availableIds(
      records.map((r) => r.userId),
      // Users are not created at all when the option is off, so their role
      // assignments really will be skipped.
      options.importUsers ? t.users.map((r) => r.id) : [],
      (ids) => prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    ),
    availableIds(
      records.map((r) => r.roleId),
      t.roles.map((r) => r.id),
      (ids) => prisma.role.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    ),
  ]);
  const existingPairs = new Set(existing.map((e) => `${e.userId}:${e.roleId}`));
  const out: PreviewCounts = { create: 0, update: 0, skip: 0 };
  for (const r of records) {
    if (existingPairs.has(`${r.userId}:${r.roleId}`)) out.skip += 1;
    else if (!users.has(r.userId) || !roles.has(r.roleId)) out.skip += 1;
    else out.create += 1;
  }
  return out;
}

export async function previewSshKeys(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  return previewByIdAndSecondaryKey(
    t.sshKeys,
    options,
    (ids) => prisma.sshKey.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (r) => r.fingerprint,
    (keys) => prisma.sshKey.findMany({
      where: { fingerprint: { in: keys } },
      select: { id: true, fingerprint: true },
    }).then((rows) => rows.map((row) => ({ id: row.id, key: row.fingerprint }))),
  );
}

export async function previewServers(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.servers;
  return previewById(records, options, (ids) => prisma.server.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewStorageNodes(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.storageNodes;
  return previewById(records, options, (ids) => prisma.storageNode.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewUserStorageAccess(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.userStorageAccess;
  if (records.length === 0) return { ...ZERO };
  const [existingIds, users, nodes] = await Promise.all([
    chunkedExistingIds(records.map((r) => r.id), (ids) => prisma.userStorageAccess.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    })),
    availableIds(
      records.map((r) => r.userId),
      options.importUsers ? t.users.map((r) => r.id) : [],
      (ids) => prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    ),
    availableIds(
      records.map((r) => r.storageNodeId),
      t.storageNodes.map((r) => r.id),
      (ids) => prisma.storageNode.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    ),
  ]);
  const out: PreviewCounts = { create: 0, update: 0, skip: 0 };
  for (const r of records) {
    if (existingIds.has(r.id)) {
      if (options.overwriteExisting) out.update += 1;
      else out.skip += 1;
      continue;
    }
    // FK pre-filter: the executor skips a grant pointing at a missing user or node.
    if (!users.has(r.userId) || !nodes.has(r.storageNodeId)) out.skip += 1;
    else out.create += 1;
  }
  return out;
}

export async function previewCommandTemplates(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.commandTemplates;
  return previewById(records, options, (ids) => prisma.commandTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewQuickServices(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.quickServices;
  return previewById(records, options, (ids) => prisma.quickService.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewPlaybooks(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.playbooks;
  if (records.length === 0) return { ...ZERO };
  return previewById(records, options, (ids) => prisma.playbook.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewAlertRules(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.alertRules;
  if (records.length === 0) return { ...ZERO };
  return previewById(records, options, (ids) => prisma.alertRule.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewSettings(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.settings;
  if (records.length === 0) return { ...ZERO };
  return previewByKey(records, "key", options, (keys) => prisma.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true },
  }));
}

export async function previewAiProviders(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.aiProviders;
  if (records.length === 0) return { ...ZERO };
  return previewById(records, options, (ids) => prisma.aiProvider.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewAnnouncements(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.announcements;
  if (records.length === 0) return { ...ZERO };
  return previewById(records, options, (ids) => prisma.announcement.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}

export async function previewSnippets(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.snippets;
  if (records.length === 0) return { ...ZERO };
  return previewById(records, options, (ids) => prisma.snippet.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
}
