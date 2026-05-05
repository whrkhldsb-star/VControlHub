import type { Permission, RoleKey } from "./rbac";
import { DEFAULT_ROLE_PERMISSIONS } from "./rbac";
import { requireSession } from "./require-session";

export function getPermissionsFromRoles(roles: RoleKey[]): Permission[] {
  return Array.from(new Set(roles.flatMap((role) => DEFAULT_ROLE_PERMISSIONS[role] ?? [])));
}

export function sessionHasPermission(session: { roles: RoleKey[] }, permission: Permission) {
  return getPermissionsFromRoles(session.roles).includes(permission);
}

export async function requirePermission(permission: Permission) {
  const session = await requireSession();

  if (!sessionHasPermission(session, permission)) {
    throw new Error(`缺少权限：${permission}`);
  }

  return session;
}
