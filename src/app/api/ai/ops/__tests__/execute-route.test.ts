import { beforeEach, describe, expect, it, vi } from "vitest";

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
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ executeRecommendation: vi.fn(), auditUserAction: vi.fn() }));
vi.mock("@/lib/ai/ops/service", () => ({ executeRecommendation: mocks.executeRecommendation }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../logs/[id]/execute/route");
const params = Promise.resolve({ id: "log_1" });
const post = (body: unknown) =>
	route.POST(new Request("http://local/api/ai/ops/logs/log_1/execute", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params });

describe("POST /api/ai/ops/logs/[id]/execute", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		// AI-ops is a cross-tenant platform capability; retain the customer
		// identity in audit assertions while giving it the platform-admin role.
		routeSession.current = platformSession({ userId: "u_cust", username: "cust", currentTeamId: "team_1" });
		mocks.executeRecommendation.mockResolvedValue({ ok: true, executed: true });
	});

	it("needs ai:ops:manage", async () => {
		routeSession.current = customerSession(["ai:ops:read"]);
		expect((await post({ actionId: "a1" })).status).toBe(403);
	});

	it("rejects a custom role with ai:ops:manage because the records are cross-tenant", async () => {
		routeSession.current = customerSession(["ai:ops:manage"]);
		expect((await post({ actionId: "a1" })).status).toBe(403);
		expect(mocks.executeRecommendation).not.toHaveBeenCalled();
	});

	it("executes a recommendation and audits the outcome", async () => {
		const res = await post({ actionId: "a1" });
		expect(res.status).toBe(200);
		expect(mocks.executeRecommendation).toHaveBeenCalledWith({ logId: "log_1", actionId: "a1", forceAutonomous: undefined });
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "ai.ops.recommendation.execute", expect.objectContaining({ logId: "log_1", actionId: "a1", forceAutonomous: false, executed: true }), undefined, "team_1");
	});

	it("refuses forceAutonomous without ai:ops:autonomous, and allows it with", async () => {
		routeSession.current = platformSession({ permissions: ["ai:ops:manage"] });
		expect((await post({ actionId: "a1", forceAutonomous: true })).status).toBe(403);
		expect(mocks.executeRecommendation).not.toHaveBeenCalled();

		routeSession.current = platformSession({ userId: "u_cust", username: "cust", currentTeamId: "team_1" });
		expect((await post({ actionId: "a1", forceAutonomous: true })).status).toBe(200);
		expect(mocks.executeRecommendation).toHaveBeenCalledWith(expect.objectContaining({ forceAutonomous: true }));
	});
});
