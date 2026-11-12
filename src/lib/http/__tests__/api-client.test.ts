import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { ApiError, NetworkError, api, apiRequest } from "@/lib/http/api-client";

/** Minimal `fetch` mock that returns a Response-like object with `ok` + `status`. */
function mockFetchOnce(status: number, body: unknown): typeof fetch {
	const fn = vi.fn().mockResolvedValueOnce({
		ok: status >= 200 && status < 300,
		status,
		statusText: `Status ${status}`,
		headers: new Headers({ "content-type": "application/json" }),
		json: async () => body,
		text: async () => JSON.stringify(body),
	} as unknown as Response);
	return fn as unknown as typeof fetch;
}

describe("lib/http/api-client — ApiError envelope (TR-034 R3)", () => {
	let originalFetch: typeof fetch;

	beforeEach(() => {
		originalFetch = globalThis.fetch;
	});
	afterEach(() => {
		globalThis.fetch = originalFetch;
		vi.restoreAllMocks();
	});

	it("parses the new { code, message, error, details? } envelope", async () => {
		globalThis.fetch = mockFetchOnce(400, {
			code: "VALIDATION_FAILED",
			message: "缺少 id",
			error: "缺少 id",
			details: { field: "id" },
		});
		await expect(api.get("/api/x")).rejects.toMatchObject({
			status: 400,
			code: "VALIDATION_FAILED",
			category: "validation",
			message: "缺少 id",
			details: { field: "id" },
		});
	});

	it("falls back to the legacy { error } body when no code is present", async () => {
		globalThis.fetch = mockFetchOnce(403, { error: "未登录或会话已过期" });
		const err = (await api.get("/api/x").catch((e) => e)) as ApiError;
		expect(err).toBeInstanceOf(ApiError);
		expect(err.status).toBe(403);
		// Unknown code → collapses to GENERIC_ERROR / category "unknown"
		expect(err.code).toBe("GENERIC_ERROR");
		expect(err.category).toBe("unknown");
		expect(err.message).toBe("未登录或会话已过期");
		expect(err.details).toBeUndefined();
	});

	it("collapses an unrecognised code to GENERIC_ERROR instead of throwing", async () => {
		globalThis.fetch = mockFetchOnce(500, {
			code: "TOTALLY_MADE_UP_CODE",
			message: "boom",
			error: "boom",
		});
		const err = (await api.get("/api/x").catch((e) => e)) as ApiError;
		expect(err.code).toBe("GENERIC_ERROR");
		expect(err.category).toBe("unknown");
		expect(err.message).toBe("boom");
	});

	it("maps known server codes to the right category", async () => {
		const cases: Array<{ code: string; category: string; status: number }> = [
			{ code: "AUTH_REQUIRED", category: "auth", status: 401 },
			{ code: "FORBIDDEN", category: "permission", status: 403 },
			{ code: "NOT_FOUND", category: "notfound", status: 404 },
			{ code: "CONFLICT", category: "conflict", status: 409 },
			{ code: "RATE_LIMITED", category: "ratelimit", status: 429 },
			{ code: "INTERNAL_ERROR", category: "server", status: 500 },
		];
		for (const c of cases) {
			globalThis.fetch = mockFetchOnce(c.status, {
				code: c.code,
				message: "x",
				error: "x",
			});
			const err = (await api.get("/api/x").catch((e) => e)) as ApiError;
			expect(err.code, c.code).toBe(c.code);
			expect(err.category, c.code).toBe(c.category);
		}
	});

	it("returns undefined for a 204 No Content body", async () => {
		globalThis.fetch = mockFetchOnce(204, undefined);
		const data = await api.delete("/api/x");
		expect(data).toBeUndefined();
	});

	it("keeps csrfFetch as a compatibility entry point over the shared request core", async () => {
		globalThis.fetch = mockFetchOnce(200, { ok: true });
		await expect(csrfFetch<{ ok: boolean }>("/api/x")).resolves.toEqual({ ok: true });
	});

	it("returns the untouched non-OK response in raw mode", async () => {
		const response = { ok: false, status: 503 } as Response;
		globalThis.fetch = vi.fn().mockResolvedValue(response) as unknown as typeof fetch;
		await expect(apiRequest<Response>("/api/x", { raw: true })).resolves.toBe(response);
	});

	it("appends typed query parameters without discarding an existing query", async () => {
		const spy = mockFetchOnce(200, { ok: true });
		globalThis.fetch = spy;
		await api.get("/api/x?fixed=1", { params: { page: "2", search: "a b" } });
		expect(vi.mocked(spy).mock.calls[0]?.[0]).toBe("/api/x?fixed=1&page=2&search=a+b");
	});

	it("does not force application/json Content-Type for FormData bodies", async () => {
		const form = new FormData();
		form.append("file", new Blob(["x"]), "x.txt");
		const spy = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		} as unknown as Response);
		globalThis.fetch = spy as unknown as typeof fetch;
		await api.post("/api/upload", form);
		const headers = spy.mock.calls[0]?.[1]?.headers as Headers | undefined;
		const sentBody = spy.mock.calls[0]?.[1]?.body;
		expect(headers?.get("Content-Type")).toBeNull();
		expect(sentBody).toBe(form);
	});

	it("still defaults Content-Type to application/json for plain JSON posts", async () => {
		const spy = vi.fn().mockResolvedValue({
			ok: true,
			status: 200,
			json: async () => ({ ok: true }),
		} as unknown as Response);
		globalThis.fetch = spy as unknown as typeof fetch;
		await api.post("/api/x", { foo: 1 });
		const headers = spy.mock.calls[0]?.[1]?.headers as Headers | undefined;
		expect(headers?.get("Content-Type")).toBe("application/json");
	});

	it("wraps a non-JSON 500 body into a fallback ApiError", async () => {
		const fn = vi.fn().mockResolvedValueOnce({
			ok: false,
			status: 500,
			statusText: "Internal Server Error",
			headers: new Headers({ "content-type": "text/plain" }),
			json: async () => {
				throw new Error("not json");
			},
		} as unknown as Response);
		globalThis.fetch = fn as unknown as typeof fetch;
		const err = (await api.get("/api/x").catch((e) => e)) as ApiError;
		expect(err.status).toBe(500);
		// The status is named in the page's language; the status text is English and absent over HTTP/2.
		expect(err.message).toBe("请求失败（HTTP 500）");
	});

	describe("a request that got no answer", () => {
		afterEach(() => {
			delete document.documentElement.dataset.locale;
			document.documentElement.lang = "";
		});

		it("says so in the page's language instead of the browser's own English", async () => {
			// What fetch rejects with while the server restarts or the network is down: "Failed to fetch" in Chrome,
			// "Load failed" in Safari, "NetworkError when attempting to fetch resource." in Firefox. Every toast showed it.
			globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("Failed to fetch")) as unknown as typeof fetch;
			const zh = (await api.get("/api/x").catch((e) => e)) as Error;
			expect(zh).toBeInstanceOf(NetworkError);
			expect(zh).not.toBeInstanceOf(ApiError);
			expect(zh.name).toBe("NetworkError");
			expect(zh.message).toBe("无法连接到服务器，请检查网络后重试");
			expect((zh.cause as Error).message).toBe("Failed to fetch");

			document.documentElement.dataset.locale = "en";
			const en = (await apiRequest("/api/x", { method: "POST", body: "{}" }).catch((e) => e)) as Error;
			expect(en.message).toBe("Could not reach the server. Check your connection and try again.");

			// Raw mode gets the same: the failure comes before there is a response to hand over.
			const raw = (await apiRequest<Response>("/api/x", { raw: true }).catch((e) => e)) as Error;
			expect(raw).toBeInstanceOf(NetworkError);
		});

		it("lets an abort through as it is: that is the caller's own doing", async () => {
			const aborted = new DOMException("The operation was aborted.", "AbortError");
			globalThis.fetch = vi.fn().mockRejectedValue(aborted) as unknown as typeof fetch;
			const controller = new AbortController();
			controller.abort();
			await expect(apiRequest("/api/x", { signal: controller.signal })).rejects.toBe(aborted);
			// Some engines reject an aborted request with a TypeError; the signal decides.
			const odd = new TypeError("cancelled");
			globalThis.fetch = vi.fn().mockRejectedValue(odd) as unknown as typeof fetch;
			await expect(apiRequest("/api/x", { signal: controller.signal })).rejects.toBe(odd);
		});

		it("leaves anything else alone", async () => {
			const other = new Error("stream reset by test");
			globalThis.fetch = vi.fn().mockRejectedValue(other) as unknown as typeof fetch;
			await expect(api.get("/api/x")).rejects.toBe(other);
		});

		it("names the status in the page's language when a refusal is not the app's answer", async () => {
			// A proxy in front of the app while it restarts: an HTML page, and over HTTP/2 no status text either.
			const proxyPage = () => ({
				ok: false,
				status: 502,
				statusText: "",
				headers: new Headers({ "content-type": "text/html" }),
				json: async () => {
					throw new Error("not json");
				},
			}) as unknown as Response;
			globalThis.fetch = vi.fn().mockResolvedValue(proxyPage()) as unknown as typeof fetch;
			const zh = (await api.get("/api/x").catch((e) => e)) as ApiError;
			expect(zh).toBeInstanceOf(ApiError);
			expect(zh.status).toBe(502);
			expect(zh.message).toBe("请求失败（HTTP 502）");
			document.documentElement.lang = "en";
			const en = (await api.get("/api/x").catch((e) => e)) as ApiError;
			expect(en.message).toBe("Request failed (HTTP 502)");
		});
	});

	it("attaches CSRF header on POST but not on GET", async () => {
		// Stub the cookie reader so we can assert the header side-effect.
		document.cookie = "csrf_token=abc123";
		const getSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
		const postSpy = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({}) } as unknown as Response);
		globalThis.fetch = getSpy;
		await api.get("/api/x");
		const getHeaders = getSpy.mock.calls[0]?.[1]?.headers as Headers | undefined;
		expect(getHeaders?.get("x-csrf-token")).toBeNull();
		globalThis.fetch = postSpy;
		await api.post("/api/x", { foo: 1 });
		const postHeaders = postSpy.mock.calls[0]?.[1]?.headers as Headers | undefined;
		expect(postHeaders?.get("x-csrf-token")).toBe("abc123");
		document.cookie = "csrf_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
	});
});
