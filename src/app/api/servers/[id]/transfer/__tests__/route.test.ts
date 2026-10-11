import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessError, NotFoundError } from "@/lib/errors";
import { customerSession, platformSession, routeSession } from "@/test/route-session-mock";

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

const mocks = vi.hoisted(() => ({ transferServerToCustomer: vi.fn() }));
vi.mock("@/lib/server/transfer", () => ({ transferServerToCustomer: mocks.transferServerToCustomer }));

const route = await import("../route");
const post = (body: unknown) => route.POST(new Request("http://local/api/servers/srv_1/transfer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params: Promise.resolve({ id: "srv_1" }) });

describe("POST /api/servers/[id]/transfer", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession();
		mocks.transferServerToCustomer.mockResolvedValue({ server: { id: "srv_1", teamId: "team_2" } });
	});

	it("needs team:manage and a non-empty target", async () => {
		routeSession.current = customerSession(["server:write"]);
		expect((await post({ teamId: "team_2" })).status).toBe(403);
		routeSession.current = platformSession();
		expect((await post({ teamId: "" })).status).toBe(400);
		expect((await post({})).status).toBe(400);
		expect(mocks.transferServerToCustomer).not.toHaveBeenCalled();
	});

	it("delegates to the transfer service with the caller's session and surfaces its refusals", async () => {
		const res = await post({ teamId: " team_2 " });
		expect(res.status).toBe(200);
		expect(await res.json()).toEqual({ success: true, server: { id: "srv_1", teamId: "team_2" } });
		expect(mocks.transferServerToCustomer).toHaveBeenCalledWith("srv_1", "team_2", expect.objectContaining({ userId: "u_admin" }));
		mocks.transferServerToCustomer.mockRejectedValueOnce(new BusinessError("still in use"));
		expect((await post({ teamId: "team_2" })).status).toBe(422);
		mocks.transferServerToCustomer.mockRejectedValueOnce(new NotFoundError("no such team"));
		expect((await post({ teamId: "team_x" })).status).toBe(404);
	});
});
