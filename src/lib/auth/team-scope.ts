/**
 * TR-030 multi-tenant: team-scoped data filtering utilities.
 *
 * Central Prisma filters for tenant-owned records. Callers spread `teamWhere`
 * into their outermost `where` clause so a member only reaches the active team.
 *
 * Rules: a customer account sees exactly its customer. A platform admin sees
 * the customer it has selected, or every customer when none is selected
 * ("all customers"). A null teamId is quarantined legacy data, never an
 * implicit share across customers.
 *
 * Usage in a service:
 * ```ts
 * const where = { ...teamWhere(session), status: "PENDING_APPROVAL" };
 * ```
 */

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { ForbiddenError, NotFoundError } from "@/lib/errors";

import type { SessionPayload } from "./session";
import type { Permission } from "./rbac";
import { t } from "@/lib/i18n/service-translations";
import { serverAccessWhere, type ServerAccessCapability } from "@/lib/server/resource-access";

export type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId"> & {
	permissions?: Permission[];
};

/**
 * True for a platform administrator: it may see and manage every customer.
 * Used by user-directory scoping and other cross-customer surfaces.
 */
export function isGlobalTeamManager(session: TeamSession): boolean {
	return session.roles?.includes("admin") === true;
}

/** A platform admin in "all customers" mode: list filters do not narrow. */
export function seesAllCustomers(session: TeamSession): boolean {
	return isGlobalTeamManager(session) && !session.currentTeamId;
}

/**
 * Returns a Prisma `where` fragment that filters by teamId.
 * Spread this into the outermost `where` on list queries.
 */
export function teamWhere(session: TeamSession): { teamId?: string | { in: never[] }; AND?: { teamId: { in: never[] } } } {
	if (seesAllCustomers(session)) {
		return {};
	}

	// Null-team rows are quarantined; genuinely shared templates use their own
	// explicit isBuiltin/public predicate at the call site.
	if (session.currentTeamId) {
		return { teamId: session.currentTeamId };
	}

	// Some callers inspect teamId to decide whether the query is global.
	// Others supply a resource's teamId after spreading this scope. Keep the
	// empty set visible to the first group and enforced for the second.
	return { teamId: { in: [] }, AND: { teamId: { in: [] } } };
}

/** SQL equivalent of teamWhere for a tenant-owned column. */
export function rawTeamScope(session: TeamSession, column: Prisma.Sql) {
	if (seesAllCustomers(session)) return Prisma.sql`TRUE`;
	return session.currentTeamId ? Prisma.sql`${column} = ${session.currentTeamId}` : Prisma.sql`FALSE`;
}

/**
 * Rows that still belong to the live service: those of a live customer plus
 * null-team legacy rows. A deleted customer (`Team.deletedAt` set) keeps its
 * rows for ownership history, so health checks and status summaries must not
 * count or probe them. Spread into a `where` on any model with a `team` relation.
 */
export function liveCustomerRowsWhere(): Record<string, unknown> {
	return { OR: [{ teamId: null }, { team: { deletedAt: null } }] };
}

/**
 * Scope for security-root records (credentials, commands, file data): an
 * administrator viewing all customers sees every row, otherwise exactly the
 * selected customer. Keep the empty-set condition nested so merging a
 * caller's record id into the outer where cannot replace it.
 */
function strictCustomerScope(session: TeamSession): Record<string, unknown> {
	if (seesAllCustomers(session)) return {};
	return session.currentTeamId ? { teamId: session.currentTeamId } : { AND: { id: { in: [] } } };
}

/** Operational records with a Team relation exclude archived owners even
 * from an administrator's all-customer view. Null-owner legacy rows remain
 * visible only in that view. */
export function activeCustomerTeamWhere(session: TeamSession) {
	if (seesAllCustomers(session)) return { team: { isNot: { deletedAt: { not: null } } } };
	if (!session.currentTeamId) return { AND: { id: { in: [] } } };
	return { teamId: session.currentTeamId, team: { deletedAt: null } };
}

/** Server records are security roots (SSH, SFTP, backups and file proxy). */
export function serverTeamWhere(session: TeamSession, capability: ServerAccessCapability = "read"): Record<string, unknown> {
	const scope = activeCustomerTeamWhere(session);
	if (isGlobalTeamManager(session) || !session.currentTeamId) return scope;
	const { teamId, ...active } = scope;
	return { AND: [{ teamId }, { ...active, ...serverAccessWhere(session.userId, capability) }] };
}

