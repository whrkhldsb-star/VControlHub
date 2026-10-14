/**
 * Pages about the platform itself: the hub host's resources and the platform
 * self-check. They describe the machine every customer shares, so only
 * platform administrators open them; customer accounts watch their own
 * servers on `/vps-status` and their alerts on `/alert-rules`.
 *
 * Client-safe: no database imports.
 */
import type { Permission } from "./rbac";

export const PLATFORM_ONLY_PAGES: ReadonlySet<string> = new Set(["/health", "/monitoring", "/public-status"]);

/**
 * How navigation admits a platform-only page. The platform role holds every
 * platform-only permission and nothing else can (`PLATFORM_ONLY_PERMISSIONS`),
 * so requiring one of them is the same test as "is a platform administrator".
 */
export const PLATFORM_PAGE_PERMISSIONS: readonly Permission[] = ["team:manage"];

export function isPlatformOnlyPage(href: string): boolean {
	return PLATFORM_ONLY_PAGES.has(href);
}
