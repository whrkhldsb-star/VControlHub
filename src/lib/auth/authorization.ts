import { ForbiddenError } from "@/lib/errors";
import type { Permission, RoleKey } from "./rbac";
import { getPermissionsFromRoles } from "./rbac";
import { requireSession } from "./require-session";

// Re-export for backwards compat — existing consumers (require-api-permission.ts,
// many server pages) keep importing from "@/lib/auth/authorization".
export { getPermissionsFromRoles };

export function sessionHasPermission(session: { roles: RoleKey[] }, permission: Permission) {
	return getPermissionsFromRoles(session.roles).includes(permission);
}

export async function requirePermission(permission: Permission) {
  const session = await requireSession();

  if (!sessionHasPermission(session, permission)) {
    throw new ForbiddenError(`缺少权限：${permission}`);
  }

  return session;
}
