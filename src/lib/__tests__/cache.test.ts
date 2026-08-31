import { describe, expect, it } from "vitest";

/**
 * Tests for the API cache-header helpers.
 *
 * The rule that matters: when neither `maxAge` nor `staleWhileRevalidate` is set,
 * the header must be `no-store`, not `no-cache`. `no-cache` forces revalidation
 * but still permits storage, so a response carrying tenant data would sit in the
 * browser's disk cache (and any intermediary that honours it) after logout. The
 * module comment says as much; these cases hold it in place.
 *
 * `visibility` defaults to `private` for the same reason — `public` on a
 * per-tenant response invites a shared cache to serve one team's data to another.
 */
import { buildCacheControl, CachePresets, withCacheHeaders } from "../cache";

describe("buildCacheControl", () => {
	it("emits private, no-store by default", () => {
		// The important half is no-store rather than no-cache: no-cache still
		// allows the response to be written to disk.
		expect(buildCacheControl()).toBe("private, no-store");
		expect(buildCacheControl({})).toBe("private, no-store");
	});

	it("defaults visibility to private, never public", () => {
		expect(buildCacheControl({ maxAge: 30 })).toBe("private, max-age=30");
	});

	it("honours an explicit public visibility", () => {
		expect(buildCacheControl({ maxAge: 300, staleWhileRevalidate: 600, visibility: "public" })).toBe(
			"public, max-age=300, stale-while-revalidate=600",
		);
	});

	it("emits no-cache instead of no-store when only stale-while-revalidate is set", () => {
		// A zero maxAge with a stale window is "always revalidate but you may keep
		// serving the old copy meanwhile", which requires storage to be permitted.
		expect(buildCacheControl({ staleWhileRevalidate: 60 })).toBe("private, no-cache, stale-while-revalidate=60");
	});

	it("treats a negative or zero maxAge as not fresh", () => {
		expect(buildCacheControl({ maxAge: 0 })).toBe("private, no-store");
		expect(buildCacheControl({ maxAge: -5 })).toBe("private, no-store");
	});

	it("omits the stale directive when it is zero or negative", () => {
		expect(buildCacheControl({ maxAge: 30, staleWhileRevalidate: 0 })).toBe("private, max-age=30");
		expect(buildCacheControl({ maxAge: 30, staleWhileRevalidate: -1 })).toBe("private, max-age=30");
	});
});

describe("CachePresets", () => {
	it("keeps noStore genuinely non-storable", () => {
		expect(buildCacheControl(CachePresets.noStore)).toBe("private, no-store");
	});

	it("keeps the shortLived preset private", () => {
		// Used by dashboard/analytics and api-tokens listings — per-tenant data
		// that a shared cache must not hold.
		expect(CachePresets.shortLived.visibility).toBe("private");
		expect(buildCacheControl(CachePresets.shortLived)).toBe("private, max-age=30, stale-while-revalidate=60");
	});

	it("marks only the explicitly public preset as public", () => {
		expect(CachePresets.longLivedPublic.visibility).toBe("public");
		expect(buildCacheControl(CachePresets.longLivedPublic)).toBe(
			"public, max-age=300, stale-while-revalidate=600",
		);
	});
});

describe("withCacheHeaders", () => {
	it("sets Cache-Control on the response and returns the same object", () => {
		const response = new Response("{}");
		const returned = withCacheHeaders(response, { maxAge: 30 });
		expect(returned).toBe(response);
		expect(response.headers.get("Cache-Control")).toBe("private, max-age=30");
	});

	it("overwrites a Cache-Control the caller had already set", () => {
		const response = new Response("{}", { headers: { "Cache-Control": "public, max-age=99999" } });
		withCacheHeaders(response, CachePresets.noStore);
		expect(response.headers.get("Cache-Control")).toBe("private, no-store");
	});

	it("sets an ETag only when one is supplied", () => {
		const withEtag = withCacheHeaders(new Response("{}"), { maxAge: 30, etag: '"abc"' });
		expect(withEtag.headers.get("ETag")).toBe('"abc"');
		const without = withCacheHeaders(new Response("{}"), { maxAge: 30 });
		expect(without.headers.get("ETag")).toBeNull();
	});

	it("does not set an empty ETag", () => {
		const response = withCacheHeaders(new Response("{}"), { etag: "" });
		expect(response.headers.get("ETag")).toBeNull();
	});
});
