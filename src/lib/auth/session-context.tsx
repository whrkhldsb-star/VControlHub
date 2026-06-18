"use client";

import { createContext, useContext, type ReactNode } from "react";

import { type Permission, type RoleKey, getPermissionsFromRoles } from "./rbac";

/**
 * Client-side view of the authenticated session.
 *
 * Built by `gateFromRoles()` from a server-verified `SessionPayload`.
 * Defaults to an unauthenticated empty gate when no provider is mounted so
 * that misuse (forgetting the provider) yields a fail-safe "no permissions"
 * rather than throwing — keeping with task 56's "hide UI when no permission"
 * contract (TR-030 multi-tenant via permission-gated render).
 */
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

const SessionGateContext = createContext<SessionGate>(EMPTY_GATE);

export function SessionGateProvider({
	value,
	children,
}: {
	value: SessionGate;
	children: ReactNode;
}) {
	return (
		<SessionGateContext.Provider value={value}>
			{children}
		</SessionGateContext.Provider>
	);
}

/**
 * Reads the current `SessionGate` from context. Returns an empty
 * (unauthenticated) gate when the provider is missing so callers can safely
 * use the returned values for conditional rendering without try/catch.
 */
export function useSessionGate(): SessionGate {
	return useContext(SessionGateContext) ?? EMPTY_GATE;
}

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
