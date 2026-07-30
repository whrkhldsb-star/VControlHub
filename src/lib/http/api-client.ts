/** Unified browser API client with CSRF protection and typed JSON responses. */

import { getCsrfTokenFromCookie } from "@/lib/auth/csrf-token";
import { ApiError } from "@/lib/http/api-client-error";

export { ApiError } from "@/lib/http/api-client-error";

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

export async function apiRequest<T>(input: RequestInfo | URL, init: ApiRequestInit = {}): Promise<T> {
	const { params, raw = false, ...fetchInit } = init;
	const method = (fetchInit.method ?? "GET").toUpperCase();
	const headers = new Headers(fetchInit.headers);
	const body = fetchInit.body;

	if (isStateChanging(method)) {
		const csrfToken = getCsrfTokenFromCookie();
		if (csrfToken) headers.set(CSRF_HEADER_NAME, csrfToken);
	}
	if (body !== undefined && body !== null && typeof body === "string" && !headers.has("Content-Type")) {
		headers.set("Content-Type", "application/json");
	}

	const response = await fetch(appendParams(input, params), { ...fetchInit, method, headers });
	if (raw) return response as T;

	if (!response.ok) {
		let errorBody: Record<string, unknown>;
		try {
			errorBody = (await response.json()) as Record<string, unknown>;
		} catch {
			errorBody = { error: response.statusText || `Request failed (${response.status})` };
		}
		throw new ApiError(response.status, errorBody);
	}
	if (response.status === 204) return undefined as T;
	return response.json() as Promise<T>;
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
