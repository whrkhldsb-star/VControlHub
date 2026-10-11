import { beforeEach, describe, expect, it, vi } from "vitest";

import { ConflictError, NotFoundError } from "@/lib/errors";
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
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ createDeploymentRollbackRun: vi.fn(), auditUserAction: vi.fn() }));
vi.mock("@/lib/deployment/service", () => ({ createDeploymentRollbackRun: mocks.createDeploymentRollbackRun }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../rollback/route");
const params = Promise.resolve({ id: "run_1" });
const post = (body: unknown) =>
	route.POST(new Request("http://local/api/deployments/run_1/rollback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params });

describe("POST /api/deployments/[id]/rollback", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["deploy:run"]);
		mocks.createDeploymentRollbackRun.mockResolvedValue({ id: "rb_1", commandRequestId: "cmd_1", status: "PENDING" });
	});

	it("needs deploy:run", async () => {
		routeSession.current = customerSession(["deploy:read"]);
		expect((await post({})).status).toBe(403);
		expect(mocks.createDeploymentRollbackRun).not.toHaveBeenCalled();
	});

	it("creates the rollback in the caller's scope and audits the reason", async () => {
		const res = await post({ reason: "bad release" });
		expect(res.status).toBe(201);
		expect(await res.json()).toMatchObject({ rollback: { id: "rb_1", commandRequestId: "cmd_1" } });
		expect(mocks.createDeploymentRollbackRun).toHaveBeenCalledWith(
			{ sourceRunId: "run_1", requesterId: "u_cust", reason: "bad release" },
			expect.objectContaining({ userId: "u_cust", currentTeamId: "team_1" }),
		);
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "deployment.rollback", expect.objectContaining({ sourceRunId: "run_1", rollbackId: "rb_1", reason: "bad release" }), undefined, "team_1");
	});

	it("caps the reason length", async () => {
		expect((await post({ reason: "x".repeat(501) })).status).toBe(400);
	});

	it("keeps the service's own statuses: 404 unknown run, 409 rollback already running", async () => {
		mocks.createDeploymentRollbackRun.mockRejectedValueOnce(new NotFoundError("no run"));
		expect((await post({})).status).toBe(404);
		mocks.createDeploymentRollbackRun.mockRejectedValueOnce(new ConflictError("already"));
		expect((await post({})).status).toBe(409);
		expect(mocks.auditUserAction).not.toHaveBeenCalled();
	});
});
