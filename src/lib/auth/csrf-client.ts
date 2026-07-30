"use client";

/**
 * ⚠️ SECURITY DESIGN NOTE — DO NOT add `HttpOnly` to the `csrf_token` cookie.
 *
 * This module implements the **Double-Submit Cookie** CSRF protection pattern:
 *   - Server sets a random `csrf_token` cookie at login (SameSite=Strict + Secure in prod).
 *   - Client reads that cookie via `document.cookie` and echoes it into the
 *     `X-CSRF-Token` header on every state-changing request.
 *   - Server (`src/proxy.ts`) compares cookie `csrf_token` vs `x-csrf-token` header.
 *
 * The cookie **must be JS-readable** for this pattern to work. Adding `HttpOnly`
 * would block `document.cookie` access and silently break every POST/PUT/DELETE/PATCH
 * across the app.
 *
 * Identity is carried by a separate `session` cookie, which **is** `httpOnly: true`
 * (see `src/app/api/auth/signout/route.ts` + `src/app/api/auth/2fa/verify-login/route.ts`).
 * Stealing the `csrf_token` alone gives an attacker nothing — they still need the
 * `session` cookie to impersonate the user, and that one is protected from XSS via HttpOnly.
 *
 * Past audits have repeatedly flagged "csrf_token missing HttpOnly" as a finding.
 * It is a false positive. Do not change the cookie flags without redesigning the
 * CSRF strategy (e.g. moving to synchronizer-token + server-rendered hidden inputs).
 */

/**
 * Fetch wrapper that:
 * 1. Auto-injects CSRF token header for state-changing requests
 * 2. Auto-sets Content-Type: application/json for JSON bodies
 * 3. Auto-parses JSON responses — returns the parsed data directly
 * 4. Throws `ApiError` on non-ok responses (TR-034 envelope: code/category/details)
 *
 * Usage:
 *   const data = await csrfFetch("/api/servers");          // GET → parsed JSON
 *   const data = await csrfFetch("/api/servers", { ... }); // POST → parsed JSON
 *
 * For non-JSON responses (e.g. blobs), use { raw: true } in init:
 *   const response = await csrfFetch("/api/files/download", { raw: true });
 *
 * Cookie reading is the single source of truth for `@/lib/http/api-client` as well.
 */

import { apiRequest, type ApiRequestInit } from "@/lib/http/api-client";
export { getCsrfTokenFromCookie } from "@/lib/auth/csrf-token";

/** Backward-compatible entry point; all behavior is owned by apiRequest. */
export async function csrfFetch<T = Record<string, any>>(
	input: RequestInfo | URL,
	init?: ApiRequestInit,
): Promise<T> {
	return apiRequest<T>(input, init);
}
