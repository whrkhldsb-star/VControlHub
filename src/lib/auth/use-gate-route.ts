"use client";

import { useMemo } from "react";

import { type Permission, type RoleKey } from "./rbac";
import { useSessionGate } from "./session-context";

/**
 * Result of the permission gate hook. All checks are O(1) against precomputed
 * Sets so multiple calls inside one render do not re-iterate role permissions.
 */
export interface GateRouteResult {
	/** True when the session has the given permission. */
	can: (permission: Permission) => boolean;
	/** True when the session has at least one of the given permissions. */
	canAny: (permissions: readonly Permission[]) => boolean;
	/** True when the session has every one of the given permissions. */
	canAll: (permissions: readonly Permission[]) => boolean;
	/** True when the session carries the given role directly. */
	hasRole: (role: RoleKey) => boolean;
	/** True when the session carries at least one of the given roles. */
	hasAnyRole: (roles: readonly RoleKey[]) => boolean;
	/** True when no session is mounted (provider missing or empty). */
	isUnauthenticated: boolean;
	/** Raw permissions resolved from roles (denormalized). */
	permissions: readonly Permission[];
	/** Raw roles directly from the session. */
	roles: readonly RoleKey[];
}

/**
 * TR-030 multi-tenant / 56-multi-tenant client gate hook. Wraps
 * `useSessionGate()` with convenient permission/role checks so client
 * components can do:
 *
 * ```tsx
 * const gate = useGateRoute();
 * if (!gate.can("server:ssh")) return null;
 * ```
 *
 * The default behavior (no provider mounted) is empty permissions — every
 * `can(...)` returns false and UI elements disappear. This is intentional:
 * forgetting to mount the provider should not silently grant access.
 */
export function useGateRoute(): GateRouteResult {
	const gate = useSessionGate();
	return useMemo(() => {
		const permissionSet = new Set<Permission>(gate.permissions);
		const roleSet = new Set<RoleKey>(gate.roles);
		return {
			can: (permission) => permissionSet.has(permission),
			canAny: (permissions) => permissions.some((p) => permissionSet.has(p)),
			canAll: (permissions) => permissions.every((p) => permissionSet.has(p)),
			hasRole: (role) => roleSet.has(role),
			hasAnyRole: (roles) => roles.some((r) => roleSet.has(r)),
			isUnauthenticated: !gate.authenticated,
			permissions: gate.permissions,
			roles: gate.roles,
		};
	}, [gate.permissions, gate.roles, gate.authenticated]);
}
