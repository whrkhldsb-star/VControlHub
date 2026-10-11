/**
 * Platform-admin gate for the system config import/export surface.
 *
 * `user:manage` is the permission that unlocks the settings "advanced" tab.
 * It is platform-only today (`PLATFORM_ONLY_PERMISSIONS`), but this gate keeps
 * the import surface bound to the `admin` role itself rather than to any
 * permission: `executeImport` writes the global RBAC catalog (permissions,
 * roles, rolePermissions, users, userRoles, settings) and takes each row's
 * `teamId` straight from the uploaded file, where `teamId: null` is quarantined
 * legacy data that only administrators viewing all customers reach. Without
 * this gate a holder of the permission could upload a hand-written .vch.json
 * that grants their own account every permission, or publish rows into another
 * customer — writing globally what they are not even allowed to read globally.
 *
 * A tenant-scoped import is deliberately not offered: the importers have no
 * per-table team filter to constrain, so the honest bar is the platform admin.
 */
import { ForbiddenError } from "@/lib/errors";
import type { RoleKey } from "@/lib/auth/rbac";
import { t } from "@/lib/i18n/service-translations";

/** Platform admin = the built-in `admin` role, never a direct permission grant. */
export function isPlatformAdmin(session: { roles: RoleKey[] }): boolean {
  return session.roles.includes("admin");
}

export function assertPlatformAdminForConfigImport(
  session: { roles: RoleKey[] } | null | undefined,
): void {
  if (!session || !isPlatformAdmin(session)) {
    throw new ForbiddenError(
      t("backend.system.configImportRequiresPlatformAdmin"),
    );
  }
}
