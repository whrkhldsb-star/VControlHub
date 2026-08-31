import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the four sync-job routes.
 *
 * A sync job is an executable rsync, so the routes' own responsibilities are
 * narrow but load-bearing: pass the session down (the CRUD layer's team filters
 * are useless if the route calls them with `undefined`), validate the schedule
 * string before it reaches the scheduler, and — on `run` — report an rsync that
 * failed as a failure instead of `success: true` with `status: ERROR`.
 * Scope enforcement itself lives in `src/lib/sync/__tests__/service-crud.test.ts`.
 */
const mocks = vi.hoisted(() => ({
	listSyncJobs: vi.fn(),
	createSyncJob: vi.fn(),
	updateSyncJob: vi.fn(),
	deleteSyncJob: vi.fn(),
	getSyncJob: vi.fn(),
	executeSyncJob: vi.fn(),
	buildSyncReportView: vi.fn(),
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/sync/service-crud", () => ({
	listSyncJobs: mocks.listSyncJobs,
	createSyncJob: mocks.createSyncJob,
	updateSyncJob: mocks.updateSyncJob,
	deleteSyncJob: mocks.deleteSyncJob,
	getSyncJob: mocks.getSyncJob,
}));
vi.mock("@/lib/sync/service-runtime", () => ({ executeSyncJob: mocks.executeSyncJob }));
vi.mock("@/lib/sync/report", () => ({ buildSyncReportView: mocks.buildSyncReportView }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/i18n/translations", () => ({
	getServerLocale: vi.fn(async () => "zh"),
	t: (key: string) => key,
}));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return Response.json({ error: "输入参数无效" }, { status: 400 });
			body = parsed.data;
		}
		try {
			return await handler({ session, body });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
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

const collection = await import("../route");
const item = await import("../[id]/route");
const run = await import("../[id]/run/route");
const report = await import("../[id]/report/route");

const idParams = { params: Promise.resolve({ id: "job_1" }) };

function req(method: string, body?: unknown, url = "https://a.test/api/sync-jobs") {
	return new Request(url, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

function createBody(overrides: Record<string, unknown> = {}) {
	return {
		name: "nightly",
		sourceServerId: "srv_a",
		sourcePath: "/data",
		targetServerId: "srv_b",
		targetPath: "/backup",
		...overrides,
	};
}

const jobRow = {
	id: "job_1",
	name: "nightly",
	sourceServerId: "srv_a",
	targetServerId: "srv_b",
	sourcePath: "/data",
	targetPath: "/backup",
	syncType: "MIRROR",
	status: "IDLE",
	schedule: null,
	deleteOrphans: false,
	compress: false,
	lastSyncAt: new Date("2026-08-30T02:00:00.000Z"),
	lastSyncResult: "SUCCESS",
	sourceServer: { id: "srv_a", name: "a", host: "10.0.0.1" },
	targetServer: { id: "srv_b", name: "b", host: "10.0.0.2" },
	teamId: "team_1",
	createdAt: new Date("2026-08-01T00:00:00.000Z"),
	_count: { syncLogs: 4 },
	syncLogs: [],
};

describe("sync-job routes", () => {
	beforeEach(() => {
		for (const stub of Object.values(mocks)) {
			if (typeof (stub as any).mockReset === "function") (stub as any).mockReset();
		}
		mocks.guardCalls.length = 0;
		mocks.listSyncJobs.mockResolvedValue([jobRow]);
		mocks.createSyncJob.mockResolvedValue(jobRow);
		mocks.updateSyncJob.mockResolvedValue(jobRow);
		mocks.deleteSyncJob.mockResolvedValue({ id: "job_1" });
		mocks.getSyncJob.mockResolvedValue(jobRow);
		mocks.executeSyncJob.mockResolvedValue({ ok: true, status: "IDLE", lastSyncResult: "SUCCESS" });
		mocks.buildSyncReportView.mockReturnValue({ conflicts: [], summary: {} });
	});

	describe("guard contract", () => {
		it.each([
			["list", async () => collection.GET(req("GET")), "storage:read", 120],
			["create", async () => collection.POST(req("POST", createBody())), "storage:write", 30],
			["patch", async () => item.PATCH(req("PATCH", { name: "x" }), idParams), "storage:write", 30],
			["delete", async () => item.DELETE(req("DELETE"), idParams), "storage:write", 30],
			["run", async () => run.POST(req("POST"), idParams), "storage:write", 30],
			["report", async () => report.GET(req("GET"), idParams), "storage:read", 120],
		])("%s requires %s behind a %s/min limit", async (_label, call, permission, maxRequests) => {
			await call();
			expect(mocks.guardCalls[0]).toMatchObject({
				permission,
				rateLimit: { maxRequests, windowMs: 60_000 },
			});
		});
	});

	describe("GET /api/sync-jobs", () => {
		it("forwards the session so the list stays team-scoped", async () => {
			await collection.GET(req("GET"));
			expect(mocks.listSyncJobs).toHaveBeenCalledWith(session);
		});

		it("projects each job without leaking the server relations wholesale", async () => {
			const res = await collection.GET(req("GET"));
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.jobs[0]).toEqual({
				id: "job_1",
				name: "nightly",
				sourceServerId: "srv_a",
				targetServerId: "srv_b",
				sourcePath: "/data",
				targetPath: "/backup",
				syncType: "MIRROR",
				status: "IDLE",
				schedule: null,
				deleteOrphans: false,
				compress: false,
				lastSyncAt: "2026-08-30T02:00:00.000Z",
				lastSyncResult: "SUCCESS",
				sourceServer: { id: "srv_a", name: "a", host: "10.0.0.1" },
				targetServer: { id: "srv_b", name: "b", host: "10.0.0.2" },
				logCount: 4,
				teamId: "team_1",
				createdAt: "2026-08-01T00:00:00.000Z",
			});
		});
	});

	describe("POST /api/sync-jobs", () => {
		it("creates the job, returns 201 and audits it", async () => {
			const res = await collection.POST(req("POST", createBody({ schedule: "every:1h" })));
			const json = await res.json();

			expect(res.status).toBe(201);
			expect(json.job.id).toBe("job_1");
			expect(mocks.createSyncJob).toHaveBeenCalledWith(
				expect.objectContaining({
					name: "nightly",
					syncType: "MIRROR",
					schedule: "every:1h",
					createdBy: "u_1",
					session,
				}),
			);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"sync_job.create",
				{
					jobId: "job_1",
					syncType: "MIRROR",
					sourceServerId: "srv_a",
					targetServerId: "srv_b",
				},
				undefined,
				"team_1",
			);
		});

		it("forces deleteOrphans off for a BIDIRECTIONAL job", async () => {
			await collection.POST(req("POST", createBody({ syncType: "BIDIRECTIONAL", deleteOrphans: true })));
			expect(mocks.createSyncJob).toHaveBeenCalledWith(
				expect.objectContaining({ syncType: "BIDIRECTIONAL", deleteOrphans: false }),
			);
		});

		it.each([
			["a cron expression", "*/15 * * * *"],
			["an every: shorthand", "every:6h"],
			["manual", "manual"],
		])("accepts %s as a schedule", async (_label, schedule) => {
			const res = await collection.POST(req("POST", createBody({ schedule })));
			expect(res.status).toBe(201);
		});

		// What counts as a valid cron string is decided by cron-parser, not by a
		// field count of our own — the route's copy says "5-field" but a shorter
		// expression cron-parser accepts is scheduled by the same parser in
		// `isSyncJobDue`, so validation and execution stay consistent.
		it.each([
			["a nonsense schedule", "whenever"],
			["an unsupported interval", "every:7m"],
			["a cron with a non-numeric field", "* * * * bogus"],
			["a cron with an out-of-range minute", "99 * * * *"],
		])("rejects %s with 400 and creates nothing", async (_label, schedule) => {
			const res = await collection.POST(req("POST", createBody({ schedule })));
			expect(res.status).toBe(400);
			expect(mocks.createSyncJob).not.toHaveBeenCalled();
		});

		it.each([
			["a blank name", { name: "" }],
			["a missing source path", { sourcePath: "" }],
			["an unknown syncType", { syncType: "SIDEWAYS" }],
			["a non-boolean compress", { compress: "yes" }],
		])("rejects %s at the schema", async (_label, overrides) => {
			const res = await collection.POST(req("POST", createBody(overrides)));
			expect(res.status).toBe(400);
			expect(mocks.createSyncJob).not.toHaveBeenCalled();
		});

		it("treats an empty schedule as none rather than invalid", async () => {
			const res = await collection.POST(req("POST", createBody({ schedule: "" })));
			expect(res.status).toBe(201);
			expect(mocks.createSyncJob).toHaveBeenCalledWith(
				expect.objectContaining({ schedule: undefined }),
			);
		});
	});

	describe("PATCH /api/sync-jobs/[id]", () => {
		it("passes only the provided fields plus the session", async () => {
			const res = await item.PATCH(req("PATCH", { name: "renamed", schedule: null }), idParams);

			expect(res.status).toBe(200);
			expect(mocks.updateSyncJob).toHaveBeenCalledWith(
				"job_1",
				{ name: "renamed", schedule: null },
				session,
			);
		});

		it("rejects an invalid schedule before touching the job", async () => {
			const res = await item.PATCH(req("PATCH", { schedule: "every:3s" }), idParams);
			expect(res.status).toBe(400);
			expect(mocks.updateSyncJob).not.toHaveBeenCalled();
		});

		it("keeps a 404 from the CRUD layer", async () => {
			const { NotFoundError } = await import("@/lib/errors");
			mocks.updateSyncJob.mockRejectedValue(new NotFoundError("sync job not found"));
			const res = await item.PATCH(req("PATCH", { name: "x" }), idParams);
			expect(res.status).toBe(404);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});
	});

	describe("DELETE /api/sync-jobs/[id]", () => {
		it("deletes through the scoped service and audits it", async () => {
			const res = await item.DELETE(req("DELETE"), idParams);

			expect(res.status).toBe(200);
			expect(mocks.deleteSyncJob).toHaveBeenCalledWith("job_1", session);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"sync_job.delete",
				{ jobId: "job_1" },
				undefined,
				"team_1",
			);
		});

		it("keeps the RUNNING refusal as a 400 and writes no audit entry", async () => {
			const { ValidationError } = await import("@/lib/errors");
			mocks.deleteSyncJob.mockRejectedValue(new ValidationError("cannot delete running sync job"));
			const res = await item.DELETE(req("DELETE"), idParams);
			expect(res.status).toBe(400);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});
	});

	describe("POST /api/sync-jobs/[id]/run", () => {
		it("checks ownership before executing", async () => {
			mocks.getSyncJob.mockResolvedValue(null);

			const res = await run.POST(req("POST"), idParams);

			expect(res.status).toBe(404);
			expect(mocks.executeSyncJob).not.toHaveBeenCalled();
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("returns the refreshed job on success", async () => {
			mocks.getSyncJob
				.mockResolvedValueOnce(jobRow)
				.mockResolvedValueOnce({ ...jobRow, status: "IDLE", lastSyncResult: "SUCCESS" });

			const res = await run.POST(req("POST"), idParams);
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.success).toBe(true);
			expect(json.job).toEqual({
				id: "job_1",
				status: "IDLE",
				lastSyncAt: "2026-08-30T02:00:00.000Z",
				lastSyncResult: "SUCCESS",
				syncType: "MIRROR",
			});
			expect(mocks.executeSyncJob).toHaveBeenCalledWith("job_1");
		});

		it("reports a failed rsync as a failure, not success with status ERROR", async () => {
			mocks.executeSyncJob.mockResolvedValue({
				ok: false,
				status: "ERROR",
				lastSyncResult: "FAILED",
				errorMessage: "rsync exited 23",
			});
			mocks.getSyncJob
				.mockResolvedValueOnce(jobRow)
				.mockResolvedValueOnce({ ...jobRow, status: "ERROR", lastSyncResult: "FAILED" });

			const res = await run.POST(req("POST"), idParams);
			const json = await res.json();

			expect(res.status).toBe(422);
			expect(json.error).toBe("rsync exited 23");
			// The attempt is still audited — the failure is the outcome, not a skip.
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"sync_job.run",
				expect.objectContaining({ ok: false, status: "ERROR", lastSyncResult: "FAILED" }),
				undefined,
				"team_1",
			);
		});

		it("truncates a runaway rsync error message", async () => {
			mocks.executeSyncJob.mockResolvedValue({
				ok: false,
				status: "ERROR",
				lastSyncResult: "FAILED",
				errorMessage: "x".repeat(1000),
			});
			const res = await run.POST(req("POST"), idParams);
			const json = await res.json();
			expect(json.error).toHaveLength(300);
		});

		it("falls back to a generic message when the runner gave none", async () => {
			mocks.executeSyncJob.mockResolvedValue({ ok: false, status: "ERROR", lastSyncResult: "FAILED" });
			const res = await run.POST(req("POST"), idParams);
			expect(await res.json()).toMatchObject({ error: "api.syncJobRunFailed" });
		});
	});

	describe("GET /api/sync-jobs/[id]/report", () => {
		it("404s a job outside the caller's scope", async () => {
			mocks.getSyncJob.mockResolvedValue(null);
			const res = await report.GET(req("GET"), idParams);
			expect(res.status).toBe(404);
			expect(mocks.buildSyncReportView).not.toHaveBeenCalled();
		});

		it("serialises the logs and hands them to the report builder", async () => {
			mocks.getSyncJob.mockResolvedValue({
				...jobRow,
				syncLogs: [
					{
						id: "log_1",
						status: "SUCCESS",
						filesScanned: 10,
						filesTransferred: 3,
						filesDeleted: 0,
						bytesTransferred: 4096,
						durationMs: 1200,
						errorMessage: null,
						startedAt: new Date("2026-08-30T02:00:00.000Z"),
						completedAt: new Date("2026-08-30T02:00:01.200Z"),
					},
				],
			});

			const res = await report.GET(req("GET"), idParams);
			const json = await res.json();

			expect(res.status).toBe(200);
			expect(json.job).toMatchObject({ id: "job_1", syncType: "MIRROR" });
			expect(mocks.buildSyncReportView).toHaveBeenCalledWith({
				syncType: "MIRROR",
				lastSyncResult: "SUCCESS",
				logs: [
					{
						id: "log_1",
						status: "SUCCESS",
						filesScanned: 10,
						filesTransferred: 3,
						filesDeleted: 0,
						bytesTransferred: 4096,
						durationMs: 1200,
						errorMessage: null,
						startedAt: "2026-08-30T02:00:00.000Z",
						completedAt: "2026-08-30T02:00:01.200Z",
					},
				],
			});
		});

		it("tolerates a job with no logs at all", async () => {
			mocks.getSyncJob.mockResolvedValue({ ...jobRow, syncLogs: undefined });
			const res = await report.GET(req("GET"), idParams);
			expect(res.status).toBe(200);
			expect(mocks.buildSyncReportView).toHaveBeenCalledWith(
				expect.objectContaining({ logs: [] }),
			);
		});
	});
});
