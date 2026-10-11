import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/errors";
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

const mocks = vi.hoisted(() => ({
	getBackupRecord: vi.fn(),
	restoreBackupRecord: vi.fn(),
	enqueueJob: vi.fn(),
	jobFindFirst: vi.fn(),
	auditUserAction: vi.fn(),
}));
vi.mock("@/lib/backup/service", () => ({ getBackupRecord: mocks.getBackupRecord, restoreBackupRecord: mocks.restoreBackupRecord }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/db", () => ({ prisma: { job: { findFirst: mocks.jobFindFirst } } }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const route = await import("../restore/route");
const params = Promise.resolve({ id: "bk_1" });
const post = (body: unknown, query = "") =>
	route.POST(new Request(`http://local/api/backups/bk_1/restore${query}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), { params });

describe("POST /api/backups/[id]/restore", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession({ permissions: ["backup:restore"] });
		mocks.getBackupRecord.mockResolvedValue({ id: "bk_1", status: "COMPLETED", teamId: null });
		mocks.jobFindFirst.mockResolvedValue(null);
		mocks.enqueueJob.mockResolvedValue({ id: "job_1" });
	});

	it("is refused without backup:restore", async () => {
		routeSession.current = customerSession(["backup:read"]);
		const res = await post({ confirm: "RESTORE" });
		expect(res.status).toBe(403);
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("demands the explicit RESTORE confirmation in the body", async () => {
		const res = await post({ confirm: "yes" });
		expect(res.status).toBe(400);
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
		expect(mocks.restoreBackupRecord).not.toHaveBeenCalled();
	});

	it("queues a restore job carrying the confirmation and audits it", async () => {
		const res = await post({ confirm: "RESTORE", component: "database" });
		expect(res.status).toBe(202);
		expect(await res.json()).toMatchObject({ jobId: "job_1", taskId: "job:job_1" });
		expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
			type: "backup.restore",
			payload: expect.objectContaining({ backupId: "bk_1", confirm: "RESTORE", component: "database" }),
			createdBy: "u_admin",
			maxAttempts: 1,
		}));
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_admin", "backup.restore", expect.objectContaining({ backupId: "bk_1", jobId: "job_1" }), undefined, null);
	});

	it("does not queue a second restore while one is already pending for the same backup", async () => {
		mocks.jobFindFirst.mockResolvedValue({ id: "job_running" });
		const res = await post({ confirm: "RESTORE" });
		expect(res.status).toBe(202);
		expect(await res.json()).toMatchObject({ jobId: "job_running", deduped: true });
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("only restores completed backups", async () => {
		mocks.getBackupRecord.mockResolvedValue({ id: "bk_1", status: "FAILED", teamId: null });
		const res = await post({ confirm: "RESTORE" });
		expect(res.status).toBe(400);
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("answers 404 for a backup outside the caller's scope", async () => {
		mocks.getBackupRecord.mockResolvedValue(null);
		const res = await post({ confirm: "RESTORE" });
		expect(res.status).toBe(404);
	});

	it("runs the restore inline when asked to wait, keeping typed error statuses", async () => {
		mocks.restoreBackupRecord.mockResolvedValue({ id: "bk_1", restoredAt: "now" });
		const res = await post({ confirm: "RESTORE" }, "?wait=1");
		expect(res.status).toBe(200);
		expect(mocks.restoreBackupRecord).toHaveBeenCalledWith(expect.objectContaining({ id: "bk_1", confirm: "RESTORE", session: expect.objectContaining({ userId: "u_admin" }) }));
		expect(mocks.enqueueJob).not.toHaveBeenCalled();

		mocks.restoreBackupRecord.mockRejectedValue(new NotFoundError("gone"));
		const missing = await post({ confirm: "RESTORE" }, "?wait=1");
		expect(missing.status).toBe(404);
	});
});
