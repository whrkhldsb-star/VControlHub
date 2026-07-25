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

import { ApiError } from "@/lib/http/api-client-error";

/**
 * Read the double-submit `csrf_token` cookie (JS-readable by design).
 * Shared by csrfFetch, api-client, and non-fetch clients (XHR / chunk PUT).
 */
export function getCsrfTokenFromCookie(): string | null {
	if (typeof document === "undefined") return null;
	const cookie = document.cookie
		.split(";")
		.map((c) => c.trim())
		.find((c) => c.startsWith("csrf_token="));
	if (!cookie) return null;
	return decodeURIComponent(cookie.split("=").slice(1).join("="));
}

export async function csrfFetch<T = Record<string, any>>(
	input: RequestInfo | URL,
	init?: RequestInit & { raw?: boolean },
): Promise<T> {
	const method = (init?.method ?? "GET").toUpperCase();
	const needsCsrf = !["GET", "HEAD", "OPTIONS"].includes(method);

	let headers: Headers;

	if (init?.headers instanceof Headers) {
		headers = init.headers;
	} else if (init?.headers) {
		headers = new Headers(init.headers as Record<string, string>);
	} else {
		headers = new Headers();
	}

	// Auto-inject CSRF token
	if (needsCsrf) {
		const csrfToken = getCsrfTokenFromCookie();
		if (csrfToken) {
			headers.set("X-CSRF-Token", csrfToken);
		}
	}

	// Auto-inject Content-Type for JSON bodies
	if (init?.body && typeof init.body === "string" && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	// Raw mode — return the original Response object (caller handles status)
	if (init?.raw) {
		return fetch(input, { ...init, headers }) as unknown as T;
	}

	const response = await fetch(input, { ...init, headers });

	if (!response.ok) {
		let body: Record<string, unknown> = {};
		try {
			body = (await response.json()) as Record<string, unknown>;
		} catch {
			body = { error: response.statusText || `Request failed (${response.status})` };
		}
		throw new ApiError(response.status, body);
	}

	// Handle 204 No Content (align with api-client)
	if (response.status === 204) {
		return undefined as T;
	}

	return response.json();
}
