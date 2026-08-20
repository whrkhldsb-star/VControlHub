/**
 * src/lib/auth/declared-permissions.ts
 *
 * Server-side loader for the per-page `navigationPermissions` declared in
 * `docs/route-catalog.json`. The catalog separates the route's admission
 * permission from optional in-page controls, so navigation does not advertise
 * a page to a user who only has one of its write-only capabilities.
 *
 * Used by `SidebarLoader` to inject a `Record<href, Permission[]>` prop into
 * `AppSidebar` / `GlobalSearch` so client components can filter nav + search
 * results without importing the 38 KB catalog into the client bundle.
 *
 * Anti-pattern note: this MUST be called server-side only. Client components
 * must receive the relevant subset as a prop.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { Permission } from "./rbac";

interface RouteCatalogPage {
	path: string;
	declaredPermissions: string[];
	navigationPermissions?: string[];
}

interface RouteCatalogShape {
	pages: RouteCatalogPage[];
}

let cache: Record<string, readonly Permission[]> | null = null;

function loadRouteCatalog(): RouteCatalogShape {
	const catalogPath = join(process.cwd(), "docs", "route-catalog.json");
	const raw = readFileSync(catalogPath, "utf8");
	return JSON.parse(raw) as RouteCatalogShape;
}

function getAllDeclaredPermissions(): Record<string, readonly Permission[]> {
	if (!cache) {
		const catalog = loadRouteCatalog();
		const map: Record<string, readonly Permission[]> = {};
		for (const page of catalog.pages) {
			map[page.path] = (page.navigationPermissions ?? page.declaredPermissions) as readonly Permission[];
		}
		cache = map;
	}
	return cache;
}

/**
 * Return a `Record<href, Permission[]>` for the given sidebar hrefs, defaulting
 * missing entries to `[]` (i.e. visible to anyone authenticated). The result is
 * serializable so it can be passed from a server component into a client
 * component as a prop.
 */
export function loadSidebarDeclaredPermissions(
	sidebarHrefs: readonly string[],
): Record<string, readonly Permission[]> {
	const all = getAllDeclaredPermissions();
	const result: Record<string, readonly Permission[]> = {};
	for (const href of sidebarHrefs) {
		result[href] = all[href] ?? [];
	}
	return result;
}

/**
 * Visible-for-testing helper to clear the in-memory cache between unit tests.
 */
export function resetDeclaredPermissionsCache(): void {
	cache = null;
}
