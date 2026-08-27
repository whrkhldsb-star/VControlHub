/**
 * Platform-admin gate for the system config import/export surface.
 *
 * `user:manage` is the permission that unlocks the settings "advanced" tab, and
 * it is not by itself a platform-wide mandate: it can also arrive as a direct
 * per-user grant (`/api/users/permissions`, resolved by
 * `@/lib/auth/effective-permissions`). Export already draws the line — a
 * cross-team or secret-bearing export requires the `admin` role — and import
 * needs the same line, for a stronger reason: `executeImport` writes the global
 * RBAC catalog (permissions, roles, rolePermissions, users, userRoles, settings)
 * and takes each row's `teamId` straight from the uploaded file, where
 * `teamId: null` means "visible to every tenant" (`teamWhere()`). Without this
 * gate a `user:manage` holder could upload a hand-written .vch.json that grants
 * their own account every permission, or publish rows into another workspace —
 * writing globally what they are not even allowed to read globally.
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
