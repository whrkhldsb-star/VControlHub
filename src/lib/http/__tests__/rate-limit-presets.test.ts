// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getRateLimitStore, rateLimitNamespace } from "@/lib/rate-limit-store";

import { GENERAL_READ_LIMIT, GENERAL_WRITE_LIMIT, withRateLimit } from "../rate-limit-presets";

let path = 0;
/** A path no other test has counted against (the store is one per process). */
function freshPath() {
	path += 1;
	return `/api/limit-test/${path}`;
}

function call(pathname: string, config: Parameters<typeof withRateLimit>[1], ip = "203.0.113.7", method = "GET") {
	return withRateLimit(new Request(`https://hub.example${pathname}`, { method, headers: { "x-forwarded-for": ip } }), config);
}

beforeEach(() => {
	vi.stubEnv("REDIS_URL", "");
	// One proxy in front, as deployed: the address is the last X-Forwarded-For entry. Without it every
	// request is "unknown", which is what a development environment file may set.
	vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
	vi.useFakeTimers();
	vi.setSystemTime(1_000_000);
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllEnvs();
});

describe("withRateLimit", () => {
	// One count per path and address served every limit of the path. A list that is read 30 times in a
	// minute from one address (a few people behind one office address) then refused every change with 429.
	it("does not spend a path's write budget on its reads", async () => {
		const pathname = freshPath();
		for (let index = 0; index < GENERAL_WRITE_LIMIT.maxRequests; index++) {
			expect((await call(pathname, GENERAL_READ_LIMIT)).allowed).toBe(true);
		}

		const write = await call(pathname, GENERAL_WRITE_LIMIT, undefined, "POST");

		expect(write).toMatchObject({ allowed: true, remaining: GENERAL_WRITE_LIMIT.maxRequests - 1 });
	});

	it("still stops the writes at their own limit, and only the writes", async () => {
		const pathname = freshPath();
		for (let index = 0; index < GENERAL_WRITE_LIMIT.maxRequests; index++) {
			expect((await call(pathname, GENERAL_WRITE_LIMIT, undefined, "POST")).allowed).toBe(true);
		}

		const refused = await call(pathname, GENERAL_WRITE_LIMIT, undefined, "DELETE");

		expect(refused.allowed).toBe(false);
		expect(refused.retryAfterMs).toBeGreaterThan(0);
		expect((await call(pathname, GENERAL_READ_LIMIT)).allowed).toBe(true);
	});

	// The store keeps what the calling limit needs (its newest N + 1 requests): a write on the shared
	// count cut it down to 31, so a client that mixed in a write now and then was never held to 120 reads.
	it("holds the reads to their limit while writes are made on the same path", async () => {
		const pathname = freshPath();
		for (let index = 0; index < GENERAL_READ_LIMIT.maxRequests - 1; index++) {
			expect((await call(pathname, GENERAL_READ_LIMIT)).allowed).toBe(true);
		}
		for (let index = 0; index <= GENERAL_WRITE_LIMIT.maxRequests; index++) {
			await call(pathname, GENERAL_WRITE_LIMIT, undefined, "POST");
		}

		expect((await call(pathname, GENERAL_READ_LIMIT)).allowed).toBe(true);
		expect((await call(pathname, GENERAL_READ_LIMIT)).allowed).toBe(false);
	});

	// A check prunes by its own window: on a shared count the short limit forgot what the long one needed.
	it("keeps the history a longer window needs when a shorter limit is checked on the same path", async () => {
		const pathname = freshPath();
		const burst = { maxRequests: 2, windowMs: 1_000 };
		const sustained = { maxRequests: 3, windowMs: 10 * 60_000 };
		const verdicts: boolean[] = [];
		for (let index = 0; index < 4; index++) {
			expect((await call(pathname, burst, undefined, "POST")).allowed).toBe(true);
			verdicts.push((await call(pathname, sustained, undefined, "POST")).allowed);
			vi.advanceTimersByTime(2_000);
		}

		expect(verdicts).toEqual([true, true, true, false]);
	});

	it("counts each client address on its own", async () => {
		const pathname = freshPath();
		const limit = { maxRequests: 1, windowMs: 60_000 };
		expect((await call(pathname, limit, "203.0.113.7")).allowed).toBe(true);
		expect((await call(pathname, limit, "203.0.113.7")).allowed).toBe(false);

		expect((await call(pathname, limit, "203.0.113.8")).allowed).toBe(true);
	});

	it("shares a named bucket between paths, per limit", async () => {
		const name = `named-${freshPath().replaceAll("/", "-")}`;
		const limit = { maxRequests: 2, windowMs: 60_000, bucketKey: name };
		expect((await call(freshPath(), limit)).allowed).toBe(true);
		expect((await call(freshPath(), limit)).allowed).toBe(true);
		expect((await call(freshPath(), limit)).allowed).toBe(false);

		// Another limit under the same name starts from its own count.
		expect((await call(freshPath(), { maxRequests: 3, windowMs: 60_000, bucketKey: name })).allowed).toBe(true);
	});

	it("keeps path buckets in the path namespace and named ones under their name", async () => {
		const add = vi.spyOn(getRateLimitStore(), "addAndGetWindow");
		try {
			const pathname = freshPath();
			await call(pathname, GENERAL_WRITE_LIMIT, "203.0.113.9", "POST");
			await call(pathname, { maxRequests: 240, windowMs: 60_000, bucketKey: "public-status" }, "203.0.113.9");

			const [pathKey = "", namedKey = ""] = add.mock.calls.map(([key]) => key);
			expect(pathKey.startsWith(`${pathname}:`)).toBe(true);
			expect(pathKey.endsWith(":203.0.113.9")).toBe(true);
			expect(rateLimitNamespace(pathKey)).toBe("path");
			expect(namedKey.startsWith("public-status:")).toBe(true);
			expect(rateLimitNamespace(namedKey)).toBe("public-status");
		} finally {
			add.mockRestore();
		}
	});
});
