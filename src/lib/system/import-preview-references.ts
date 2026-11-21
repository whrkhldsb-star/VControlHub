import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions } from "./config-schema";
import { byId, projectUniqueImportRows, projectTeamRows, loadGrantUsers, loadImportReferences, type GrantUser, type TeamOwner } from "./import-reference-scope";
import { loadTeamMemberships, planTeamMemberImport } from "./import-team-members";
import { planUniqueImport } from "./import-unique-rows";

type Tables = ExportFile["tables"];
type Member = Tables["teamMembers"][number];

export async function projectOwnedRows(
  ids: string[],
  bundled: Array<{ id: string; teamId?: string | null }>,
  overwrite: boolean,
  findById: (ids: string[]) => Promise<Array<{ id: string } & TeamOwner>>,
) {
  const wanted = new Set(ids);
  const live = byId(await loadImportReferences(wanted, findById));
  const incoming = bundled.filter((row) => wanted.has(row.id));
  const plan = planUniqueImport(incoming, [...live.keys()].map((id) => ({ id, key: id })), (row) => row.id, overwrite);
  for (const { row } of plan) live.set(row.id, { id: row.id, teamId: row.teamId ?? null });
  return live;
}

export function projectServers(ids: string[], tables: Tables) {
  // Updating a server or node cannot transfer ownership. Those writes are
  // guarded by teamId in the executors.
  return projectOwnedRows(ids, tables.servers, false, (chunk) => prisma.server.findMany({
    where: { id: { in: chunk } }, select: { id: true, teamId: true },
  }));
}

export async function projectUserIds(ids: string[], tables: Tables, options: ImportOptions) {
  const users = await projectUniqueImportRows(ids, options.importUsers ? tables.users : [], options.overwriteExisting,
    (chunk) => prisma.user.findMany({ where: { id: { in: chunk } }, select: { id: true, username: true } }),
    (chunk) => prisma.user.findMany({ where: { username: { in: chunk } }, select: { id: true, username: true } }),
    (user) => user.username,
  );
  return new Set([...new Set(ids)].filter((id) => users.has(id)));
}

async function membershipPlan(records: Member[], tables: Tables, options: ImportOptions, users: ReadonlySet<string>) {
  if (records.length === 0) return [];
  const [teams, templates, members] = await Promise.all([
    projectTeamRows(prisma, records.map((row) => row.teamId), tables.teams, options.overwriteExisting),
    loadImportReferences(records.map((row) => row.identityTemplateId), (ids) => prisma.identityTemplate.findMany({
      where: { id: { in: ids } }, select: { id: true },
    })),
    loadTeamMemberships(prisma, records),
  ]);
  const templateIds = new Set([...templates, ...tables.identityTemplates].map((row) => row.id));
  return planTeamMemberImport(records, options, members, users, new Set(teams.keys()), templateIds);
}

export async function previewMembershipImport(tables: Tables, options: ImportOptions) {
  const users = await projectUserIds(tables.teamMembers.map((row) => row.userId), tables, options);
  return membershipPlan(tables.teamMembers, tables, options, users);
}

export async function projectGrantUserScopes(ids: string[], tables: Tables, options: ImportOptions) {
  const users = new Map<string, GrantUser>();
  const movedUsers = new Set<string>();
  if (ids.length === 0) return { users, movedUsers };
  const [userIds, live] = await Promise.all([projectUserIds(ids, tables, options), loadGrantUsers(prisma, ids)]);
  const members = tables.teamMembers.filter((row) => userIds.has(row.userId));
  const incomingRoles = tables.userRoles.filter((row) => userIds.has(row.userId));
  const roles = live.flatMap((row) => row.roles.map(({ role }) => role));
  const [memberPlan, projectedRoles] = await Promise.all([
    membershipPlan(members, tables, options, userIds),
    projectUniqueImportRows([...roles.map((role) => role.id), ...incomingRoles.map((row) => row.roleId)], tables.roles, options.overwriteExisting,
      (chunk) => prisma.role.findMany({ where: { id: { in: chunk } }, select: { id: true, key: true } }),
      (chunk) => prisma.role.findMany({ where: { key: { in: chunk } }, select: { id: true, key: true } }),
      (role) => role.key,
    ),
  ]);
  for (const id of userIds) users.set(id, { teamId: null, isAdmin: false });
  for (const row of live) {
    users.set(row.id, {
      teamId: row.teamMembership?.teamId ?? null,
      isAdmin: row.roles.some(({ role }) => (projectedRoles.get(role.id)?.key ?? role.key) === "admin"),
    });
  }
  for (const row of incomingRoles) {
    if (projectedRoles.get(row.roleId)?.key === "admin") users.get(row.userId)!.isAdmin = true;
  }
  for (const { row, moved } of memberPlan) {
    users.get(row.userId)!.teamId = row.teamId;
    if (moved) movedUsers.add(row.userId);
  }
  return { users, movedUsers };
}
