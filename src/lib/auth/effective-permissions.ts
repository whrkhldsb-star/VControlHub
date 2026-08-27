/**
 * Request-time resolution of a user's effective permissions.
 *
 * `DEFAULT_ROLE_PERMISSIONS` is a static map keyed by the four built-in roles,
 * so `getPermissionsFromRoles()` alone cannot see the fine-grained grants that
 * `/api/users/permissions` PATCH persists. Those are stored as
 * `rolePermission` rows on an auto-maintained per-user role
 * (`user:{id}:custom`, see `route-patch.ts`), and every authorization path
 * derived its permissions from the static map — so the permission panel saved
 * the grants, displayed them back as "effective permissions", and reported
 * success, while the target account's actual access never changed.
 *
 * The union is additive on purpose: the panel seeds its checkbox set from
 * `directPermissionKeys` (the custom role only, not the full effective set), so
 * an unchecked box means "no extra grant" and must never be read as "revoke
 * what the base role already gives".
 */
import { prisma } from "@/lib/db";
import {
  ALL_PERMISSIONS,
  getPermissionsFromRoles,
  type Permission,
  type RoleKey,
} from "./rbac";

const PERMISSION_KEYS = new Set<string>(ALL_PERMISSIONS);

/** Key of the auto-maintained per-user role that carries direct grants. */
export function customRoleKey(userId: string) {
  return `user:${userId}:custom`;
}

/** True when the key is a permission this build still ships. */
export function isPermissionKey(key: string): key is Permission {
  return PERMISSION_KEYS.has(key);
}

/**
 * Base role permissions ∪ direct grants from the user's custom role.
 *
 * `assignedRoleKeys` is the raw key list from `userRole` (before the RoleKey
 * filter), so the extra query only runs for the users who actually have a
 * custom role — the common case stays at zero additional round trips.
 */
export async function resolveEffectivePermissions(input: {
  userId: string;
  roles: RoleKey[];
  assignedRoleKeys: readonly string[];
}): Promise<Permission[]> {
  const base = getPermissionsFromRoles(input.roles);
  const key = customRoleKey(input.userId);
  if (!input.assignedRoleKeys.includes(key)) return base;

  const rows = await prisma.rolePermission.findMany({
    where: { role: { key } },
    select: { permission: { select: { key: true } } },
    take: ALL_PERMISSIONS.length,
  });
  const merged = new Set<Permission>(base);
  for (const row of rows) {
    // A leftover row for a permission we no longer ship is ignored rather than
    // widening access to something the guards can no longer reason about.
    if (isPermissionKey(row.permission.key)) merged.add(row.permission.key);
  }
  return Array.from(merged);
}
