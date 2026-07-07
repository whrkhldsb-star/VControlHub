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
 */

import { categoryForCode, isApiErrorCode, toApiErrorCode, type ApiErrorCategory, type ApiErrorCode } from "@/lib/http/api-error-codes";

// ── CSRF ──────────────────────────────────────────────────────────
const CSRF_COOKIE_NAME = "csrf_token";
const CSRF_HEADER_NAME = "x-csrf-token";

function getCsrfToken(): string | null {
	if (typeof document === "undefined") return null;
	const cookie = document.cookie
		.split(";")
		.map((c) => c.trim())
		.find((c) => c.startsWith(`${CSRF_COOKIE_NAME}=`));
	if (!cookie) return null;
	return decodeURIComponent(cookie.split("=").slice(1).join("="));
}

function isStateChanging(method: string): boolean {
	return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

// ── Error type ───────────────────────────────────────────────────

/**
 * Thrown by the client for every non-2xx response. The original response body
 * is preserved on `body` (typed loosely to support both the new
 * `{ code, message, error, details? }` envelope and any legacy body shape),
 * but the canonical `code`, `category`, and `message` fields are surfaced
 * for ergonomic dispatch in the front-end.
 */
export class ApiError extends Error {
	readonly status: number;
	readonly code: ApiErrorCode;
	readonly category: ApiErrorCategory;
	readonly body: Record<string, unknown>;
	readonly details?: unknown;

	constructor(
		status: number,
		body: Record<string, unknown>,
	) {
		// Prefer the canonical `message` field (TR-034 envelope), fall back to
		// the legacy `error` mirror, fall back to statusText.
		const rawMessage =
			(typeof body.message === "string" && body.message) ||
			(typeof body.error === "string" && body.error) ||
			`API Error ${status}`;
		super(rawMessage);
		this.name = "ApiError";
		this.status = status;
		this.body = body;
		this.code = isApiErrorCode(body.code) ? body.code : toApiErrorCode(body.code);
		this.category = categoryForCode(this.code);
		// Pass `details` through when it's a structured object; otherwise drop
		// it to avoid leaking server-internal noise into the UI.
		this.details = body.details !== undefined ? body.details : undefined;
	}
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

	// Auto-inject CSRF token for state-changing requests
	if (isStateChanging(method)) {
		const csrfToken = getCsrfToken();
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
