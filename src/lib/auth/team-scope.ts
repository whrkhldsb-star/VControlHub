/**
 * TR-030 multi-tenant: team-scoped data filtering utilities.
 *
 * Most list queries in the app run without any team boundary — every
 * authenticated user sees every record. This module provides a single
 * `teamWhere` helper that service层的 list 函数 can spread into their
 * Prisma `where` clause to narrow results to the caller's current team.
 *
 * Rules:
 * 1. If the session has `team:manage` (admin), no filter is applied —
 *    admins see everything.
 * 2. If `currentTeamId` is null, records with `teamId = null` are visible
 *    (shared/unassigned resources).
 * 3. If `currentTeamId` is set, records belonging to that team are visible.
 *
 * Usage in a service:
 * ```ts
 * const where = { ...teamWhere(session), status: "PENDING_APPROVAL" };
 * ```
 */

import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";

import type { SessionPayload } from "./session";
import { sessionHasPermission } from "./authorization";
import { t } from "@/lib/i18n/translations";

type TeamSession = Pick<SessionPayload, "userId" | "roles" | "currentTeamId">;

/**
 * True when the actor may see/manage all tenants (global team admin).
 * Used by user-directory scoping and other cross-user surfaces.
 */
export function isGlobalTeamManager(session: TeamSession): boolean {
	return sessionHasPermission(session, "team:manage");
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

	// Users with a current team: see their team's records + unassigned
	// (null teamId = shared/legacy)
	if (session.currentTeamId) {
		return { OR: [{ teamId: session.currentTeamId }, { teamId: null }] };
	}

	// No team context: only unassigned records
	return { teamId: null };
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
 * For models that don't have teamId yet (forward compat):
 * returns empty filter so the query runs unscoped. As models gain
 * teamId columns, swap this to `teamWhere`.
 */
export function teamWhereOptional(_session: TeamSession): Record<string, unknown> {
	return {};
}

/**
 * When creating a record, use this to set the teamId on the new record.
 * If the user has a current team, the record is assigned to that team.
 * Admins can explicitly choose a team; otherwise it follows currentTeamId.
 */
export function teamCreateData(
	session: Pick<SessionPayload, "currentTeamId">,
): { teamId?: string | null } {
	return session.currentTeamId
		? { teamId: session.currentTeamId }
		: {};
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
		return { OR: [{ teamId: session.currentTeamId }, { teamId: null }] };
	}
	return { teamId: null };
}
