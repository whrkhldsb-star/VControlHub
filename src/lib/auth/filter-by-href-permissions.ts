/**
 * Shared permission gate for href-keyed navigation / search catalogs.
 *
 * Contract (TR-030 / task 56):
 * - href not present in the map → visible to any authenticated user
 * - href declares `[]` → same (explicit empty)
 * - href declares one or more permissions → user must hold at least one (`canAny`)
 */
import type { Permission } from "@/lib/auth/rbac";

export function filterByHrefPermissions<T extends { href: string }>(
	items: readonly T[],
	declaredPermissionsByHref: Record<string, readonly Permission[]>,
	canAny: (permissions: readonly Permission[]) => boolean,
): T[] {
	return items.filter((item) => {
		const required = declaredPermissionsByHref[item.href];
		if (!required || required.length === 0) return true;
		return canAny(required);
	});
}
