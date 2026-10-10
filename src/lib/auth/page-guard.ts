import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * TR-030 / 56 multi-tenant: page-level permission guard.
 *
 * Second-line defense at the page boundary (server component entry).
 * The first line is the client-side `useGateRoute()` hook (Tick 1) that
 * hides UI when the session lacks the required permission. This guard
 * makes sure that even if a client surface forgets to hide, the server
 * still throws a `ForbiddenError` that the root `error.tsx` translates
 * into the shared `<PermissionDenied />` surface.
 *
 * Usage in a page.tsx:
 *
 * ```tsx
 * export default async function CostSummaryPage() {
 *   const session = await requirePagePermission("cost:read");
 *   // ... rest of the page, session is guaranteed to carry the permission
 * }
 * ```
 *
 * Optional `redirectTo` is forwarded to `requireSession()` so the user is
 * bounced back to `/login` with a `?next=` hint when no session is mounted.
 */
import { ForbiddenError } from "@/lib/errors";

import { sessionHasPermission } from "./authorization";
import { PLATFORM_PAGE_PERMISSIONS } from "./platform-pages";
import type { Permission } from "./rbac";
import { requireSession } from "./require-session";
import type { SessionPayload } from "./session";
import { isGlobalTeamManager } from "./team-scope";

/**
 * Pages about the platform itself (`PLATFORM_ONLY_PAGES`): only the platform
 * role may open them, whatever permissions an identity template grants.
 */
export async function requirePlatformAdminPage(options?: { redirectTo?: string }): Promise<SessionPayload> {
	const session = await requireSession(options?.redirectTo);
	if (!isGlobalTeamManager(session)) {
		const permission = PLATFORM_PAGE_PERMISSIONS[0]!;
		throw new ForbiddenError(apiCopy("apiCopy.missing.permission.db2e4ec2", { v0: String(permission) }), {
			permission,
		});
	}
	return session;
}

export async function requirePagePermission(
	permission: Permission,
	options?: { redirectTo?: string },
): Promise<SessionPayload> {
	const session = await requireSession(options?.redirectTo);
	if (!sessionHasPermission(session, permission)) {
		throw new ForbiddenError(apiCopy("apiCopy.missing.permission.db2e4ec2", { v0: String(permission) }), {
			permission,
		});
	}
	return session;
}
