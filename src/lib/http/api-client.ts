/** Unified browser API client with CSRF protection and typed JSON responses. */

import { getCsrfTokenFromCookie } from "@/lib/auth/csrf-token";
import { ApiError, NetworkError } from "@/lib/http/api-client-error";
import { browserT, pageLocale } from "@/lib/i18n/browser-translations";

export { ApiError, NetworkError } from "@/lib/http/api-client-error";

const CSRF_HEADER_NAME = "x-csrf-token";

export type ApiRequestInit = RequestInit & {
	/** Return the original Response without status or JSON handling. */
	raw?: boolean;
	/** Query parameters for string or URL inputs. */
	params?: Record<string, string>;
};

function isStateChanging(method: string): boolean {
	return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function supportsNativeBody(body: unknown): body is BodyInit {
	return (
		(typeof FormData !== "undefined" && body instanceof FormData) ||
		(typeof Blob !== "undefined" && body instanceof Blob) ||
		(typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) ||
		(typeof ReadableStream !== "undefined" && body instanceof ReadableStream) ||
		(typeof ArrayBuffer !== "undefined" && body instanceof ArrayBuffer) ||
		(typeof ArrayBuffer !== "undefined" && ArrayBuffer.isView(body)) ||
		typeof body === "string"
	);
}

function appendParams(input: RequestInfo | URL, params?: Record<string, string>): RequestInfo | URL {
	if (!params || Object.keys(params).length === 0) return input;
	if (input instanceof URL) {
		const url = new URL(input);
		for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
		return url;
	}
	if (typeof input !== "string") {
		throw new TypeError("API query params require a string or URL input");
	}
	const query = new URLSearchParams(params).toString();
	return `${input}${input.includes("?") ? "&" : "?"}${query}`;
}

function isSameOrigin(input: RequestInfo | URL): boolean {
	if (typeof window === "undefined") return false;
	try {
		const href = typeof input === "string" || input instanceof URL ? input : input.url;
		return new URL(href, document.baseURI).origin === window.location.origin;
	} catch {
		return false;
	}
}

export async function apiRequest<T>(input: RequestInfo | URL, init: ApiRequestInit = {}): Promise<T> {
	const { params, raw = false, ...fetchInit } = init;
	const request = typeof Request !== "undefined" && input instanceof Request ? input : undefined;
	const method = (fetchInit.method ?? request?.method ?? "GET").toUpperCase();
	const headers = new Headers(fetchInit.headers ?? request?.headers);
	const body = fetchInit.body;
	const target = appendParams(input, params);

	// Never leak the session's CSRF token to external/presigned storage URLs,
	// including a token explicitly supplied by a legacy caller.
	if (!isSameOrigin(target)) {
		headers.delete(CSRF_HEADER_NAME);
	} else if (isStateChanging(method)) {
		const csrfToken = getCsrfTokenFromCookie();
		if (csrfToken) headers.set(CSRF_HEADER_NAME, csrfToken);
	}
	if (body !== undefined && body !== null && typeof body === "string" && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	// A redirect must not forward a custom CSRF header to another origin.
	const redirect = headers.has(CSRF_HEADER_NAME) ? "error" : fetchInit.redirect;
	let response: Response;
	try {
		response = await fetch(target, { ...fetchInit, method, headers, ...(redirect ? { redirect } : {}) });
	} catch (error) {
		throw unanswered(error, fetchInit.signal ?? request?.signal);
	}
	if (raw) return response as T;

	if (!response.ok) {
		let errorBody: Record<string, unknown>;
		try {
			errorBody = (await response.json()) as Record<string, unknown>;
		} catch {
			// Not the app's answer — a proxy in front of it while it restarts, say. Its page is not a sentence, and its
			// status text ("Bad Gateway") is missing over HTTP/2: the status is named in the page's language.
			errorBody = { error: browserT("common.requestFailedStatus", pageLocale(), { status: response.status }) };
		}
		throw new ApiError(response.status, errorBody);
	}
	if (response.status === 204) return undefined as T;
	// A 200 with an empty body used to surface as "Unexpected end of JSON input" (A11-03).
	const contentLength = response.headers instanceof Headers ? response.headers.get("content-length") : null;
	if (contentLength === "0") return undefined as T;
	return response.json() as Promise<T>;
}

/**
 * `fetch` rejects when no answer came at all: the server is restarting, the network is down, the connection was
 * cut. Browsers word that in their own English — "Failed to fetch", "Load failed", "NetworkError when attempting
 * to fetch resource." — and every toast and notice showed it. An abort is the caller's own doing and passes as it
 * is, whatever the engine rejects it with.
 */
function unanswered(error: unknown, signal?: AbortSignal | null): unknown {
	if (signal?.aborted || !(error instanceof TypeError)) return error;
	return new NetworkError(browserT("common.networkError", pageLocale()), { cause: error });
}

function encodeRequestBody(body: unknown | undefined, initBody: BodyInit | null | undefined): BodyInit | undefined {
	if (body === undefined || body === null) return initBody ?? undefined;
	if (supportsNativeBody(body)) return body;
	return JSON.stringify(body);
}

export const api = {
	get<T>(url: string, init?: ApiRequestInit): Promise<T> {
		return apiRequest<T>(url, { ...init, method: "GET" });
	},
	post<T>(url: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
		return apiRequest<T>(url, { ...init, method: "POST", body: encodeRequestBody(body, init?.body) });
	},
	put<T>(url: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
		return apiRequest<T>(url, { ...init, method: "PUT", body: encodeRequestBody(body, init?.body) });
	},
	patch<T>(url: string, body?: unknown, init?: ApiRequestInit): Promise<T> {
		return apiRequest<T>(url, { ...init, method: "PATCH", body: encodeRequestBody(body, init?.body) });
	},
	delete<T = void>(url: string, init?: ApiRequestInit): Promise<T> {
		return apiRequest<T>(url, { ...init, method: "DELETE" });
	},
};
