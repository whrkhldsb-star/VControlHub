import { NextRequest } from "next/server";
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
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	UPLOAD_CHUNK_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ getJobBacklogMetrics: vi.fn(), getAllUptimeDataInternal: vi.fn(), getWorkerRuntimeHealth: vi.fn() }));
vi.mock("@/lib/job/metrics", () => ({ getJobBacklogMetrics: mocks.getJobBacklogMetrics }));
vi.mock("@/lib/uptime/internal", () => ({ getAllUptimeDataInternal: mocks.getAllUptimeDataInternal }));
vi.mock("@/lib/workers/runtime-health", () => ({ getWorkerRuntimeHealth: mocks.getWorkerRuntimeHealth }));

const backlog = await import("../jobs/backlog/route");
const uptimeAll = await import("../system/uptime/all/route");
const workers = await import("../admin/workers/route");

describe("operational read routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession();
		mocks.getJobBacklogMetrics.mockResolvedValue({ pending: 2, running: 1 });
		mocks.getAllUptimeDataInternal.mockResolvedValue({ servers: [{ id: "srv_1", uptime: 99.9 }] });
		mocks.getWorkerRuntimeHealth.mockResolvedValue([{ name: "jobs", started: true }, { name: "alerts", started: true }]);
	});

	it("scopes the job backlog to the caller and needs audit:read", async () => {
		routeSession.current = customerSession(["task:read"]);
		expect((await backlog.GET(new Request("http://local/x"))).status).toBe(403);
		routeSession.current = customerSession(["audit:read"]);
		const res = await backlog.GET(new Request("http://local/x"));
		expect(await res.json()).toEqual({ metrics: { pending: 2, running: 1 } });
		expect(mocks.getJobBacklogMetrics).toHaveBeenCalledWith(expect.objectContaining({ currentTeamId: "team_1" }));
	});

	it("scopes the uptime overview to the caller and needs server:read", async () => {
		routeSession.current = customerSession(["task:read"]);
		expect((await uptimeAll.GET(new NextRequest("http://local/x"))).status).toBe(403);
		routeSession.current = customerSession(["server:read"]);
		const res = await uptimeAll.GET(new NextRequest("http://local/x"));
		expect(await res.json()).toEqual({ servers: [{ id: "srv_1", uptime: 99.9 }] });
		expect(mocks.getAllUptimeDataInternal).toHaveBeenCalledWith({ session: expect.objectContaining({ currentTeamId: "team_1" }) });
	});

	it("reports worker health with 503 when any worker is down", async () => {
		routeSession.current = customerSession(["server:read"]);
		expect((await workers.GET(new Request("http://local/x"))).status).toBe(403);
		routeSession.current = customerSession(["task:read"]);
		const healthy = await workers.GET(new Request("http://local/x"));
		expect(healthy.status).toBe(200);
		expect(await healthy.json()).toMatchObject({ healthy: true, startedCount: 2, totalCount: 2 });
		mocks.getWorkerRuntimeHealth.mockResolvedValueOnce([{ name: "jobs", started: true }, { name: "alerts", started: false }]);
		const degraded = await workers.GET(new Request("http://local/x"));
		expect(degraded.status).toBe(503);
		expect(await degraded.json()).toMatchObject({ healthy: false, startedCount: 1, totalCount: 2 });
	});
});
