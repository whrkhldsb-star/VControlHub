/**
 * TR-042: 系统配置导入服务 — 客户（团队）、身份模板、客户成员与逐服务器授权。
 *
 * Ids were aligned with this instance beforehand (import-id-alignment), so a
 * customer whose slug exists here is that customer.
 */

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { parseDate, upsertById, upsertByIdWithSecondaryUnique } from "./import-executors-helpers";
import type { Counts, Tx } from "./import-executors-helpers";

const idSet = async (rows: Promise<Array<{ id: string }>>) => new Set((await rows).map((row) => row.id));

// Customers (before every resource that carries a teamId)
export async function importTeams(tx: Tx, t: ExportFile["tables"], options: ImportOptions, counts: Counts): Promise<void> {
  await upsertByIdWithSecondaryUnique(t.teams, options, counts, {
    listExistingIds: (ids) => idSet(tx.team.findMany({ where: { id: { in: ids } }, select: { id: true } })),
    listTakenSecondaryValues: async (values) =>
      new Set((await tx.team.findMany({ where: { slug: { in: values } }, select: { slug: true } })).map((row) => row.slug)),
    secondaryValueOf: (r) => r.slug,
    createManySkipDuplicates: async (rows) =>
      (await tx.team.createMany({ data: rows.map((r) => ({ id: r.id, slug: r.slug, name: r.name, description: r.description, deletedAt: r.deletedAt ? parseDate(r.deletedAt, "teams.deletedAt") : null })), skipDuplicates: true })).count,
    hasSecondaryClash: async (r) => Boolean(await tx.team.findFirst({ where: { slug: r.slug, NOT: { id: r.id } }, select: { id: true } })),
    updateById: async (r) => {
      await tx.team.update({ where: { id: r.id }, data: { slug: r.slug, name: r.name, description: r.description, deletedAt: r.deletedAt ? parseDate(r.deletedAt, "teams.deletedAt") : null } });
    },
  });
}

// Identity templates. Built-in ones are maintained by the application itself
// (same ids everywhere): created when missing, never overwritten.
export async function importIdentityTemplates(tx: Tx, t: ExportFile["tables"], options: ImportOptions, counts: Counts): Promise<void> {
  await upsertById(t.identityTemplates, options, counts, {
    listExistingIds: (ids) => idSet(tx.identityTemplate.findMany({ where: { id: { in: ids } }, select: { id: true } })),
    createManySkipDuplicates: async (rows) =>
      (await tx.identityTemplate.createMany({
        data: rows.map((r) => ({ id: r.id, name: r.name, description: r.description, permissions: r.permissions, isBuiltin: r.isBuiltin })),
        skipDuplicates: true,
      })).count,
    updateById: async (r) => {
      await tx.identityTemplate.updateMany({ where: { id: r.id, isBuiltin: false }, data: { name: r.name, description: r.description, permissions: r.permissions } });
    },
  });
}

// Customer memberships (after users and templates). A user belongs to one
// customer: an existing membership is kept unless overwriting.
export async function importTeamMembers(tx: Tx, t: ExportFile["tables"], options: ImportOptions, counts: Counts): Promise<void> {
  const records = t.teamMembers;
  if (records.length === 0) return;
  const [teams, users, templates, existing] = await Promise.all([
    idSet(tx.team.findMany({ where: { id: { in: [...new Set(records.map((r) => r.teamId))] } }, select: { id: true } })),
    idSet(tx.user.findMany({ where: { id: { in: [...new Set(records.map((r) => r.userId))] } }, select: { id: true } })),
    idSet(tx.identityTemplate.findMany({ where: { id: { in: [...new Set(records.map((r) => r.identityTemplateId))] } }, select: { id: true } })),
    tx.teamMember.findMany({ where: { userId: { in: records.map((r) => r.userId) } }, select: { userId: true } }),
  ]);
  const member = new Set(existing.map((row) => row.userId));
  for (const r of records) {
    if (!teams.has(r.teamId) || !users.has(r.userId) || !templates.has(r.identityTemplateId)) {
      counts.skipped += 1;
      continue;
    }
    if (member.has(r.userId)) {
      if (!options.overwriteExisting) {
        counts.skipped += 1;
        continue;
      }
      await tx.teamMember.update({ where: { userId: r.userId }, data: { teamId: r.teamId, identityTemplateId: r.identityTemplateId } });
      counts.updated += 1;
      continue;
    }
    await tx.teamMember.create({ data: { teamId: r.teamId, userId: r.userId, identityTemplateId: r.identityTemplateId, joinedAt: parseDate(r.joinedAt, "teamMembers.joinedAt") } });
    member.add(r.userId);
    counts.created += 1;
  }
}

// Per-server permissions (after users and servers).
export async function importUserServerAccess(tx: Tx, t: ExportFile["tables"], options: ImportOptions, counts: Counts): Promise<void> {
  const records = t.userServerAccess;
  if (records.length === 0) return;
  const [users, servers, existing] = await Promise.all([
    idSet(tx.user.findMany({ where: { id: { in: [...new Set(records.map((r) => r.userId))] } }, select: { id: true } })),
    idSet(tx.server.findMany({ where: { id: { in: [...new Set(records.map((r) => r.serverId))] } }, select: { id: true } })),
    tx.userServerAccess.findMany({ where: { userId: { in: [...new Set(records.map((r) => r.userId))] } }, select: { userId: true, serverId: true } }),
  ]);
  const present = new Set(existing.map((row) => `${row.userId}:${row.serverId}`));
  for (const r of records) {
    if (!users.has(r.userId) || !servers.has(r.serverId)) {
      counts.skipped += 1;
      continue;
    }
    const flags = { canRead: r.canRead, canConnect: r.canConnect, canManage: r.canManage, canFileRead: r.canFileRead, canFileWrite: r.canFileWrite, canFileDelete: r.canFileDelete };
    if (present.has(`${r.userId}:${r.serverId}`)) {
      if (!options.overwriteExisting) {
        counts.skipped += 1;
        continue;
      }
      await tx.userServerAccess.update({ where: { userId_serverId: { userId: r.userId, serverId: r.serverId } }, data: flags });
      counts.updated += 1;
      continue;
    }
    await tx.userServerAccess.create({ data: { userId: r.userId, serverId: r.serverId, ...flags } });
    counts.created += 1;
  }
}