/** SQL equivalent of serverTeamWhere for queries that alias the servers table as s. */
export function rawServerScope(session: TeamSession, field: "canRead" | "canConnect" | "canManage") {
	const live = Prisma.sql`NOT EXISTS (SELECT 1 FROM teams t WHERE t.id = s."teamId" AND t."deletedAt" IS NOT NULL)`;
	if (seesAllCustomers(session)) return live;
	if (!session.currentTeamId) return Prisma.sql`FALSE`;
	if (isGlobalTeamManager(session)) return Prisma.sql`${live} AND s."teamId" = ${session.currentTeamId}`;
	const allowedColumn = field === "canRead" ? Prisma.sql`a."canRead"`
		: field === "canConnect" ? Prisma.sql`a."canConnect"` : Prisma.sql`a."canManage"`;
	// Match serverTeamWhere: no override inherits account access; a row narrows it.
	return Prisma.sql`${live} AND s."teamId" = ${session.currentTeamId} AND (
		NOT EXISTS (SELECT 1 FROM user_server_access a WHERE a."serverId" = s.id AND a."userId" = ${session.userId})
		OR EXISTS (SELECT 1 FROM user_server_access a WHERE a."serverId" = s.id AND a."userId" = ${session.userId} AND ${allowedColumn} = true)
	)`;
}

/** Editing, disabling or deleting a server's profile. Customer accounts may
 * change only servers their customer added; servers the platform assigned
 * stay read-only to them whatever their template grants. */
export function serverProfileTeamWhere(session: TeamSession): Record<string, unknown> {
	const scope = serverTeamWhere(session, "manage");
	return isGlobalTeamManager(session) ? scope : { AND: [scope, { origin: "CUSTOMER" }] };
}

/** Origin of a server the session adds. Administrators and system callers
 * (no roles) assign platform servers; customer accounts add their own. */
export function serverOriginData(session: Partial<Pick<TeamSession, "userId" | "roles">>) {
	const byCustomer = session.roles !== undefined && !session.roles.includes("admin");
	return { origin: byCustomer ? "CUSTOMER" : "PLATFORM", addedById: session.userId ?? null } as const;
}

/** Command requests carry the command text and target-server refs — a security
 * root like the servers they run against. A null teamId is quarantined legacy
 * data (only global managers may read/cancel/approve it), never a shared request
 * every tenant can see. Mirrors {@link serverTeamWhere}. */
export const commandRequestTeamWhere = strictCustomerScope;

/** A sync job binds two servers plus paths and can be executed on demand
 * (rsync, optionally with --delete). Reading one hydrates both servers together
 * with their SSH keys. A null teamId is quarantined legacy data, never a job
 * every tenant may read or run. Mirrors {@link serverTeamWhere}. */
export const syncJobTeamWhere = strictCustomerScope;

/** A deployment run carries the rendered command text, its rollback snapshot and
 * the ids of the VPS it targets — and `createDeploymentRollbackRun` turns one back
 * into an executable command request. A null teamId is quarantined legacy data,
 * not a run every tenant may read or roll back. Mirrors {@link serverTeamWhere}. */
export const deploymentRunTeamWhere = strictCustomerScope;

/** A playbook contains executable server references. Null-team legacy
 * playbooks stay quarantined to platform administrators. */
export const playbookTeamWhere = strictCustomerScope;

/** Image uploads are private by default. A null teamId is legacy data owned by
 * its uploader, not a shared image library visible to every tenant manager. */
export const imageTeamWhere = strictCustomerScope;

/** A storage node is a file-data security root: it carries the SFTP/WebDAV
 * backing credentials and every byte the hub can read or write on it. A null
 * teamId is quarantined legacy data that only a platform administrator viewing
 * all customers may open, upload to or share. Mirrors {@link serverTeamWhere}
 * and the share-link service's node filter. */
export const storageNodeTeamWhere = strictCustomerScope;

/** A share link publishes a storage path on a node (and its access logs expose
 * downloader IPs/UAs). A null teamId is quarantined legacy data: no customer
 * may list, read access analytics for, or revoke an unassigned link. Mirrors
 * {@link serverTeamWhere}. */
export const shareLinkTeamWhere = strictCustomerScope;

/**
 * Prisma `where` for listing users in the directory UI/API.
 *
 * - platform administrator → full directory
 * - customer account → self + the accounts of its customer
 * - account without a customer → self only (prevents global user enumeration)
 */
export function userDirectoryWhere(session: TeamSession): Record<string, unknown> {
	if (isGlobalTeamManager(session)) {
		return {};
	}
	if (session.currentTeamId) {
		return {
			OR: [
				{ id: session.userId },
				{ teamMembership: { is: { teamId: session.currentTeamId } } },
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
	db: Prisma.TransactionClient = prisma,
): Promise<void> {
	if (isGlobalTeamManager(session)) return;
	if (userId === session.userId) return;
	if (!session.currentTeamId) {
		throw new NotFoundError(t("backend.team.userNotFound"));
	}
	const membership = await db.teamMember.findUnique({
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
 * Every user-created tenant record needs a selected customer: an administrator
 * in "all customers" mode must pick one first.
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
	return seesAllCustomers(session) ? undefined : teamWhere(session);
}
