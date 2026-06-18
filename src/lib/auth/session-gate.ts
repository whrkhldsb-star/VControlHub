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
}

export const EMPTY_GATE: SessionGate = {
	roles: [],
	permissions: [],
	authenticated: false,
};

/**
 * Build a `SessionGate` from a server-issued role list. Pure, side-effect-free
 * helper so server components (e.g. `SidebarLoader`) can construct the value
 * that gets handed to the client provider.
 */
export function gateFromRoles(roles: RoleKey[]): SessionGate {
	return {
		roles: [...roles],
		permissions: getPermissionsFromRoles(roles),
		authenticated: roles.length > 0,
	};
}
