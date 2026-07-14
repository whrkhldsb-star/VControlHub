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

import type { SessionPayload } from "./session";
import { sessionHasPermission } from "./authorization";

/**
 * Returns a Prisma `where` fragment that filters by teamId.
 * Spread this into the outermost `where` on list queries.
 */
/**
 * Returns a Prisma `where` fragment that filters by teamId.
 * Spread this into the outermost `where` on list queries.
 */
export function teamWhere(
	session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Record<string, unknown> {
	// Admins / team managers see all records
	if (sessionHasPermission(session, "team:manage")) {
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
 * For models that don't have teamId yet (forward compat):
 * returns empty filter so the query runs unscoped. As models gain
 * teamId columns, swap this to `teamWhere`.
 */
export function teamWhereOptional(
	_session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Record<string, unknown> {
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
	session: Pick<SessionPayload, "userId" | "roles" | "currentTeamId">,
): Record<string, unknown> | undefined {
	if (sessionHasPermission(session, "team:manage")) {
		return undefined;
	}
	if (session.currentTeamId) {
		return { OR: [{ teamId: session.currentTeamId }, { teamId: null }] };
	}
	return { teamId: null };
}
