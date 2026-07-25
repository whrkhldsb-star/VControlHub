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
	const body = init?.body;
	const skipDefaultJsonContentType =
		typeof FormData !== "undefined" && body instanceof FormData
		|| typeof Blob !== "undefined" && body instanceof Blob
		|| typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams
		|| (typeof ReadableStream !== "undefined" && body instanceof ReadableStream);
	if (
		!headers.has("Content-Type")
		&& method !== "GET"
		&& method !== "HEAD"
		&& !skipDefaultJsonContentType
	) {
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
function encodeRequestBody(body: unknown | undefined, initBody: BodyInit | null | undefined): BodyInit | undefined {
	if (body === undefined || body === null) {
		return initBody ?? undefined;
	}
	if (typeof FormData !== "undefined" && body instanceof FormData) return body;
	if (typeof Blob !== "undefined" && body instanceof Blob) return body;
	if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) return body;
	if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) return body;
	if (typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) return body;
	if (typeof body === "string") return body;
	return JSON.stringify(body);
}

export const api = {
	/** GET request with typed response */
	get<T>(url: string, init?: RequestInit): Promise<T> {
		return request<T>(url, { ...init, method: "GET" });
	},

	/** POST request — JSON by default; FormData/Blob/URLSearchParams pass through without forced Content-Type */
	post<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
		return request<T>(url, {
			...init,
			method: "POST",
			body: encodeRequestBody(body, init?.body),
		});
	},

	/** PUT request — JSON by default; binary/multipart bodies pass through */
	put<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
		return request<T>(url, {
			...init,
			method: "PUT",
			body: encodeRequestBody(body, init?.body),
		});
	},

	/** PATCH request — JSON by default; binary/multipart bodies pass through */
	patch<T>(url: string, body?: unknown, init?: RequestInit): Promise<T> {
		return request<T>(url, {
			...init,
			method: "PATCH",
			body: encodeRequestBody(body, init?.body),
		});
	},

	/** DELETE request */
	delete<T = void>(url: string, init?: RequestInit): Promise<T> {
		return request<T>(url, { ...init, method: "DELETE" });
	},
};
