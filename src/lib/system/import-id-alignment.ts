/**
 * Align a package's ids with the target instance before importing.
 *
 * Instances initialised separately give the same business object different
 * ids: role `admin`, a customer's slug, a username, an SSH key's fingerprint.
 * Importing by id then found the source id missing, could not create the row
 * because the business key was taken, skipped it, and every link to it
 * (a user's roles, a server's customer or key) was skipped or failed on its
 * foreign key with no error. Here each such object takes the target's id, and
 * every reference in the package is rewritten to it; the import that follows
 * then sees an existing row (updated only with overwrite, as for any other).
 */

import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import type { ExportFile } from "@/lib/system/config-schema";

import type { Tx } from "./import-executors-helpers";
import { loadGrantUserScopes } from "./import-reference-scope";
import { alignStorageNodeCustomer } from "./import-executors-infrastructure";

type Tables = ExportFile["tables"];
type Db = Pick<Tx, "permission" | "role" | "user" | "team" | "sshKey" | "identityTemplate">;
type IdMap = Map<string, string>;

/**
 * Source id → target id for records whose id is absent here but whose
 * business key belongs to another row. Ambiguous cases keep the source id:
 * the source id already exists here, or the target id is itself a source id.
 */
function mapByKey<R extends { id: string }>(
	records: R[],
	keyOf: (record: R) => string,
	target: Array<{ id: string; key: string }>,
	presentSourceIds: Set<string>,
): IdMap {
	const ambiguous = new Set([...repeatedKeys(target.map((row) => row.key)), ...repeatedKeys(records.map(keyOf))]);
	const targetByKey = new Map(target.map((row) => [row.key, row.id]));
	const sourceIds = new Set(records.map((record) => record.id));
	const map: IdMap = new Map();
	for (const record of records) {
		if (presentSourceIds.has(record.id) || ambiguous.has(keyOf(record))) continue;
		const targetId = targetByKey.get(keyOf(record));
		if (targetId && targetId !== record.id && !sourceIds.has(targetId)) map.set(record.id, targetId);
	}
	return map;
}

const CHUNK = 500;
async function inChunks<T>(values: string[], query: (chunk: string[]) => Promise<T[]>): Promise<T[]> {
	const rows: T[] = [];
	for (let i = 0; i < values.length; i += CHUNK) rows.push(...await query(values.slice(i, i + CHUNK)));
	return rows;
}

const unique = (values: string[]) => [...new Set(values)];

function repeatedKeys(names: string[]): Set<string> {
	const seen = new Set<string>();
	const repeated = new Set<string>();
	for (const name of names) {
		if (seen.has(name)) repeated.add(name);
		seen.add(name);
	}
	return repeated;
}

/** Check both ends before rewriting any references, including membership-only packages. */
async function assertAccountAlignment(db: Db, tables: Tables, userMap: IdMap, roleMap: IdMap) {
	const alignedUser = (id: string) => userMap.get(id) ?? id;
	const members = new Set(tables.teamMembers.map((row) => alignedUser(row.userId)));
	const adminRoleIds = new Set(tables.roles.filter((row) => row.key === "admin").map((row) => row.id));
	// A partial package can refer directly to the local admin role.
	const localAdmin = tables.userRoles.length ? await db.role.findUnique({ where: { key: "admin" }, select: { id: true } }) : null;
	const admins = new Set(tables.userRoles.filter((row) => adminRoleIds.has(row.roleId)
		|| (roleMap.get(row.roleId) ?? row.roleId) === localAdmin?.id).map((row) => alignedUser(row.userId)));
	const matched = new Set(userMap.values());
	const ids = new Set([...members, ...admins, ...matched]);
	const target = await loadGrantUserScopes(db, ids);
	for (const id of ids) {
		const local = target.get(id);
		if ((members.has(id) && (admins.has(id) || local?.isAdmin))
			|| (admins.has(id) && local?.teamId != null)
			|| (matched.has(id) && local?.isAdmin && !admins.has(id))) {
			throw new ValidationError(t("backend.system.importAccountTypeConflict", { id }));
		}
	}
}

