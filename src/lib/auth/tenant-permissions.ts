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

const PLATFORM_OR_ACCOUNT_ONLY = new Set<Permission>([
  "announcement:manage",
  "backup:create",
  "backup:read",
  "backup:restore",
  "role:manage",
  "team:create",
  "team:manage",
  "user:manage",
]);

/** Operations a workspace owner/admin receives inside the active workspace. */
export const WORKSPACE_ADMIN_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter(
  (permission) => !PLATFORM_OR_ACCOUNT_ONLY.has(permission),
);

/** Permissions that may be used as a live ceiling for an ordinary member. */
export const WORKSPACE_POLICY_PERMISSIONS: Permission[] = WORKSPACE_ADMIN_PERMISSIONS.filter(
  (permission) => permission !== "team:member:manage" && permission !== "api-token:manage",
);

/** Account permissions are the ceiling for members; workspace administrators receive their workspace role grant. */
export function scopePermissionsToWorkspace(input: {
  roles: RoleKey[];
  accountPermissions: Permission[];
  membership: TenantMembershipPermissions;
}): Permission[] {
  const { roles, accountPermissions, membership } = input;
  if (roles.includes("admin")) return accountPermissions;
  if (!membership) return accountPermissions.filter((permission) => WITHOUT_WORKSPACE.has(permission));

  // Workspace administrators own the resources in this workspace. Their
  // account role, access role, policy group and per-resource rows must not
  // leave them with an administrator label but member-level capabilities.
  if (membership.role === "owner" || membership.role === "admin") {
    return Array.from(new Set([
      ...WORKSPACE_ADMIN_PERMISSIONS,
      ...accountPermissions.filter((permission) => WITHOUT_WORKSPACE.has(permission)),
    ]));
  }

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
  return Array.from(scoped);
}
