import { getPermissionsFromRoles, type Permission, type RoleKey } from "./rbac";

export type TenantMembershipPermissions = {
  role: string;
  accessRole: string;
} | null;

const WITHOUT_WORKSPACE = new Set<Permission>([
  "team:create",
  "team:read",
  "user:read",
  "api-token:manage", // permits listing/revoking an old token after removal
]);

/** Account permissions are the ceiling; membership can narrow them per team. */
export function scopePermissionsToWorkspace(input: {
  roles: RoleKey[];
  accountPermissions: Permission[];
  membership: TenantMembershipPermissions;
}): Permission[] {
  const { roles, accountPermissions, membership } = input;
  if (roles.includes("admin")) return accountPermissions;
  if (!membership) return accountPermissions.filter((permission) => WITHOUT_WORKSPACE.has(permission));

  const accessRole = membership.accessRole;
  const allowed = accessRole === "viewer" || accessRole === "operator" || accessRole === "storage_manager"
    ? new Set(getPermissionsFromRoles([accessRole]))
    : null; // "inherit" keeps existing memberships working until explicitly set.
  const scoped = new Set(accountPermissions.filter((permission) =>
    permission !== "team:manage" &&
    permission !== "team:member:manage" &&
    permission !== "user:manage" && permission !== "role:manage" && permission !== "announcement:manage" &&
    permission !== "backup:create" && permission !== "backup:read" && permission !== "backup:restore" &&
    (allowed === null || allowed.has(permission) || WITHOUT_WORKSPACE.has(permission)),
  ));
  if (membership.role === "owner" || membership.role === "admin") {
    scoped.add("team:member:manage");
  }
  return Array.from(scoped);
}