export async function alignImportIds(db: Db, tables: Tables): Promise<Tables> {
	const [permissions, roles, users, teams, sshKeys, templates] = await Promise.all([
		inChunks(unique(tables.permissions.map((r) => r.key)), async (keys) =>
			(await db.permission.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } }))),
		inChunks(unique(tables.roles.map((r) => r.key)), async (keys) =>
			(await db.role.findMany({ where: { key: { in: keys } }, select: { id: true, key: true } }))),
		inChunks(unique(tables.users.map((r) => r.username)), async (keys) =>
			(await db.user.findMany({ where: { username: { in: keys } }, select: { id: true, username: true } })).map((r) => ({ id: r.id, key: r.username }))),
		inChunks(unique(tables.teams.map((r) => r.slug)), async (keys) =>
			(await db.team.findMany({ where: { slug: { in: keys } }, select: { id: true, slug: true } })).map((r) => ({ id: r.id, key: r.slug }))),
		inChunks(unique(tables.sshKeys.map((r) => r.fingerprint)), async (keys) =>
			(await db.sshKey.findMany({ where: { fingerprint: { in: keys } }, select: { id: true, fingerprint: true } })).map((r) => ({ id: r.id, key: r.fingerprint }))),
		// Template names are not unique in either instance.
		inChunks(unique(tables.identityTemplates.map((r) => r.name)), async (keys) =>
			(await db.identityTemplate.findMany({ where: { name: { in: keys } }, select: { id: true, name: true } })).map((r) => ({ id: r.id, key: r.name }))),
	]);
	// Id lookups catch "the source id already exists here" for each table.
	const presentIds = async (ids: string[], query: (chunk: string[]) => Promise<Array<{ id: string }>>) =>
		new Set((await inChunks(unique(ids), query)).map((row) => row.id));
	const [permissionIds, roleIds, userIds, teamIds, sshKeyIds, templateIds] = await Promise.all([
		presentIds(tables.permissions.map((r) => r.id), (ids) => db.permission.findMany({ where: { id: { in: ids } }, select: { id: true } })),
		presentIds(tables.roles.map((r) => r.id), (ids) => db.role.findMany({ where: { id: { in: ids } }, select: { id: true } })),
		presentIds(tables.users.map((r) => r.id), (ids) => db.user.findMany({ where: { id: { in: ids } }, select: { id: true } })),
		presentIds(tables.teams.map((r) => r.id), (ids) => db.team.findMany({ where: { id: { in: ids } }, select: { id: true } })),
		presentIds(tables.sshKeys.map((r) => r.id), (ids) => db.sshKey.findMany({ where: { id: { in: ids } }, select: { id: true } })),
		presentIds(tables.identityTemplates.map((r) => r.id), (ids) => db.identityTemplate.findMany({ where: { id: { in: ids } }, select: { id: true } })),
	]);
	const permissionMap = mapByKey(tables.permissions, (r) => r.key, permissions, permissionIds);
	const roleMap = mapByKey(tables.roles, (r) => r.key, roles, roleIds);
	const userMap = mapByKey(tables.users, (r) => r.username, users, userIds);
	await assertAccountAlignment(db, tables, userMap, roleMap);
	const teamMap = mapByKey(tables.teams, (r) => r.slug, teams, teamIds);
	const sshKeyMap = mapByKey(tables.sshKeys, (r) => r.fingerprint, sshKeys, sshKeyIds);
	const templateMap = mapByKey(tables.identityTemplates, (r) => r.name, templates, templateIds);

	const id = (map: IdMap) => (value: string) => map.get(value) ?? value;
	const maybe = (map: IdMap) => <T extends string | null | undefined>(value: T): T => (value ? (map.get(value) ?? value) : value) as T;
	const perm = id(permissionMap), role = id(roleMap), user = id(userMap), team = id(teamMap), key = id(sshKeyMap), template = id(templateMap);
	const userOrNull = maybe(userMap), teamOrNull = maybe(teamMap), keyOrNull = maybe(sshKeyMap);

	return {
		...tables,
		permissions: tables.permissions.map((r) => ({ ...r, id: perm(r.id) })),
		roles: tables.roles.map((r) => ({ ...r, id: role(r.id) })),
		rolePermissions: tables.rolePermissions.map((r) => ({ ...r, roleId: role(r.roleId), permissionId: perm(r.permissionId) })),
		users: tables.users.map((r) => ({ ...r, id: user(r.id) })),
		userRoles: tables.userRoles.map((r) => ({ ...r, userId: user(r.userId), roleId: role(r.roleId) })),
		teams: tables.teams.map((r) => ({ ...r, id: team(r.id) })),
		identityTemplates: tables.identityTemplates.map((r) => ({ ...r, id: template(r.id) })),
		teamMembers: tables.teamMembers.map((r) => ({ ...r, teamId: team(r.teamId), userId: user(r.userId), identityTemplateId: template(r.identityTemplateId) })),
		userServerAccess: tables.userServerAccess.map((r) => ({ ...r, userId: user(r.userId) })),
		sshKeys: tables.sshKeys.map((r) => ({ ...r, id: key(r.id), teamId: teamOrNull(r.teamId), createdById: userOrNull(r.createdById) })),
		servers: tables.servers.map((r) => ({ ...r, teamId: teamOrNull(r.teamId), sshKeyId: keyOrNull(r.sshKeyId) })),
		storageNodes: tables.storageNodes.map((r) => alignStorageNodeCustomer(r, teamOrNull(r.teamId))),
		userStorageAccess: tables.userStorageAccess.map((r) => ({ ...r, userId: user(r.userId) })),
		commandTemplates: tables.commandTemplates.map((r) => ({ ...r, teamId: teamOrNull(r.teamId), createdById: userOrNull(r.createdById) })),
		playbooks: tables.playbooks.map((r) => ({ ...r, teamId: teamOrNull(r.teamId), createdById: userOrNull(r.createdById) })),
		alertRules: tables.alertRules.map((r) => ({ ...r, teamId: teamOrNull(r.teamId), onCallUserIds: (r.onCallUserIds ?? []).map(user) })),
		aiProviders: tables.aiProviders.map((r) => ({ ...r, createdBy: user(r.createdBy) })),
		announcements: tables.announcements.map((r) => ({ ...r, createdBy: userOrNull(r.createdBy) })),
		snippets: tables.snippets.map((r) => ({ ...r, createdBy: userOrNull(r.createdBy) })),
	};
}

/**
 * Customer ids the package's resources point at that exist neither in the
 * package nor here: importing them would fail on the foreign key and roll the
 * whole import back (packages exported before customers were included).
 */
export async function findMissingTeamIds(db: Pick<Tx, "team">, tables: Tables): Promise<string[]> {
	const referenced = unique([
		...tables.sshKeys, ...tables.servers, ...tables.storageNodes, ...tables.commandTemplates, ...tables.playbooks, ...tables.alertRules,
	].map((row) => row.teamId).filter((teamId): teamId is string => Boolean(teamId)));
	const inPackage = new Set(tables.teams.map((team) => team.id));
	const outside = referenced.filter((teamId) => !inPackage.has(teamId));
	if (outside.length === 0) return [];
	const here = new Set((await inChunks(outside, (ids) => db.team.findMany({ where: { id: { in: ids } }, select: { id: true } }))).map((team) => team.id));
	return outside.filter((teamId) => !here.has(teamId));
}
