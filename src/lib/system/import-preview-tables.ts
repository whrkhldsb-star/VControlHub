import { planUniqueImport } from "./import-unique-rows";
import { planAiProviders, planSnippets, writableSetting } from "./import-config-plan";
import { playbookStepReferences, scopedPlaybooks, writableCommandTemplates } from "./import-executors-automation";
import { prisma } from "@/lib/db";
import { importPlaybooksSchema, type ExportFile, type ImportOptions, type ImportIssue } from "@/lib/system/config-schema";
import { byId, loadImportReferences, canBindServerKey, projectUniqueImportRows, planAlertRuleImport } from "./import-reference-scope";
import { planQuickServiceImport } from "./import-quick-services";
import { loadServerGrants, loadStorageGrants, planServerGrantImport, planStorageGrantImport } from "./import-resource-grants";
import { previewMembershipImport, projectGrantUserScopes, projectOwnedRows, projectServers, projectUserIds } from "./import-preview-references";
import { canBindStorageServer, loadStorageServers, planStorageNodes } from "./import-storage-servers";

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
  return countsFromPlan(records.length, planUniqueImport(records, [...existingIds].map((id) => ({ id, key: id })), (r) => r.id, options.overwriteExisting));
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
  const keys = new Set(records.map((r) => r[keyName]));
  const existing = [...keys].filter((key) => existingKeys.has(key)).length;
  const create = keys.size - existing;
  const update = options.overwriteExisting ? existing : 0;
  return { create, update, skip: records.length - create - update };
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
  allowUpdate?: (row: T) => boolean,
): Promise<PreviewCounts> {
  if (records.length === 0) return { ...ZERO };
  const existingIds = await chunkedExistingIds(records.map((r) => r.id), findIds);

  const keys = [...new Set(records.map(keyOf).filter((k): k is string => k !== null))];
  const ownerByKey = new Map<string, string>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const rows = await findByKeys(keys.slice(i, i + CHUNK));
    for (const row of rows) {
      if (row.key !== null) ownerByKey.set(row.key, row.id);
    }
  }

  const existing = new Map([...existingIds].map((id) => [id, JSON.stringify([id])]));
  for (const [key, id] of ownerByKey) existing.set(id, JSON.stringify(key));
  const plan = planUniqueImport(records, [...existing].map(([id, key]) => ({ id, key })),
    (r) => JSON.stringify(keyOf(r) ?? [r.id]), options.overwriteExisting);
  return countsFromPlan(records.length, allowUpdate ? plan.filter(({ row, action }) => action !== "update" || allowUpdate(row)) : plan);
}

function projectCatalog(ids: string[], t: ExportFile["tables"], model: "role" | "permission", overwrite: boolean) {
  const rows = model === "role" ? t.roles : t.permissions;
  const find = (where: { id?: { in: string[] }; key?: { in: string[] } }) => {
    const query = { where, select: { id: true, key: true } } as const;
    return model === "role" ? prisma.role.findMany(query) : prisma.permission.findMany(query);
  };
  return projectUniqueImportRows(ids, rows, overwrite, (chunk) => find({ id: { in: chunk } }),
    (chunk) => find({ key: { in: chunk } }), (r) => r.key);
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
  options: Pick<ImportOptions, "overwriteExisting"> = { overwriteExisting: true },
): Promise<PreviewCounts> {
  const records = t.rolePermissions;
  if (records.length === 0) return { ...ZERO };
  const roleIds = [...new Set(records.map((r) => r.roleId))];
  const [existing, roles, permissions] = await Promise.all([
    prisma.rolePermission.findMany({
      where: { roleId: { in: roleIds } },
      select: { roleId: true, permissionId: true },
    }),
    projectCatalog(roleIds, t, "role", options.overwriteExisting),
    projectCatalog(records.map((r) => r.permissionId), t, "permission", options.overwriteExisting),
  ]);
  const existingPairs = new Set(existing.map((e) => JSON.stringify([e.roleId, e.permissionId])));
  const out: PreviewCounts = { create: 0, update: 0, skip: 0 };
  for (const r of records) {
    // A grant is a pure join row: it is either inserted or skipped, never updated.
    if (existingPairs.has(JSON.stringify([r.roleId, r.permissionId]))) out.skip += 1;
    else if (!roles.has(r.roleId) || !permissions.has(r.permissionId)) out.skip += 1;
    else { existingPairs.add(JSON.stringify([r.roleId, r.permissionId])); out.create += 1; }
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
    projectUserIds(userIds, t, options),
    projectCatalog(records.map((r) => r.roleId), t, "role", options.overwriteExisting),
  ]);
  const existingPairs = new Set(existing.map((e) => JSON.stringify([e.userId, e.roleId])));
  const out: PreviewCounts = { create: 0, update: 0, skip: 0 };
  for (const r of records) {
    if (existingPairs.has(JSON.stringify([r.userId, r.roleId]))) out.skip += 1;
    else if (!users.has(r.userId) || !roles.has(r.roleId)) out.skip += 1;
    else { existingPairs.add(JSON.stringify([r.userId, r.roleId])); out.create += 1; }
  }
  return out;
}

