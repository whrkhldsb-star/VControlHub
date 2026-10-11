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

const mocks = vi.hoisted(() => ({ jobFindFirst: vi.fn(), listJobEvents: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: { job: { findFirst: mocks.jobFindFirst } } }));
vi.mock("@/lib/job/events", async (original) => ({ ...((await original()) as Record<string, unknown>), listJobEvents: mocks.listJobEvents }));

const route = await import("../[id]/events/route");
const get = (url: string, id = "job_1") => route.GET(new Request(url), { params: Promise.resolve({ id }) });

describe("GET /api/jobs/[id]/events", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["task:read"]);
		mocks.jobFindFirst.mockResolvedValue({ id: "job_1" });
		mocks.listJobEvents.mockResolvedValue([{ id: "e1", jobId: "job_1", type: "progress", level: "info", message: "m", workerId: "w", payload: null, createdAt: new Date("2026-10-11T00:00:00Z") }]);
	});

	it("a customer only sees events of jobs they created inside their tenant", async () => {
		const res = await get("http://local/api/jobs/job_1/events?limit=10");
		expect(res.status).toBe(200);
		expect(mocks.jobFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { AND: [{ id: "job_1" }, expect.objectContaining({ teamId: "team_1" }), { createdBy: "u_cust" }] } }));
		expect(mocks.listJobEvents).toHaveBeenCalledWith({ jobId: "job_1", limit: 10, beforeId: undefined });
		expect(await res.json()).toEqual({ jobId: "job_1", events: [expect.objectContaining({ id: "e1", createdAt: "2026-10-11T00:00:00.000Z" })] });
	});

	it("a platform manager is scoped by tenant filter only", async () => {
		routeSession.current = platformSession({ permissions: ["task:read", "team:manage"] });
		await get("http://local/api/jobs/job_1/events");
		expect(mocks.jobFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "job_1" }) }));
		expect((mocks.jobFindFirst.mock.calls[0]![0] as { where: Record<string, unknown> }).where.AND).toBeUndefined();
	});

	it("rejects a bad limit, a blank id and an unknown job explicitly", async () => {
		expect((await get("http://local/api/jobs/job_1/events?limit=abc")).status).toBe(400);
		expect((await get("http://local/api/jobs/job_1/events?limit=0")).status).toBe(400);
		expect((await get("http://local/api/jobs/%20/events", " ")).status).toBe(400);
		mocks.jobFindFirst.mockResolvedValue(null);
		expect((await get("http://local/api/jobs/job_1/events")).status).toBe(404);
	});
});
