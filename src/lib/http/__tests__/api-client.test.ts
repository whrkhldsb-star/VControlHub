import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api } from "@/lib/http/api-client";

/** Minimal `fetch` mock that returns a Response-like object with `ok` + `status`. */
function mockFetchOnce(status: number, body: unknown): typeof fetch {
	const fn = vi.fn().mockResolvedValueOnce({
		ok: status >= 200 && status < 300,
		status,
		statusText: `Status ${status}`,
		headers: new Headers({ "content-type": "application/json" }),
		json: async () => body,
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
		// statusText flows into the message
		expect(err.message).toBe("Internal Server Error");
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