function sameOwner(table: ImportIssue["table"], row: { id: string; teamId?: string | null }, live: { teamId: string | null }, issues: ImportIssue[]) {
  if ((row.teamId ?? null) === (live.teamId ?? null)) return true;
  issues.push({ table, id: row.id, reason: "nav.customerLabel", blocking: true,
    ownerMismatch: { incoming: row.teamId ?? null, existing: live.teamId } });
  return false;
}

export async function previewSshKeys(t: ExportFile["tables"], options: ImportOptions, issues: ImportIssue[] = []): Promise<PreviewCounts> {
  const existing = byId(await loadImportReferences(t.sshKeys.map((r) => r.id), (ids) => prisma.sshKey.findMany({
    where: { id: { in: ids } }, select: { id: true, teamId: true, publicKey: true, fingerprint: true },
  })));
  return previewByIdAndSecondaryKey(t.sshKeys, options, async () => [...existing.values()], (r) => r.fingerprint,
    (keys) => prisma.sshKey.findMany({ where: { fingerprint: { in: keys } }, select: { id: true, fingerprint: true } })
      .then((rows) => rows.map((r) => ({ id: r.id, key: r.fingerprint }))),
    (row) => {
      const live = existing.get(row.id)!;
      if (!sameOwner("sshKeys", row, live, issues)) return false;
      if (!row.privateKey && (live.publicKey !== row.publicKey || live.fingerprint !== row.fingerprint)) {
        issues.push({ table: "sshKeys", id: row.id, reason: "backend.server.sshPublicKeyMismatch", blocking: true });
        return false;
      }
      return true;
    });
}

export async function previewServers(t: ExportFile["tables"], options: ImportOptions, issues: ImportIssue[] = []): Promise<PreviewCounts> {
  const existing = byId(await loadImportReferences(t.servers.map((r) => r.id), (ids) => prisma.server.findMany({
    where: { id: { in: ids } }, select: { id: true, teamId: true },
  })));
  const plan = planUniqueImport(t.servers, [...existing.keys()].map((id) => ({ id, key: id })), (row) => row.id, options.overwriteExisting);
  return countsFromPlan(t.servers.length, plan.filter(({ row, action }) => action === "create" || sameOwner("servers", row, existing.get(row.id)!, issues)));
}

async function projectedStoragePlan(t: ExportFile["tables"], options: ImportOptions) {
  return planStorageNodes(prisma, t.storageNodes, options.overwriteExisting, await projectStorageServers(t, options));
}

export async function previewStorageNodes(t: ExportFile["tables"], options: ImportOptions, issues: ImportIssue[] = []): Promise<PreviewCounts> {
  const { existing, plan } = await projectedStoragePlan(t, options);
  return countsFromPlan(t.storageNodes.length, plan.filter(({ row, action }) => action === "create" || sameOwner("storageNodes", row, existing.get(row.id)!, issues)));
}

