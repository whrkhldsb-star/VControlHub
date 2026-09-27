import { getPermissionsFromRoles, ALL_PERMISSIONS, type Permission, type RoleKey } from "./rbac";

export type TenantMembershipPermissions = {
  role: string;
  accessRole: string;
  permissionTemplate?: { roleKeys: string[]; permissions: string[]; teamId: string | null } | null;
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
  const template = membership.permissionTemplate;
  const templateAllowed = template
    ? new Set<Permission>([
        ...getPermissionsFromRoles(template.roleKeys.filter(
          (key): key is RoleKey => key === "viewer" || key === "operator" || key === "storage_manager",
        )),
        ...template.permissions.filter((key): key is Permission =>
          (ALL_PERMISSIONS as readonly string[]).includes(key),
        ),
      ])
    : null;
  const scoped = new Set(accountPermissions.filter((permission) =>
    permission !== "team:manage" &&
    permission !== "team:member:manage" &&
    permission !== "user:manage" && permission !== "role:manage" && permission !== "announcement:manage" &&
    permission !== "backup:create" && permission !== "backup:read" && permission !== "backup:restore" &&
    (allowed === null || allowed.has(permission) || WITHOUT_WORKSPACE.has(permission)) &&
    (templateAllowed === null || templateAllowed.has(permission) || WITHOUT_WORKSPACE.has(permission)),
  ));
  if (membership.role === "owner" || membership.role === "admin") {
    scoped.add("team:member:manage");
  }
  return Array.from(scoped);
}
