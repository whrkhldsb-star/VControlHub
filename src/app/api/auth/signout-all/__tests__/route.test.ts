import { beforeEach, describe, expect, it, vi } from "vitest";

import { platformSession, routeSession } from "@/test/route-session-mock";

vi.mock("@/lib/auth/api-session", async () => {
	const { NextResponse } = await import("next/server");
	const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
	return {
		getApiSession: vi.fn(async () => routeSession.current),
		requireApiSession: vi.fn(async () => routeSession.current ?? unauthenticated()),
		isSessionPayload: (value: unknown) => !(value instanceof Response),
	};
});
vi.mock("@/lib/http/rate-limit-presets", () => ({
	GENERAL_WRITE_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ bumpUserSessionEpoch: vi.fn(), auditUserAction: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({
	bumpUserSessionEpoch: mocks.bumpUserSessionEpoch,
	getSessionCookieName: () => "vch_session",
	getPending2faCookieName: () => "vch_pending_2fa",
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../route");
const post = () => route.POST(new Request("http://local/api/auth/signout-all", { method: "POST" }));

describe("POST /api/auth/signout-all", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession();
	});

	it("is only for a signed-in account", async () => {
		routeSession.current = null;
		expect((await post()).status).toBe(401);
		expect(mocks.bumpUserSessionEpoch).not.toHaveBeenCalled();
	});

	it("retires every session of the account and clears this browser's cookies", async () => {
		const res = await post();
		expect(res.status).toBe(200);
		expect(mocks.bumpUserSessionEpoch).toHaveBeenCalledWith("u_admin");
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_admin", "auth.signout_all", expect.objectContaining({ username: "admin" }), "WARNING", null);
		const cleared = res.headers.getSetCookie().map((cookie) => cookie.split("=")[0]);
		expect(cleared).toEqual(expect.arrayContaining(["vch_session", "csrf_token", "vch_pending_2fa"]));
		for (const cookie of res.headers.getSetCookie()) expect(cookie).toMatch(/Max-Age=0/i);
	});
});
