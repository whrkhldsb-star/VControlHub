import { apiCopy } from "@/lib/i18n/api-copy";
import { ForbiddenError } from "@/lib/errors";
import type { Permission, RoleKey } from "./rbac";
import { getPermissionsFromRoles } from "./rbac";
import { PLATFORM_ONLY_PERMISSIONS } from "./identity-templates";
import { requireSession } from "./require-session";

// Re-export for backwards compat — existing consumers (require-api-permission.ts,
// many server pages) keep importing from "@/lib/auth/authorization".
export { getPermissionsFromRoles };


export function sessionHasPermission(
	session: { roles: RoleKey[]; permissions?: Permission[] },
	permission: Permission,
) {
	// Customers, accounts, identity templates, announcements and Hub backups
	// (the whole database, every customer) belong to the platform role alone:
	// no identity template or bearer token (roles: []) can carry them.
	if (PLATFORM_ONLY_PERMISSIONS.has(permission)) return session.roles?.includes("admin") === true;
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
