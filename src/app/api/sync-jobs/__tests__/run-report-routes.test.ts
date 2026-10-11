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
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ getSyncJob: vi.fn(), executeSyncJob: vi.fn(), auditUserAction: vi.fn(), buildSyncReportView: vi.fn() }));
vi.mock("@/lib/sync/service-crud", () => ({ getSyncJob: mocks.getSyncJob }));
vi.mock("@/lib/sync/service-runtime", () => ({ executeSyncJob: mocks.executeSyncJob }));
vi.mock("@/lib/sync/report", () => ({ buildSyncReportView: mocks.buildSyncReportView }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const run = await import("../[id]/run/route");
const report = await import("../[id]/report/route");
const params = Promise.resolve({ id: "sync_1" });
const job = { id: "sync_1", name: "nightly", syncType: "MIRROR", status: "IDLE", schedule: null, lastSyncAt: null, lastSyncResult: null, sourcePath: "/a", targetPath: "/b", syncLogs: [] };

describe("sync job run and report routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["storage:write", "storage:read"]);
		mocks.getSyncJob.mockResolvedValue(job);
		mocks.executeSyncJob.mockResolvedValue({ ok: true, status: "IDLE", lastSyncResult: "ok" });
		mocks.buildSyncReportView.mockReturnValue({ summary: "fine" });
	});

	it("run needs storage:write and report needs storage:read", async () => {
		routeSession.current = customerSession(["storage:read"]);
		expect((await run.POST(new Request("http://local/api/sync-jobs/sync_1/run", { method: "POST" }), { params })).status).toBe(403);
		routeSession.current = customerSession([]);
		expect((await report.GET(new Request("http://local/api/sync-jobs/sync_1/report"), { params })).status).toBe(403);
		expect(mocks.executeSyncJob).not.toHaveBeenCalled();
	});

	it("runs a job the caller can see, audits it, and reports a failed sync honestly", async () => {
		const ok = await run.POST(new Request("http://local/api/sync-jobs/sync_1/run", { method: "POST" }), { params });
		expect(ok.status).toBe(200);
		expect(mocks.getSyncJob).toHaveBeenCalledWith("sync_1", expect.objectContaining({ currentTeamId: "team_1" }));
		expect(mocks.executeSyncJob).toHaveBeenCalledWith("sync_1");
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "sync_job.run", expect.objectContaining({ jobId: "sync_1", ok: true }), undefined, "team_1");

		mocks.executeSyncJob.mockResolvedValue({ ok: false, status: "ERROR", lastSyncResult: "rsync exit 23", errorMessage: "rsync exit 23" });
		const failed = await run.POST(new Request("http://local/api/sync-jobs/sync_1/run", { method: "POST" }), { params });
		expect(failed.status).toBeGreaterThanOrEqual(400);
		expect((await failed.json()).error).toContain("rsync exit 23");

		mocks.getSyncJob.mockResolvedValue(null);
		expect((await run.POST(new Request("http://local/api/sync-jobs/sync_1/run", { method: "POST" }), { params })).status).toBe(404);
	});

	it("reports with serialised logs and 404s outside the caller's scope", async () => {
		mocks.getSyncJob.mockResolvedValue({ ...job, syncLogs: [{ id: "l1", status: "OK", filesScanned: 1, filesTransferred: 1, filesDeleted: 0, bytesTransferred: 5, durationMs: 10, errorMessage: null, startedAt: new Date("2026-10-11T00:00:00Z"), completedAt: null }] });
		const res = await report.GET(new Request("http://local/api/sync-jobs/sync_1/report"), { params });
		expect(res.status).toBe(200);
		expect(await res.json()).toMatchObject({ job: { id: "sync_1", name: "nightly" }, report: { summary: "fine" } });
		expect(mocks.buildSyncReportView).toHaveBeenCalledWith(expect.objectContaining({ logs: [expect.objectContaining({ id: "l1", startedAt: "2026-10-11T00:00:00.000Z", completedAt: null })] }));
		mocks.getSyncJob.mockResolvedValue(null);
		expect((await report.GET(new Request("http://local/api/sync-jobs/sync_1/report"), { params })).status).toBe(404);
	});
});
