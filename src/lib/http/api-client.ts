/**
 * Unified API Client — wraps fetch with CSRF protection, error handling, and typed responses.
 *
 * Usage:
 *   import { api } from "@/lib/http/api-client";
 *   const data = await api.get<Server[]>("/api/servers");
 *   const result = await api.post<AlertRule>("/api/alert-rules", { name: "..." });
 *
 * Error handling (TR-034 R3):
 *   Every non-2xx response throws an `ApiError` carrying the server's
 *   `{ code, message, error, details? }` envelope (or the legacy `{ error }`
 *   body). Front-end code can switch on `err.code` to pick the right UX:
 *   redirect to /login for `AUTH_REQUIRED`, show a per-field error for
 *   `VALIDATION_FAILED`, etc. `err.category` is a coarse grouping that
 *   abstracts the exact code for toast variant / severity decisions.
 *
 * CSRF cookie reading is shared with `@/lib/auth/csrf-client` (single source).
 */

import { getCsrfTokenFromCookie } from "@/lib/auth/csrf-client";
import { ApiError } from "@/lib/http/api-client-error";

export { ApiError } from "@/lib/http/api-client-error";

// ── CSRF ──────────────────────────────────────────────────────────
const CSRF_HEADER_NAME = "x-csrf-token";

function isStateChanging(method: string): boolean {
	return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

// ── Core fetch wrapper ────────────────────────────────────────────
async function request<T>(
	url: string,
	init?: RequestInit & { params?: Record<string, string> },
): Promise<T> {
	const method = (init?.method ?? "GET").toUpperCase();

	// Build headers
	const headers = new Headers(init?.headers);
	if (!headers.has("Content-Type") && method !== "GET" && method !== "HEAD") {
		headers.set("Content-Type", "application/json");
	}

	// Auto-inject CSRF token for state-changing requests (shared cookie reader)
	if (isStateChanging(method)) {
		const csrfToken = getCsrfTokenFromCookie();
		if (csrfToken) {
			headers.set(CSRF_HEADER_NAME, csrfToken);
		}
	}

	// Append query params if any
	let finalUrl = url;
	if (init?.params) {
		const qs = new URLSearchParams(init.params).toString();
		finalUrl = `${url}${url.includes("?") ? "&" : "?"}${qs}`;
	}

	const response = await fetch(finalUrl, { ...init, headers });

	// Handle non-OK responses
	if (!response.ok) {
		let body: Record<string, unknown> = {};
		try {
			body = (await response.json()) as Record<string, unknown>;
		} catch {
			// Response body is not valid JSON — use status text as the error message.
			body = { error: response.statusText };
		}
		throw new ApiError(response.status, body);
	}

	// Handle 204 No Content
	if (response.status === 204) {
		return undefined as T;
	}

	return response.json() as Promise<T>;
}

// ── Public API ────────────────────────────────────────────────────
export const api = {
	/** GET request with typed response */
	get<T>(url: string, init?: RequestInit): Promise<T> {
		return request<T>(url, { ...init, method: "GET" });
	},

	/** POST request with JSON body */
	post<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
		return request<T>(url, {
			...init,
			method: "POST",
			body: body ? JSON.stringify(body) : undefined,
		});
	},

	/** PUT request with JSON body */
	put<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
		return request<T>(url, {
			...init,
			method: "PUT",
			body: body ? JSON.stringify(body) : undefined,
		});
	},

	/** PATCH request with JSON body */
	patch<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
		return request<T>(url, {
			...init,
			method: "PATCH",
			body: body ? JSON.stringify(body) : undefined,
		});
	},

	/** DELETE request */
	delete<T = void>(url: string, init?: RequestInit): Promise<T> {
		return request<T>(url, { ...init, method: "DELETE" });
	},
};
