import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { canBindServerKey, planAlertRuleImport } from "./import-reference-scope";
import { planQuickServiceImport } from "./import-quick-services";
import { loadServerGrants, loadStorageGrants, planServerGrantImport, planStorageGrantImport } from "./import-resource-grants";
import { previewMembershipImport, projectGrantUserScopes, projectOwnedRows, projectServers, projectUniqueImportRows } from "./import-preview-references";
import { canBindStorageServer, loadStorageServers } from "./import-storage-servers";

/** dryRun 预览的单表统计。 */
export type PreviewCounts = { create: number; update: number; skip: number };

const ZERO: PreviewCounts = { create: 0, update: 0, skip: 0 };
const CHUNK = 500;

function countsFromPlan(total: number, plan: Array<{ action: "create" | "update" }>): PreviewCounts {
  const create = plan.filter(({ action }) => action === "create").length;
  return { create, update: plan.length - create, skip: total - plan.length };
}

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
  const [existing, nodes] = await Promise.all([
    loadStorageGrants(prisma, records),
    projectOwnedRows(records.map((row) => row.storageNodeId), t.storageNodes, false, (ids) => prisma.storageNode.findMany({
      where: { id: { in: ids } }, select: { id: true, teamId: true },
    })),
  ]);
  const { users, movedUsers } = await projectGrantUserScopes([
    ...records.map((row) => row.userId), ...existing.map((row) => row.userId),
  ], t, options);
  const retained = existing.filter((row) => !movedUsers.has(row.userId));
  return countsFromPlan(records.length, planStorageGrantImport(records, retained, options, users, nodes));
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
  if (records.length === 0) return { ...ZERO };
  const servers = await projectServers(records.flatMap((row) => row.serverId ? [row.serverId] : []), t);
  const plan = await planQuickServiceImport(prisma, records, options, new Set(servers.keys()));
  return countsFromPlan(records.length, plan);
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
  const [servers, playbooks, { users }] = await Promise.all([
    projectServers(records.flatMap((row) => row.serverIds), t),
    projectOwnedRows(records.flatMap((row) => row.playbookIds ?? []), t.playbooks, options.overwriteExisting, (ids) => prisma.playbook.findMany({
      where: { id: { in: ids } }, select: { id: true, teamId: true },
    })),
    projectGrantUserScopes(records.flatMap((row) => row.onCallUserIds ?? []), t, options),
  ]);
  const plan = await planAlertRuleImport(prisma, records, options, servers, playbooks, users);
  return countsFromPlan(records.length, plan);
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

/**
 * By id and by slug, as the import does: a customer whose slug another one
 * already uses is skipped, not updated. Counted by id only, the preview
 * promised an update the import then skipped.
 */
export async function previewTeams(t: ExportFile["tables"], options: ImportOptions): Promise<PreviewCounts> {
  return previewByIdAndSecondaryKey(
    t.teams,
    options,
    (ids) => prisma.team.findMany({ where: { id: { in: ids } }, select: { id: true } }),
    (r) => r.slug,
    (keys) => prisma.team.findMany({ where: { slug: { in: keys } }, select: { id: true, slug: true } })
      .then((rows) => rows.map((row) => ({ id: row.id, key: row.slug }))),
  );
}

export async function previewIdentityTemplates(t: ExportFile["tables"], options: ImportOptions): Promise<PreviewCounts> {
  return previewById(t.identityTemplates, options, (ids) => prisma.identityTemplate.findMany({ where: { id: { in: ids } }, select: { id: true } }));
}

/** A user belongs to one customer: an existing membership is replaced only with overwrite. */
export async function previewTeamMembers(t: ExportFile["tables"], options: ImportOptions): Promise<PreviewCounts> {
  const plan = await previewMembershipImport(t, options);
  return countsFromPlan(t.teamMembers.length, plan);
}

export async function previewUserServerAccess(t: ExportFile["tables"], options: ImportOptions): Promise<PreviewCounts> {
  const records = t.userServerAccess;
  if (records.length === 0) return { ...ZERO };
  const [existing, servers, { users, movedUsers }] = await Promise.all([
    loadServerGrants(prisma, records),
    projectServers(records.map((row) => row.serverId), t),
    projectGrantUserScopes(records.map((row) => row.userId), t, options),
  ]);
  const retained = existing.filter((row) => !movedUsers.has(row.userId));
  return countsFromPlan(records.length, planServerGrantImport(records, retained, options, users, servers));
}

/** An explicit SSH key may be absent or belong to a different customer. */
export async function previewServerKeysMissing(t: ExportFile["tables"], options: ImportOptions): Promise<boolean> {
  let servers = t.servers.filter((row) => row.sshKeyId);
  if (servers.length === 0) return false;
  if (!options.overwriteExisting) {
    const existing = await chunkedExistingIds(servers.map((row) => row.id), (ids) => prisma.server.findMany({
      where: { id: { in: ids } }, select: { id: true },
    }));
    servers = servers.filter((row) => !existing.has(row.id));
  }
  const keys = await projectUniqueImportRows(servers.map((row) => row.sshKeyId!), t.sshKeys, false,
    (ids) => prisma.sshKey.findMany({ where: { id: { in: ids } }, select: { id: true, fingerprint: true, teamId: true } }),
    (fingerprints) => prisma.sshKey.findMany({ where: { fingerprint: { in: fingerprints } }, select: { id: true, fingerprint: true, teamId: true } }),
    (key) => key.fingerprint,
  );
  return servers.some((server) => {
    const key = keys.get(server.sshKeyId!);
    return !canBindServerKey(server, key && { teamId: key.teamId ?? null });
  });
}

/** Preview the server profiles the node import will see after the servers have been imported. */
export async function previewStorageServersMissing(t: ExportFile["tables"], options: ImportOptions): Promise<boolean> {
  if (!t.storageNodes.some(node => node.serverId)) return false;
  const servers = await loadStorageServers(prisma, t.storageNodes);
  for (const row of t.servers) {
    const existing = servers.get(row.id);
    if (!existing || options.overwriteExisting) {
      servers.set(row.id, {
        teamId: row.teamId ?? null,
        managementMode: row.managementMode ?? existing?.managementMode ?? "DIRECT",
      });
    }
  }
  return t.storageNodes.some(node => !!node.serverId && !canBindStorageServer(node, servers.get(node.serverId)));
}
