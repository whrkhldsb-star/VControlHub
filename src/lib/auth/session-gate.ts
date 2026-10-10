/**
 * Pure helpers for building a `SessionGate` from a server-verified role list.
 *
 * Lives in its own server-friendly module (no `"use client"` directive) so
 * server components — `app/layout.tsx`, `SidebarLoader`, etc. — can call
 * `gateFromRoles()` directly without crossing the React Server Component
 * boundary. The client-side context wrapper (`SessionGateProvider`,
 * `useSessionGate`) still imports `SessionGate`/`EMPTY_GATE` from here so the
 * two layers stay in sync.
 */

import { type Permission, type RoleKey, getPermissionsFromRoles } from "./rbac";

export interface SessionGate {
	/** Roles directly from session.roles (raw, no expansion). */
	roles: RoleKey[];
	/** Permissions resolved from roles — denormalized for O(1) lookup. */
	permissions: Permission[];
	/** True if the session represents an authenticated user. */
	authenticated: boolean;
	/** Customer the session works in; null for an administrator viewing all customers. */
	currentTeamId?: string | null;
}

export const EMPTY_GATE: SessionGate = {
	roles: [],
	permissions: [],
	authenticated: false,
	currentTeamId: null,
};

/**
 * Build a `SessionGate` from a server-issued role list. Pure, side-effect-free
 * helper so server components (e.g. `SidebarLoader`) can construct the value
 * that gets handed to the client provider.
 *
 * Pass `permissions` (the session's effective list — a customer account's
 * come from its identity template, not its roles) whenever a verified session
 * is at hand: deriving them from roles alone hides entries the user may open.
 */
export function gateFromRoles(
	roles: RoleKey[],
	permissions?: readonly Permission[],
	currentTeamId: string | null = null,
): SessionGate {
	return {
		roles: [...roles],
		permissions: permissions ? [...permissions] : getPermissionsFromRoles(roles),
		// A customer account holds no built-in role, yet is still signed in.
		authenticated: roles.length > 0 || (permissions?.length ?? 0) > 0,
		currentTeamId,
	};
}
