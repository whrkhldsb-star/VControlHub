"use client";

import { useEffect, useState } from "react";

/**
 * ⚠️ SECURITY DESIGN NOTE — DO NOT add `HttpOnly` to the `csrf_token` cookie.
 *
 * This module implements the **Double-Submit Cookie** CSRF protection pattern:
 *   - Server sets a random `csrf_token` cookie at login (SameSite=Strict + Secure in prod).
 *   - Client reads that cookie via `document.cookie` and echoes it into the
 *     `X-CSRF-Token` header on every state-changing request.
 *   - Server (`src/lib/auth/csrf.ts:validateCsrf`) compares cookie value vs header value.
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
 * Hook to get the CSRF token from the csrf_token cookie.
 * Used to include X-CSRF-Token header in all state-changing API requests.
 */
export function useCsrfToken(): string | null {
	const [token, setToken] = useState<string | null>(null);

	useEffect(() => {
		const cookie = document.cookie
			.split(";")
			.map((c) => c.trim())
			.find((c) => c.startsWith("csrf_token="));
		if (cookie) {

			setToken(decodeURIComponent(cookie.split("=").slice(1).join("=")));
		}
	}, []);

	return token;
}

/**
 * Fetch wrapper that:
 * 1. Auto-injects CSRF token header for state-changing requests
 * 2. Auto-sets Content-Type: application/json for JSON bodies
 * 3. Auto-parses JSON responses — returns the parsed data directly
 * 4. Throws on non-ok responses with the server error message
 *
 * Usage:
 *   const data = await csrfFetch("/api/servers");          // GET → parsed JSON
 *   const data = await csrfFetch("/api/servers", { ... }); // POST → parsed JSON
 *
 * For non-JSON responses (e.g. blobs), use { raw: true } in init:
 *   const response = await csrfFetch("/api/files/download", { raw: true });
 */
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
		const cookie = document.cookie
			.split(";")
			.map((c) => c.trim())
			.find((c) => c.startsWith("csrf_token="));
		const csrfToken = cookie
			? decodeURIComponent(cookie.split("=").slice(1).join("="))
			: null;
		if (csrfToken) {
			headers.set("X-CSRF-Token", csrfToken);
		}
	}

	// Auto-inject Content-Type for JSON bodies
	if (init?.body && typeof init.body === "string" && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	// Raw mode — return the original Response object
	if (init?.raw) {
		return fetch(input, { ...init, headers }) as unknown as T;
	}

	const response = await fetch(input, { ...init, headers });

	if (!response.ok) {
		let message = `请求失败 (${response.status})`;
		try {
			const errBody = await response.json();
			message = errBody.error || errBody.message || message;
		} catch { /* ignore parse failure */ }
		throw new Error(message);
	}

	return response.json();
}
