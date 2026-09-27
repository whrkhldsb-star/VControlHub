import { apiCopy } from "@/lib/i18n/api-copy";
import { ForbiddenError } from "@/lib/errors";
import type { Permission, RoleKey } from "./rbac";
import { getPermissionsFromRoles } from "./rbac";
import { requireSession } from "./require-session";

// Re-export for backwards compat — existing consumers (require-api-permission.ts,
// many server pages) keep importing from "@/lib/auth/authorization".
export { getPermissionsFromRoles };


export function sessionHasPermission(
	session: { roles: RoleKey[]; permissions?: Permission[] },
	permission: Permission,
) {
	// Cross-workspace access is a platform role, never a delegable direct grant.
	// In particular a bearer token carries roles: [] and cannot inherit it.
	if (permission === "team:manage") return session.roles?.includes("admin") === true;
	// User credentials, global role assignments and role templates are shared
	// across workspaces; team membership has its own scoped management API.
	if (permission === "user:manage" || permission === "role:manage" || permission === "announcement:manage") {
		return session.roles?.includes("admin") === true;
	}
	// Hub backups contain the whole database and application files, including
	// other tenants. A workspace permission or bearer token cannot own them.
	if (permission === "backup:create" || permission === "backup:read" || permission === "backup:restore") {
		return session.roles?.includes("admin") === true;
	}
	if (Array.isArray(session.permissions)) {
		return session.permissions.includes(permission);
	}
	return getPermissionsFromRoles(session.roles).includes(permission);
}

export async function requirePermission(permission: Permission) {
  const session = await requireSession();

  if (!sessionHasPermission(session, permission)) {
    throw new ForbiddenError(apiCopy("apiCopy.missing.permission.db2e4ec2", { v0: String(permission) }));
  }

  return session;
}
