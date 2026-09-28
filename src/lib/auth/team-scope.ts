/**
 * TR-030 multi-tenant: team-scoped data filtering utilities.
 *
 * Central Prisma filters for tenant-owned records. Callers spread `teamWhere`
 * into their outermost `where` clause so a member only reaches the active team.
 *
 * Rules: platform admins may inspect all rows; everyone else sees exactly
 * their active workspace. A null teamId is quarantined legacy data, never an
 * implicit share across unrelated workspaces.
 *
 * Usage in a service:
 * ```ts
 * const where = { ...teamWhere(session), status: "PENDING_APPROVAL" };
 * ```
 */

import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

import type { SessionPayload } from "./session";
import type { Permission } from "./rbac";
import { t } from "@/lib/i18n/service-translations";
import { serverAccessWhere, type ServerAccessCapability } from "@/lib/server/resource-access";

export type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> & {
	permissions?: Permission[];
	currentTeamRole?: string | null;
};

/**
 * True when the actor may see/manage all tenants (global team admin).
 * Used by user-directory scoping and other cross-user surfaces.
 */
export function isGlobalTeamManager(session: TeamSession): boolean {
	return session.roles?.includes("admin") === true;
}

/** True for a platform admin or an owner/admin of the active workspace. */
export function isWorkspaceTeamManager(session: TeamSession): boolean {
	return isGlobalTeamManager(session) || Boolean(
		session.currentTeamId && (
			session.currentTeamRole === "owner"
			|| session.currentTeamRole === "admin"
			|| session.permissions?.includes("team:member:manage")
		),
	);
}

/**
 * Check whether a target has the built-in platform admin role before a
 * delegated manager changes its credentials or status.
 */
export async function userHoldsTeamManage(userId: string): Promise<boolean> {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { roles: { select: { role: { select: { key: true } } } } },
	});
	if (!user) return false;
	const assignedRoleKeys = user.roles.map((entry) => entry.role.key);
	return assignedRoleKeys.includes("admin");
}

/**
 * Returns a Prisma `where` fragment that filters by teamId.
 * Spread this into the outermost `where` on list queries.
 */
export function teamWhere(session: TeamSession): Record<string, unknown> {
	// Admins / team managers see all records
	if (isGlobalTeamManager(session)) {
		return {};
	}

	// Null-team rows are quarantined; genuinely shared templates use their own
	// explicit isBuiltin/public predicate at the call site.
	if (session.currentTeamId) {
		return { teamId: session.currentTeamId };
	}

	return { teamId: "__no_active_team__" };
}

/**
 * Optional-session wrapper for trusted internal workers. HTTP callers must
 * provide a session; a missing one deliberately means an unrestricted query.
 */
export function teamScopeWhere(session?: TeamSession | null): Record<string, unknown> {
	return session ? teamWhere(session) : {};
}

/** Server records are security roots (SSH, SFTP, backups and file proxy).
 * A null teamId is quarantined legacy data, never an implicit shared VPS. */
export function serverTeamWhere(session: TeamSession, capability: ServerAccessCapability = "read"): Record<string, unknown> {
	if (isGlobalTeamManager(session)) return {};
	return session.currentTeamId
		? isWorkspaceTeamManager(session)
			? { teamId: session.currentTeamId }
			: { AND: [{ teamId: session.currentTeamId }, serverAccessWhere(session.userId, capability)] }
		: { id: "__unassigned_servers_require_team_manage__" };
}

/** Command requests carry the command text and target-server refs — a security
 * root like the servers they run against. A null teamId is quarantined legacy
 * data (only global managers may read/cancel/approve it), never a shared request
 * every tenant can see. Mirrors {@link serverTeamWhere}. */
export function commandRequestTeamWhere(session: TeamSession): Record<string, unknown> {
	if (isGlobalTeamManager(session)) return {};
	return session.currentTeamId
		? { teamId: session.currentTeamId }
		: { id: "__unassigned_command_requests_require_team_manage__" };
}

/** A sync job binds two servers plus paths and can be executed on demand
 * (rsync, optionally with --delete). Reading one hydrates both servers together
 * with their SSH keys. A null teamId is quarantined legacy data, never a job
 * every tenant may read or run. Mirrors {@link serverTeamWhere}. */
export function syncJobTeamWhere(session: TeamSession): Record<string, unknown> {
	if (isGlobalTeamManager(session)) return {};
	return session.currentTeamId
		? { teamId: session.currentTeamId }
		: { id: "__unassigned_sync_jobs_require_team_manage__" };
}

/** A deployment run carries the rendered command text, its rollback snapshot and
 * the ids of the VPS it targets — and `createDeploymentRollbackRun` turns one back
 * into an executable command request. A null teamId is quarantined legacy data,
 * not a run every tenant may read or roll back. Mirrors {@link serverTeamWhere}. */
