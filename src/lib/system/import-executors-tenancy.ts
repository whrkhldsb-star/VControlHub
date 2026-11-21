/**
 * TR-042: 系统配置导入服务 — 客户（团队）、身份模板、客户成员与逐服务器授权。
 *
 * Ids were aligned with this instance beforehand (import-id-alignment), so a
 * customer whose slug exists here is that customer.
 */

import { ValidationError } from "@/lib/errors";
import { t as translate } from "@/lib/i18n/service-translations";
import { applyCustomerMembership } from "@/lib/team/service";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { byId, loadGrantUserScopes, loadImportReferences } from "./import-reference-scope";
import { loadServerGrants, planServerGrantImport } from "./import-resource-grants";
import { loadTeamMemberships, planTeamMemberImport } from "./import-team-members";
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
      return (await tx.identityTemplate.updateMany({ where: { id: r.id, isBuiltin: false }, data: { name: r.name, description: r.description, permissions: r.permissions } })).count;
    },
  });
}

// Customer memberships (after users and templates). A user belongs to one
// customer: an existing membership is kept unless overwriting.
export async function importTeamMembers(tx: Tx, t: ExportFile["tables"], options: ImportOptions, counts: Counts): Promise<void> {
  const records = t.teamMembers;
  if (records.length === 0) return;
  const [teams, users, templates, members] = await Promise.all([
    idSet(loadImportReferences(records.map((r) => r.teamId), (ids) => tx.team.findMany({ where: { id: { in: ids } }, select: { id: true } }))),
    loadGrantUserScopes(tx, records.map((r) => r.userId)),
    idSet(loadImportReferences(records.map((r) => r.identityTemplateId), (ids) => tx.identityTemplate.findMany({ where: { id: { in: ids } }, select: { id: true } }))),
    loadTeamMemberships(tx, records),
  ]);
  const plan = planTeamMemberImport(records, options, members, new Set(users.keys()), teams, templates);
  for (const { row, action, moved } of plan) {
    const { teamId, userId, identityTemplateId } = row;
    if (users.get(userId)?.isAdmin) throw new ValidationError(translate("backend.system.importAccountTypeConflict", { id: userId }));
    if (action === "create") {
      await tx.teamMember.create({ data: { teamId, userId, identityTemplateId, joinedAt: parseDate(row.joinedAt, "teamMembers.joinedAt") } });
      counts.created += 1;
      continue;
    }
    if (moved) {
      await applyCustomerMembership(tx, { teamId, userId, identityTemplateId });
    } else {
      await tx.teamMember.update({ where: { userId }, data: { identityTemplateId } });
    }
    counts.updated += 1;
  }
  counts.skipped += records.length - plan.length;
}

// Per-server permissions (after users and servers).
export async function importUserServerAccess(tx: Tx, t: ExportFile["tables"], options: ImportOptions, counts: Counts): Promise<void> {
  const records = t.userServerAccess;
  if (records.length === 0) return;
  const [users, servers, existing] = await Promise.all([
    loadGrantUserScopes(tx, records.map((row) => row.userId)),
    loadImportReferences(records.map((row) => row.serverId), (ids) => tx.server.findMany({
      where: { id: { in: ids } }, select: { id: true, teamId: true },
    })).then(byId),
    loadServerGrants(tx, records),
  ]);
  const plan = planServerGrantImport(records, existing, options, users, servers);
  for (const { row, action } of plan) {
    const { userId, serverId, ...flags } = row;
    if (action === "update") {
      await tx.userServerAccess.update({ where: { userId_serverId: { userId, serverId } }, data: flags });
      counts.updated += 1;
    } else {
      await tx.userServerAccess.create({ data: { userId, serverId, ...flags } });
      counts.created += 1;
    }
  }
  counts.skipped += records.length - plan.length;
}
