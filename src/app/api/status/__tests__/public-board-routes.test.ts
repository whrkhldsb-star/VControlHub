/**
 * Public status board routes: anonymous, read-only, no-store, uniform 404,
 * and `?preview=1` honoured for platform administrators only.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { customerSession, platformSession, routeSession } from "@/test/route-session-mock";

vi.mock("@/lib/auth/api-session", async () => {
	const { NextResponse } = await import("next/server");
	return {
		getApiSession: vi.fn(async () => routeSession.current),
		requireApiSession: vi.fn(async () => routeSession.current ?? NextResponse.json({ error: "unauthenticated" }, { status: 401 })),
		isSessionPayload: (value: unknown) => !(value instanceof Response),
	};
});
const rateLimit = vi.hoisted(() => vi.fn(async () => ({ allowed: true, retryAfterMs: 0, remaining: 1 })));
vi.mock("@/lib/rate-limit", async (original) => ({
	...await original<typeof import("@/lib/rate-limit")>(),
	checkRateLimitAsync: rateLimit,
}));
const read = vi.hoisted(() => ({ readPublicBoard: vi.fn(), readPublicNode: vi.fn(), readPublicHistory: vi.fn() }));
vi.mock("@/lib/public-status/read", () => read);
const collect = vi.hoisted(() => vi.fn());
vi.mock("@/lib/health/service-collect", () => ({ collectAllHealth: collect }));

const board = await import("../board/route");
const node = await import("../nodes/[publicId]/route");
const history = await import("../nodes/[publicId]/history/route");
const params = Promise.resolve({ publicId: "abcdefghijkl" });

describe("public status board routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = null;
		read.readPublicBoard.mockResolvedValue({ nodes: [], summary: { total: 0 } });
		read.readPublicNode.mockResolvedValue({ node: { id: "abcdefghijkl" } });
		read.readPublicHistory.mockResolvedValue({ range: "24h" });
	});

	it("serves anonymous visitors with no-store and a shared rate-limit bucket", async () => {
		const response = await board.GET(new Request("http://local/api/status/board?q=tokyo&page=2&pageSize=500"));
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("no-store");
		expect(read.readPublicBoard).toHaveBeenCalledWith(expect.objectContaining({ q: "tokyo", page: 2, pageSize: 100 }), { preview: false });
		expect(rateLimit).toHaveBeenCalledWith(expect.stringMatching(/^public-status:/), expect.objectContaining({ maxRequests: 240 }));
		// Reading the board never starts a live collection.
		expect(collect).not.toHaveBeenCalled();
	});

	it("answers the same 404 for a closed board, a hidden node and an unknown id", async () => {
		read.readPublicBoard.mockResolvedValue(null);
		read.readPublicNode.mockResolvedValue(null);
		read.readPublicHistory.mockResolvedValue(null);
		const responses = [
			await board.GET(new Request("http://local/api/status/board")),
			await node.GET(new Request("http://local/api/status/nodes/abcdefghijkl"), { params }),
			await history.GET(new Request("http://local/api/status/nodes/abcdefghijkl/history"), { params }),
		];
		const bodies = await Promise.all(responses.map((response) => response.json()));
		expect(responses.map((response) => response.status)).toEqual([404, 404, 404]);
		expect(new Set(bodies.map((body) => body.code))).toEqual(new Set(["NOT_FOUND"]));
		expect(responses.every((response) => response.headers.get("cache-control") === "no-store")).toBe(true);
	});

	it("honours ?preview=1 only for platform administrators", async () => {
		await board.GET(new Request("http://local/api/status/board?preview=1"));
		expect(read.readPublicBoard).toHaveBeenLastCalledWith(expect.anything(), { preview: false });
		routeSession.current = customerSession(["health:read"]);
		await board.GET(new Request("http://local/api/status/board?preview=1"));
		expect(read.readPublicBoard).toHaveBeenLastCalledWith(expect.anything(), { preview: false });
		routeSession.current = platformSession();
		await board.GET(new Request("http://local/api/status/board?preview=1"));
		expect(read.readPublicBoard).toHaveBeenLastCalledWith(expect.anything(), { preview: true });
		// Without the parameter a signed-in administrator gets the plain public read.
		await node.GET(new Request("http://local/api/status/nodes/abcdefghijkl"), { params });
		expect(read.readPublicNode).toHaveBeenLastCalledWith("abcdefghijkl", { preview: false });
	});

	it("bounds the history range", async () => {
		await history.GET(new Request("http://local/api/status/nodes/abcdefghijkl/history?range=365d"), { params });
		expect(read.readPublicHistory).toHaveBeenLastCalledWith("abcdefghijkl", "24h", { preview: false });
		await history.GET(new Request("http://local/api/status/nodes/abcdefghijkl/history?range=7d"), { params });
		expect(read.readPublicHistory).toHaveBeenLastCalledWith("abcdefghijkl", "7d", { preview: false });
	});

	it("returns 429 when the shared bucket is exhausted", async () => {
		rateLimit.mockResolvedValueOnce({ allowed: false, retryAfterMs: 5_000, remaining: 0 });
		const response = await board.GET(new Request("http://local/api/status/board"));
		expect(response.status).toBe(429);
		expect(read.readPublicBoard).not.toHaveBeenCalled();
	});

	it("exposes GET only", () => {
		for (const routeModule of [board, node, history]) expect(Object.keys(routeModule).filter((key) => /^(POST|PUT|PATCH|DELETE)$/.test(key))).toEqual([]);
	});
});