export function deploymentRunTeamWhere(session: TeamSession): Record<string, unknown> {
	if (isGlobalTeamManager(session)) return {};
	return session.currentTeamId
		? { teamId: session.currentTeamId }
		: { id: "__unassigned_deployments_require_team_manage__" };
}

/** A playbook contains executable server references. Null-team legacy
 * playbooks stay quarantined to platform administrators. */
export function playbookTeamWhere(session: TeamSession): Record<string, unknown> {
	if (isGlobalTeamManager(session)) return {};
	return session.currentTeamId
		? { teamId: session.currentTeamId }
		: { id: "__unassigned_playbooks_require_team_manage__" };
}

/** Image uploads are private by default. A null teamId is legacy data owned by
 * its uploader, not a shared image library visible to every tenant manager. */
export function imageTeamWhere(session: TeamSession): Record<string, unknown> {
	if (isGlobalTeamManager(session)) return {};
	return session.currentTeamId
		? { teamId: session.currentTeamId }
		: { id: "__unassigned_images_require_team_manage__" };
}

/** A storage node is a file-data security root: it carries the SFTP/WebDAV
 * backing credentials and every byte the hub can read or write on it. A null
 * teamId is quarantined legacy data — under the loose {@link teamWhere} any
 * tenant's storage_manager (or their API token via WebDAV) could open, upload
 * to, or share an unassigned node by id. Quarantine it to global managers,
 * mirroring {@link serverTeamWhere} and the share-link service's node filter. */
export function storageNodeTeamWhere(session: TeamSession): Record<string, unknown> {
	if (isGlobalTeamManager(session)) return {};
	return session.currentTeamId
		? { teamId: session.currentTeamId }
		: { id: "__unassigned_storage_nodes_require_team_manage__" };
}

/** A share link publishes a storage path on a node (and its access logs expose
 * downloader IPs/UAs). A null teamId is quarantined legacy data — under the
 * loose {@link teamWhere} every tenant's managers could list, read access
 * analytics for, and revoke another tenant's unassigned links. Mirrors
 * {@link serverTeamWhere}. */
export function shareLinkTeamWhere(session: TeamSession): Record<string, unknown> {
	if (isGlobalTeamManager(session)) return {};
	return session.currentTeamId
		? { teamId: session.currentTeamId }
		: { id: "__unassigned_share_links_require_team_manage__" };
}

/**
 * Prisma `where` for listing users in the directory UI/API.
 *
 * - `team:manage` → full directory
 * - current team set → self + members of that team
 * - no team context → self only (prevents global user enumeration)
 */
export function userDirectoryWhere(session: TeamSession): Record<string, unknown> {
	if (isGlobalTeamManager(session)) {
		return {};
	}
	if (session.currentTeamId) {
		return {
			OR: [
				{ id: session.userId },
				{ teamMemberships: { some: { teamId: session.currentTeamId } } },
			],
		};
	}
	return { id: session.userId };
}

/**
 * Ensure `userId` is visible to the actor under {@link userDirectoryWhere}.
 * Throws NotFoundError (404) for out-of-scope ids to avoid user-existence leaks.
 */
export async function assertUserInActorScope(
	session: TeamSession,
	userId: string,
): Promise<void> {
	if (isGlobalTeamManager(session)) return;
	if (userId === session.userId) return;
	if (!session.currentTeamId) {
		throw new NotFoundError(t("backend.team.userNotFound"));
	}
	const membership = await prisma.teamMember.findUnique({
		where: {
			teamId_userId: { teamId: session.currentTeamId, userId },
		},
		select: { userId: true },
	});
	if (!membership) {
		throw new NotFoundError(t("backend.team.userNotFound"));
	}
}

/**
 * When creating a record, use this to set the teamId on the new record.
 * An active workspace is required for every user-created tenant record.
 */
export function teamCreateData(
	session: Pick<SessionPayload, "currentTeamId">,
): { teamId?: string } {
	if (!session.currentTeamId) {
		throw new ForbiddenError(t("backend.team.activeTeamRequired"));
	}
	return { teamId: session.currentTeamId };
}

/**
 * Quarantine check: if a user tries to access a specific record by id,
 * this returns an additional `where` fragment to ensure the record
 * belongs to their team. Returns `undefined` if no team filter applies.
 */
export function teamAccessFilter(
	session: TeamSession,
): Record<string, unknown> | undefined {
	if (isGlobalTeamManager(session)) {
		return undefined;
	}
	if (session.currentTeamId) {
		return { teamId: session.currentTeamId };
	}
	return { teamId: "__no_active_team__" };
}