export async function previewUserStorageAccess(
  t: ExportFile["tables"],
  options: ImportOptions,
): Promise<PreviewCounts> {
  const records = t.userStorageAccess;
  if (records.length === 0) return { ...ZERO };
  const { plan } = await projectedStoragePlan(t, options);
  const [existing, nodes] = await Promise.all([
    loadStorageGrants(prisma, records),
    projectOwnedRows(records.map((row) => row.storageNodeId), plan.map(({ row }) => row), false, (ids) => prisma.storageNode.findMany({
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
  const records = await writableCommandTemplates(prisma, t.commandTemplates);
  const counts = await previewById(records, options, (ids) => prisma.commandTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  }));
  return { ...counts, skip: counts.skip + t.commandTemplates.length - records.length };
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

async function projectedPlaybooks(t: ExportFile["tables"], options: ImportOptions) {
  const parsed = importPlaybooksSchema.parse(t.playbooks);
  const { serverIds, recipientIds } = playbookStepReferences(parsed);
  const [servers, { users }] = await Promise.all([projectServers(serverIds, t), projectGrantUserScopes(recipientIds, t, options)]);
  return scopedPlaybooks(parsed, servers, users);
}

export async function previewPlaybooks(t: ExportFile["tables"], options: ImportOptions): Promise<PreviewCounts> {
  const records = await projectedPlaybooks(t, options);
  const counts = await previewById(records, options, (ids) => prisma.playbook.findMany({ where: { id: { in: ids } }, select: { id: true } }));
  return { ...counts, skip: counts.skip + t.playbooks.length - records.length };
}

export async function previewAlertRules(
  t: ExportFile["tables"],
  options: ImportOptions, mode?: ExportFile["exportMode"], issues: ImportIssue[] = [],
): Promise<PreviewCounts> {
  const records = t.alertRules;
  if (records.length === 0) return { ...ZERO };
  const [servers, playbooks, { users }] = await Promise.all([
    projectServers(records.flatMap((row) => row.serverIds), t),
    projectOwnedRows(records.flatMap((row) => row.playbookIds ?? []), await projectedPlaybooks(t, options), options.overwriteExisting, (ids) => prisma.playbook.findMany({
      where: { id: { in: ids } }, select: { id: true, teamId: true },
    })),
    projectGrantUserScopes(records.flatMap((row) => row.onCallUserIds ?? []), t, options),
  ]);
  const plan = await planAlertRuleImport(prisma, records, options, servers, playbooks, users, mode);
  for (const { row, missingWebhook } of plan) if (missingWebhook) issues.push({ table: "alertRules", id: row.id, reason: "backend.alert.webhookUrlRequired" });
  return countsFromPlan(records.length, plan);
}

export async function previewSettings(t: ExportFile["tables"], options: ImportOptions, mode?: ExportFile["exportMode"]): Promise<PreviewCounts> {
  const records = t.settings.filter((r) => writableSetting(r, mode));
  const counts = await previewByKey(records, "key", options, (keys) => prisma.setting.findMany({
    where: { key: { in: keys } }, select: { key: true },
  }));
  return { ...counts, skip: counts.skip + t.settings.length - records.length };
}

export async function previewAiProviders(t: ExportFile["tables"], options: ImportOptions, issues: ImportIssue[] = []): Promise<PreviewCounts> {
  const { plan, defaults, peers } = await planAiProviders(prisma, t.aiProviders, options, (ids) => projectUserIds(ids, t, options));
  for (const peer of peers) {
    const winner = defaults.get(peer.createdBy);
    if (peer.isDefault && winner && winner !== peer.id) issues.push({ table: "aiProviders", id: peer.id, replacementId: winner, reason: "common.default" });
  }
  return countsFromPlan(t.aiProviders.length, plan);
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
  const plan = await planSnippets(prisma, t.snippets, options, (ids) => projectUserIds(ids, t, options));
  return countsFromPlan(t.snippets.length, plan);
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
  const live = byId(await loadImportReferences(t.identityTemplates.map((r) => r.id), (ids) => prisma.identityTemplate.findMany({
    where: { id: { in: ids } }, select: { id: true, isBuiltin: true },
  })));
  const records = t.identityTemplates.filter((r) => !live.get(r.id)?.isBuiltin);
  const plan = planUniqueImport(records, [...live.keys()].map((id) => ({ id, key: id })), (r) => r.id, options.overwriteExisting);
  return countsFromPlan(t.identityTemplates.length, plan);
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
  const keys = await projectUniqueImportRows(servers.map((row) => row.sshKeyId!), t.sshKeys, options.overwriteExisting,
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
  const servers = await projectStorageServers(t, options);
  return t.storageNodes.some(node => !!node.serverId && !canBindStorageServer(node, servers.get(node.serverId)));
}

async function projectStorageServers(t: ExportFile["tables"], options: ImportOptions) {
  const servers = await loadStorageServers(prisma, t.storageNodes);
  const existingIds = [...servers.keys()].map((id) => ({ id, key: id }));
  for (const { row } of planUniqueImport(t.servers, existingIds, (r) => r.id, options.overwriteExisting)) {
    const existing = servers.get(row.id);
    if (existing && existing.teamId !== (row.teamId ?? null)) continue;
    servers.set(row.id, {
      teamId: row.teamId ?? null,
      managementMode: row.managementMode ?? existing?.managementMode ?? "DIRECT",
    });
  }
  return servers;
}
