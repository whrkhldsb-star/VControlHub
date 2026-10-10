"use client";

import { RouteError } from "@/components/route-error";

/**
 * Root-level error boundary for route segments.
 * Catches errors thrown in Server Components and Client Components
 * within the shared layout. Falls back gracefully with a retry button.
 *
 * Note: This does NOT catch errors in root layout.tsx —
 * for that, global-error.tsx is used instead.
 *
 * TR-030 / 56 multi-tenant (Tick 3): recognise `ForbiddenError` thrown by
 * `requirePagePermission()` and render the shared `<PermissionDenied />`
 * surface instead of the generic error message. This is the second-line
 * guard — even if a client surface forgets to hide its UI, the page entry
 * still bounces unauthorised users to a consistent denial state.
 */
export default function RootError({
	error,
	reset,
}: {
	error: Error & { digest?: string };
	reset: () => void;
}) {
	// RouteError logs the failure (warn for ForbiddenError, error otherwise)
	// and renders <PermissionDenied /> for permission failures.
	return <RouteError error={error} reset={reset} />;
}
