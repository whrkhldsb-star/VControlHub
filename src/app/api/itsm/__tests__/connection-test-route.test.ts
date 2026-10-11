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

const mocks = vi.hoisted(() => ({ testItsmConnection: vi.fn(), auditUserAction: vi.fn() }));
vi.mock("@/lib/itsm/service", async (original) => ({ ...((await original()) as Record<string, unknown>), testItsmConnection: mocks.testItsmConnection }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../connections/[id]/test/route");
const post = (body?: unknown) => route.POST(new Request("http://local/x", { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), { params: Promise.resolve({ id: "conn_1" }) });

describe("POST /api/itsm/connections/[id]/test", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["ticket:manage"]);
		mocks.testItsmConnection.mockResolvedValue({ ok: true, latencyMs: 40 });
	});

	it("needs ticket:manage and rejects unknown body fields", async () => {
		routeSession.current = customerSession(["ticket:read"]);
		expect((await post({})).status).toBe(403);
		routeSession.current = customerSession(["ticket:manage"]);
		expect((await post({ message: "hi", extra: 1 })).status).toBe(400);
	});

	it("reports the probe outcome honestly: 200 when it worked, 502 when the other side failed", async () => {
		const ok = await post({ message: "ping" });
		expect(ok.status).toBe(200);
		expect(mocks.testItsmConnection).toHaveBeenCalledWith("conn_1", "ping", expect.objectContaining({ currentTeamId: "team_1" }));
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "itsm.connection.test", { connectionId: "conn_1", ok: true }, undefined, "team_1");
		mocks.testItsmConnection.mockResolvedValue({ ok: false, error: "401 from remote" });
		const failed = await post();
		expect(failed.status).toBe(502);
		expect(await failed.json()).toMatchObject({ ok: false, error: "401 from remote" });
	});
});
