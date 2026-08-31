import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the four read-only ops endpoints, grouped because they
 * share exactly one contract: a permission gate, and the session handed to a
 * service that does the team filtering.
 *
 *   GET /api/jobs/backlog       — audit:read
 *   GET /api/admin/workers      — task:read   (+ 503 when the fleet is degraded)
 *   GET /api/system-health      — health:read
 *   GET /api/system/uptime/all  — server:read
 *
 * Three of the four forward `session` into the service, and that argument is
 * load-bearing rather than decorative: `getJobBacklogMetrics(undefined)` and
 * `collectSystemHealthChecks({})` fall back to an unfiltered query, and
 * `getAllUptimeDataInternal({})` returns an empty list. So "the session reaches
 * the service" is the tenant-isolation assertion for these routes — the filters
 * themselves are covered by `src/lib/job/__tests__/metrics.test.ts`,
 * `src/lib/system-health/__tests__/service.test.ts` and
 * `src/lib/uptime/__tests__/internal-team-scope.test.ts`.
 *
 * `/api/admin/workers` is the one with logic of its own: it answers 503 when any
 * worker in the fleet has not started, so a monitoring probe sees a failing
 * status code rather than a 200 carrying `healthy: false` in the body.
 */
const mocks = vi.hoisted(() => ({
	getJobBacklogMetrics: vi.fn(),
	getWorkerRuntimeHealth: vi.fn(),
	collectSystemHealthChecks: vi.fn(),
	getAllUptimeDataInternal: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/job/metrics", () => ({ getJobBacklogMetrics: mocks.getJobBacklogMetrics }));
vi.mock("@/lib/workers/runtime-health", () => ({ getWorkerRuntimeHealth: mocks.getWorkerRuntimeHealth }));
vi.mock("@/lib/system-health/service", () => ({ collectSystemHealthChecks: mocks.collectSystemHealthChecks }));
vi.mock("@/lib/uptime/internal", () => ({ getAllUptimeDataInternal: mocks.getAllUptimeDataInternal }));

/** Swapped to null by the one test covering the uptime route's own 401 guard. */
let currentSession: typeof session | null = null;

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (_request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		try {
			return await handler({ session: currentSession });
		} catch (error) {
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

const session = {
	userId: "u_1",
	username: "op",
	roles: ["operator"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const backlog = await import("../jobs/backlog/route");
const workers = await import("../admin/workers/route");
const systemHealth = await import("../system-health/route");
const uptimeAll = await import("../system/uptime/all/route");

function worker(id: string, started: boolean) {
	return { id, label: id, started, healthy: started, instanceId: started ? "inst_1" : null };
}

function req(url: string) {
	return new Request(url, { method: "GET" });
}

describe("read-only ops endpoints", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.guardCalls.length = 0;
		currentSession = session;
		mocks.getJobBacklogMetrics.mockReset();
		mocks.getWorkerRuntimeHealth.mockReset();
		mocks.collectSystemHealthChecks.mockReset();
		mocks.getAllUptimeDataInternal.mockReset();
		mocks.getJobBacklogMetrics.mockResolvedValue({ pending: 2, running: 1, total: 3 });
		mocks.getWorkerRuntimeHealth.mockResolvedValue([worker("job-runner", true)]);
		mocks.collectSystemHealthChecks.mockResolvedValue({ checks: [], status: "healthy" });
		mocks.getAllUptimeDataInternal.mockResolvedValue({ servers: [] });
	});

	describe("GET /api/jobs/backlog", () => {
		it("is gated on audit:read", async () => {
			await backlog.GET(req("https://a.test/api/jobs/backlog"));
			expect(mocks.guardCalls[0]!.permission).toBe("audit:read");
		});

		it("passes the session so the counts stay team-scoped", async () => {
			// `getJobBacklogMetrics(undefined)` counts every tenant's jobs.
			const res = await backlog.GET(req("https://a.test/api/jobs/backlog"));
			expect(res.status).toBe(200);
			expect(mocks.getJobBacklogMetrics).toHaveBeenCalledWith(session);
		});

		it("wraps the result under a `metrics` key", async () => {
			const res = await backlog.GET(req("https://a.test/api/jobs/backlog"));
			await expect(res.json()).resolves.toEqual({ metrics: { pending: 2, running: 1, total: 3 } });
		});
	});

	describe("GET /api/admin/workers", () => {
		it("is gated on task:read", async () => {
			await workers.GET(req("https://a.test/api/admin/workers"));
			expect(mocks.guardCalls[0]!.permission).toBe("task:read");
		});

		it("answers 200 with healthy:true when every worker has started", async () => {
			mocks.getWorkerRuntimeHealth.mockResolvedValue([worker("a", true), worker("b", true)]);
			const res = await workers.GET(req("https://a.test/api/admin/workers"));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toMatchObject({ healthy: true, startedCount: 2, totalCount: 2 });
		});

		it("answers 503 when any worker has not started", async () => {
			// A monitoring probe watches the status code, not the body — a 200
			// carrying `healthy: false` would read as "fleet is fine".
			mocks.getWorkerRuntimeHealth.mockResolvedValue([worker("a", true), worker("b", false)]);
			const res = await workers.GET(req("https://a.test/api/admin/workers"));
			expect(res.status).toBe(503);
			await expect(res.json()).resolves.toMatchObject({ healthy: false, startedCount: 1, totalCount: 2 });
		});

		it("treats an empty fleet as healthy rather than dividing by zero", async () => {
			// 0 === 0, so an install with no worker definitions reports healthy.
			mocks.getWorkerRuntimeHealth.mockResolvedValue([]);
			const res = await workers.GET(req("https://a.test/api/admin/workers"));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toMatchObject({ healthy: true, startedCount: 0, totalCount: 0 });
		});

		it("returns the per-worker rows so the UI can name the dead one", async () => {
			mocks.getWorkerRuntimeHealth.mockResolvedValue([worker("backup-runner", false)]);
			const res = await workers.GET(req("https://a.test/api/admin/workers"));
			const payload = (await res.json()) as { workers: Array<{ id: string; started: boolean }> };
			expect(payload.workers).toEqual([
				{ id: "backup-runner", label: "backup-runner", started: false, healthy: false, instanceId: null },
			]);
		});
	});

	describe("GET /api/system-health", () => {
		it("is gated on health:read", async () => {
			await systemHealth.GET(req("https://a.test/api/system-health"));
			expect(mocks.guardCalls[0]!.permission).toBe("health:read");
		});

		it("passes the session so inventory counts stay team-scoped", async () => {
			// Without `session` the report leaks platform-wide VPS/storage totals.
			await systemHealth.GET(req("https://a.test/api/system-health"));
			expect(mocks.collectSystemHealthChecks).toHaveBeenCalledWith({ session });
		});

		it("returns the report as the response body without re-wrapping it", async () => {
			mocks.collectSystemHealthChecks.mockResolvedValue({ status: "degraded", checks: [{ id: "database" }] });
			const res = await systemHealth.GET(req("https://a.test/api/system-health"));
			expect(res.status).toBe(200);
			await expect(res.json()).resolves.toEqual({ status: "degraded", checks: [{ id: "database" }] });
		});

		it("keeps a 200 even when the report itself is critical", async () => {
			// The body carries the verdict; the transport succeeded.
			mocks.collectSystemHealthChecks.mockResolvedValue({ status: "critical", checks: [] });
			const res = await systemHealth.GET(req("https://a.test/api/system-health"));
			expect(res.status).toBe(200);
		});
	});

	describe("GET /api/system/uptime/all", () => {
		it("is gated on server:read", async () => {
			await uptimeAll.GET(req("https://a.test/api/system/uptime/all") as never);
			expect(mocks.guardCalls[0]!.permission).toBe("server:read");
		});

		it("passes the session so only the caller's servers are returned", async () => {
			mocks.getAllUptimeDataInternal.mockResolvedValue({ servers: [{ id: "srv1", name: "web", days: [] }] });
			const res = await uptimeAll.GET(req("https://a.test/api/system/uptime/all") as never);
			expect(res.status).toBe(200);
			expect(mocks.getAllUptimeDataInternal).toHaveBeenCalledWith({ session });
			await expect(res.json()).resolves.toEqual({ servers: [{ id: "srv1", name: "web", days: [] }] });
		});

		it("401s without reading uptime data when the session is absent", async () => {
			// Defence in depth: the permission guard already rejects an anonymous
			// caller, so this branch only fires if that ever regresses — but it must
			// not degrade into an unfiltered query.
			currentSession = null;
			const res = await uptimeAll.GET(req("https://a.test/api/system/uptime/all") as never);
			expect(res.status).toBe(401);
			expect(mocks.getAllUptimeDataInternal).not.toHaveBeenCalled();
		});
	});
});
