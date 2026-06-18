/**
 * src/lib/auth/server-session.ts
 *
 * Server-side `getCurrentSession()` helper used by Server Components (layout,
 * SidebarLoader, page guards). React's `cache()` deduplicates the verify
 * within a single request so multiple components that need the session don't
 * pay the HMAC cost twice.
 *
 * Returns `null` for unauthenticated / invalid sessions; callers decide
 * whether to redirect, render fallback, or build an empty `SessionGate`.
 */
import { cache } from "react";
import { cookies } from "next/headers";

import {
	getSessionCookieName,
	verifySessionToken,
	type SessionPayload,
} from "./session";

export const getCurrentSession = cache(async (): Promise<SessionPayload | null> => {
	const cookieStore = await cookies();
	const sessionCookie = cookieStore.get(getSessionCookieName());
	if (!sessionCookie?.value) return null;
	try {
		return await verifySessionToken(sessionCookie.value);
	} catch {
		return null;
	}
});
