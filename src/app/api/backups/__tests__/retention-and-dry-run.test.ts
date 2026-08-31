import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the two untested backup routes.
 *
 * `POST /api/backups/retention` enqueues a destructive prune, so the property
 * that matters is that the job carries the caller's own `currentTeamId`:
 * `pruneOldBackupRecordsNow` deliberately fails closed without one rather than
 * pruning every tenant, and the route is the only place that value comes from.
 * The dry-run route is about honest reporting — a config problem is a 422, a
 * remote/credential failure is a 502, and neither may be dressed up as success.
 */
const mocks = vi.hoisted(() => ({
	getBackupPolicySummary: vi.fn(),
	enqueueJob: vi.fn(),
	auditUserAction: vi.fn(),
	runOffsiteDryRun: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/backup/service", () => ({
	getBackupPolicySummary: mocks.getBackupPolicySummary,
}));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/storage/offsite/dry-run", () => ({ runOffsiteDryRun: mocks.runOffsiteDryRun }));

let currentSession: Record<string, unknown> | null = null;

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
			return await handler({ session: currentSession, body });
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

const retention = await import("../retention/route");
const dryRun = await import("../offsite/dry-run/route");

function post(url: string, body?: unknown) {
	return new Request(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const RETENTION_URL = "https://a.test/api/backups/retention";
const DRY_RUN_URL = "https://a.test/api/backups/offsite/dry-run";

describe("backup retention + offsite dry-run routes", () => {
	beforeEach(() => {
		for (const stub of [
			mocks.getBackupPolicySummary,
			mocks.enqueueJob,
			mocks.auditUserAction,
			mocks.runOffsiteDryRun,
		]) {
			stub.mockReset();
		}
		mocks.guardCalls.length = 0;
		currentSession = session;
		mocks.getBackupPolicySummary.mockResolvedValue({ olderThanDays: 30, expiring: 4 });
		mocks.enqueueJob.mockResolvedValue({ id: "job_1" });
	});

	describe("GET /api/backups/retention", () => {
		it("reads the policy summary under backup:read for this session", async () => {
			const res = await retention.GET(new Request(RETENTION_URL));

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ summary: { olderThanDays: 30, expiring: 4 } });
			expect(mocks.guardCalls[0]).toMatchObject({ permission: "backup:read" });
			expect(mocks.getBackupPolicySummary).toHaveBeenCalledWith(session);
		});
	});

	describe("POST /api/backups/retention", () => {
		it("enqueues the prune under backup:create and answers 202", async () => {
			const res = await retention.POST(post(RETENTION_URL, { olderThanDays: 45 }));
			const json = await res.json();

			expect(res.status).toBe(202);
			expect(json).toEqual({ jobId: "job_1", taskId: "job:job_1" });
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "backup:create",
				rateLimit: { maxRequests: 30, windowMs: 60_000 },
			});
		});

		it("stamps the caller's team on both the payload and the job row", async () => {
			await retention.POST(post(RETENTION_URL, { olderThanDays: 45, keepLatestPerType: 3 }));

			// Both matter: the worker reads payload.teamId, and the job row's teamId
			// is what scopes the task centre entry.
			expect(mocks.enqueueJob).toHaveBeenCalledWith({
				type: "backup.retention",
				title: expect.any(String),
				payload: { olderThanDays: 45, keepLatestPerType: 3, teamId: "team_1" },
				createdBy: "u_1",
				teamId: "team_1",
				maxAttempts: 1,
			});
		});

		it("passes a null teamId through rather than inventing one", async () => {
			// `pruneOldBackupRecordsNow` fails closed on a null teamId; the route must
			// not substitute a default that would widen the prune.
			currentSession = { ...session, currentTeamId: null };

			await retention.POST(post(RETENTION_URL, {}));

			expect(mocks.enqueueJob).toHaveBeenCalledWith(
				expect.objectContaining({ payload: { teamId: null }, teamId: null }),
			);
		});

		it("never retries a prune", async () => {
			await retention.POST(post(RETENTION_URL, {}));
			expect(mocks.enqueueJob).toHaveBeenCalledWith(
				expect.objectContaining({ maxAttempts: 1 }),
			);
		});

		it("audits the enqueue with the requested policy", async () => {
			await retention.POST(post(RETENTION_URL, { olderThanDays: 7 }));
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"backup.retention.enqueue",
				{ jobId: "job_1", payload: { olderThanDays: 7 } },
				undefined,
				"team_1",
			);
		});

		it.each([
			["a zero day window", { olderThanDays: 0 }],
			["a negative day window", { olderThanDays: -1 }],
			["a fractional day window", { olderThanDays: 1.5 }],
			["a window beyond ten years", { olderThanDays: 3651 }],
			["a negative keepLatestPerType", { keepLatestPerType: -1 }],
			["keepLatestPerType over the cap", { keepLatestPerType: 1001 }],
		])("rejects %s without enqueueing anything", async (_label, body) => {
			const res = await retention.POST(post(RETENTION_URL, body));
			expect(res.status).toBe(400);
			expect(mocks.enqueueJob).not.toHaveBeenCalled();
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});

		it("does not audit when the enqueue itself fails", async () => {
			mocks.enqueueJob.mockRejectedValue(new Error("job table unavailable"));
			const res = await retention.POST(post(RETENTION_URL, {}));
			expect(res.status).toBe(500);
			expect(mocks.auditUserAction).not.toHaveBeenCalled();
		});
	});

	describe("POST /api/backups/offsite/dry-run", () => {
		it("requires backup:create behind a write limit", async () => {
			mocks.runOffsiteDryRun.mockResolvedValue({ ok: true, probeKey: "p", latencyMs: 12 });
			await dryRun.POST(post(DRY_RUN_URL));
			expect(mocks.guardCalls[0]).toMatchObject({
				permission: "backup:create",
				rateLimit: { maxRequests: 30, windowMs: 60_000 },
			});
		});

		it("returns the probe result on success", async () => {
			mocks.runOffsiteDryRun.mockResolvedValue({
				ok: true,
				probeKey: "prefix/_probe/abc",
				latencyMs: 42,
			});

			const res = await dryRun.POST(post(DRY_RUN_URL));

			expect(res.status).toBe(200);
			expect(await res.json()).toMatchObject({ ok: true, probeKey: "prefix/_probe/abc" });
		});

		it.each([
			["offsite_disabled", { ok: false, reason: "offsite_disabled" }],
			["config_invalid", { ok: false, reason: "config_invalid", issues: ["bucket is required"] }],
		])("reports %s as 422 rather than a 200 with ok:false", async (_label, result) => {
			mocks.runOffsiteDryRun.mockResolvedValue(result);

			const res = await dryRun.POST(post(DRY_RUN_URL));

			expect(res.status).toBe(422);
			expect(await res.json()).toMatchObject(result);
		});

		it("maps an S3 failure to 502 with the remote code preserved", async () => {
			const { S3Error } = await import("@/lib/storage/offsite/s3-client");
			mocks.runOffsiteDryRun.mockRejectedValue(
				new S3Error("signature mismatch", 403, "SignatureDoesNotMatch"),
			);

			const res = await dryRun.POST(post(DRY_RUN_URL));
			const json = await res.json();

			expect(res.status).toBe(502);
			expect(json).toMatchObject({
				error: "s3_error",
				code: "SignatureDoesNotMatch",
				message: "signature mismatch",
				status: 403,
			});
		});

		it("lets a non-S3 failure surface as a 500", async () => {
			mocks.runOffsiteDryRun.mockRejectedValue(new Error("unexpected"));
			const res = await dryRun.POST(post(DRY_RUN_URL));
			expect(res.status).toBe(500);
		});
	});
});
