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
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({
	getWorkerRuntimeHealth: vi.fn(),
	getJobBacklogMetrics: vi.fn(),
	getAllUptimeDataInternal: vi.fn(),
	listTicketsForCommand: vi.fn(),
	listShareAccessLogs: vi.fn(),
}));
vi.mock("@/lib/workers/runtime-health", () => ({ getWorkerRuntimeHealth: mocks.getWorkerRuntimeHealth }));
vi.mock("@/lib/job/metrics", () => ({ getJobBacklogMetrics: mocks.getJobBacklogMetrics }));
vi.mock("@/lib/uptime/internal", () => ({ getAllUptimeDataInternal: mocks.getAllUptimeDataInternal }));
vi.mock("@/lib/ticket/timeline", () => ({ listTicketsForCommand: mocks.listTicketsForCommand }));
vi.mock("@/lib/share-link/service", () => ({ listShareAccessLogs: mocks.listShareAccessLogs }));

const workers = await import("../admin/workers/route");
const backlog = await import("../jobs/backlog/route");
const uptime = await import("../system/uptime/all/route");
const commandTickets = await import("../commands/[id]/tickets/route");
const shareLogs = await import("../shares/[id]/access-logs/route");
const get = (url: string) => new Request(url);

describe("scoped read routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getWorkerRuntimeHealth.mockResolvedValue([{ name: "a", started: true }, { name: "b", started: false }]);
		mocks.getJobBacklogMetrics.mockResolvedValue({ pending: 3 });
		mocks.getAllUptimeDataInternal.mockResolvedValue({ servers: [] });
		mocks.listTicketsForCommand.mockResolvedValue([{ id: "t1", title: "T", status: "OPEN", priority: "LOW", updatedAt: new Date("2026-10-11T00:00:00Z") }]);
		mocks.listShareAccessLogs.mockResolvedValue([{ id: "l1" }]);
	});

	it("each needs its read permission", async () => {
		routeSession.current = customerSession([]);
		expect((await workers.GET(get("http://local/api/admin/workers"))).status).toBe(403);
		expect((await backlog.GET(get("http://local/api/jobs/backlog"))).status).toBe(403);
		expect((await uptime.GET(get("http://local/api/system/uptime/all") as never)).status).toBe(403);
		expect((await commandTickets.GET(get("http://local/api/commands/c1/tickets"), { params: Promise.resolve({ id: "c1" }) })).status).toBe(403);
		expect((await shareLogs.GET(get("http://local/api/shares/s1/access-logs"), { params: Promise.resolve({ id: "s1" }) })).status).toBe(403);
	});

	it("worker health is the platform's: a customer with task:read is refused", async () => {
		// task:read is in every customer identity template; the fleet, its
		// instances and last errors are platform internals (like /api/system-health).
		routeSession.current = customerSession(["task:read"]);
		expect((await workers.GET(get("http://local/api/admin/workers"))).status).toBe(403);
		expect(mocks.getWorkerRuntimeHealth).not.toHaveBeenCalled();
	});

	it("worker health answers 503 while any worker is down, 200 when all run", async () => {
		routeSession.current = platformSession();
		const degraded = await workers.GET(get("http://local/api/admin/workers"));
		expect(degraded.status).toBe(503);
		expect(await degraded.json()).toMatchObject({ healthy: false, startedCount: 1, totalCount: 2 });
		mocks.getWorkerRuntimeHealth.mockResolvedValue([{ name: "a", started: true }]);
		expect((await workers.GET(get("http://local/api/admin/workers"))).status).toBe(200);
	});

	it("passes the caller's session to every tenant-scoped reader", async () => {
		routeSession.current = customerSession(["audit:read", "server:read", "command:read", "share:read"]);
		expect(await (await backlog.GET(get("http://local/api/jobs/backlog"))).json()).toEqual({ metrics: { pending: 3 } });
		expect(mocks.getJobBacklogMetrics).toHaveBeenCalledWith(expect.objectContaining({ currentTeamId: "team_1" }));
		await uptime.GET(get("http://local/api/system/uptime/all") as never);
		expect(mocks.getAllUptimeDataInternal).toHaveBeenCalledWith({ session: expect.objectContaining({ currentTeamId: "team_1" }) });
		const tickets = await commandTickets.GET(get("http://local/api/commands/c1/tickets"), { params: Promise.resolve({ id: "c1" }) });
		expect(await tickets.json()).toEqual({ commandRequestId: "c1", tickets: [{ id: "t1", title: "T", status: "OPEN", priority: "LOW", updatedAt: "2026-10-11T00:00:00.000Z" }] });
		expect(mocks.listTicketsForCommand).toHaveBeenCalledWith("c1", expect.objectContaining({ currentTeamId: "team_1" }));
		const logs = await shareLogs.GET(get("http://local/api/shares/s1/access-logs"), { params: Promise.resolve({ id: "s1" }) });
		expect(await logs.json()).toEqual({ logs: [{ id: "l1" }] });
		expect(mocks.listShareAccessLogs).toHaveBeenCalledWith("s1", expect.objectContaining({ currentTeamId: "team_1" }));
	});
});
