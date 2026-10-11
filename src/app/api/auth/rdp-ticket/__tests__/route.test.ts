import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { customerSession, routeSession } from "@/test/route-session-mock";

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
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	UPLOAD_CHUNK_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ verifySessionToken: vi.fn(), mintRdpTicket: vi.fn(), rdpOriginAllowed: vi.fn(), auditUserAction: vi.fn(), authenticateBearerForPermissions: vi.fn() }));
vi.mock("@/lib/auth/bearer-token", async (original) => ({ ...((await original()) as Record<string, unknown>), authenticateBearerForPermissions: mocks.authenticateBearerForPermissions }));
vi.mock("@/lib/auth/session", async (original) => ({ ...((await original()) as Record<string, unknown>), getSessionCookieName: () => "vch_session", verifySessionToken: mocks.verifySessionToken }));
vi.mock("@/lib/rdp/tickets", () => ({ mintRdpTicket: mocks.mintRdpTicket, rdpOriginAllowed: mocks.rdpOriginAllowed }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../route");
const post = (headers: Record<string, string>, body: unknown = { serverId: "srv_1" }) =>
	route.POST(new NextRequest("http://local/api/auth/rdp-ticket", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));
const withCookie = { cookie: "vch_session=tok", origin: "http://local" };

describe("POST /api/auth/rdp-ticket", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["server:ssh"]);
		mocks.rdpOriginAllowed.mockReturnValue(true);
		mocks.verifySessionToken.mockResolvedValue({ ...customerSession(["server:ssh"]), mustChangePassword: false });
		mocks.mintRdpTicket.mockResolvedValue("ticket-1");
	});

	it("mints a short-lived ticket bound to the browser cookie session", async () => {
		const res = await post(withCookie);
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ token: "ticket-1", expiresIn: 30, path: "/rdp", protocol: "guacamole" });
		expect(res.headers.get("cache-control")).toBe("no-store");
		expect(mocks.mintRdpTicket).toHaveBeenCalledWith("srv_1", expect.objectContaining({ userId: "u_cust" }), "tok", "http://local");
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "server.rdp.ticket", { serverId: "srv_1" }, undefined, "team_1");
	});

	it("refuses foreign origins, bearer-only callers, missing cookies and mismatched cookie sessions", async () => {
		mocks.rdpOriginAllowed.mockReturnValueOnce(false);
		expect((await post(withCookie)).status).toBe(403);
		expect((await post({ origin: "http://local" })).status).toBe(401);
		// Even a valid API token with server:ssh is refused: tickets are for browser sessions only.
		mocks.authenticateBearerForPermissions.mockResolvedValueOnce({ session: customerSession(["server:ssh"]), scopes: [], tokenId: "tok_1" });
		expect((await post({ ...withCookie, authorization: "Bearer api-token" })).status).toBe(403);
		mocks.verifySessionToken.mockResolvedValueOnce({ ...customerSession(["server:ssh"], { userId: "u_other" }), mustChangePassword: false });
		expect((await post(withCookie)).status).toBe(403);
		mocks.verifySessionToken.mockResolvedValueOnce({ ...customerSession(["server:ssh"]), mustChangePassword: true });
		expect((await post(withCookie)).status).toBe(403);
		expect(mocks.mintRdpTicket).not.toHaveBeenCalled();
	});

	it("needs server:ssh and a strict body", async () => {
		routeSession.current = customerSession(["server:read"]);
		expect((await post(withCookie)).status).toBe(403);
		routeSession.current = customerSession(["server:ssh"]);
		expect((await post(withCookie, { serverId: "srv_1", extra: true })).status).toBe(400);
	});
});
