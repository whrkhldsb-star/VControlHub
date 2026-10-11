import { beforeEach, describe, expect, it, vi } from "vitest";

import { BusinessError } from "@/lib/errors";
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
	getBackupRecord: vi.fn(),
	prepareBackupRecordRetry: vi.fn(),
	voidBackupRecord: vi.fn(),
	enqueueJob: vi.fn(),
	jobFindFirst: vi.fn(),
	auditUserAction: vi.fn(),
}));
vi.mock("@/lib/backup/service", () => ({ getBackupRecord: mocks.getBackupRecord, prepareBackupRecordRetry: mocks.prepareBackupRecordRetry, voidBackupRecord: mocks.voidBackupRecord }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/db", () => ({ prisma: { job: { findFirst: mocks.jobFindFirst } } }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const drill = await import("../drill/route");
const retry = await import("../retry/route");
const voidRoute = await import("../void/route");
const params = Promise.resolve({ id: "bk_1" });
const post = (path: string, body?: unknown) =>
	new Request(`http://local/api/backups/bk_1/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });

describe("backup drill, retry and void routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = platformSession({ permissions: ["backup:restore", "backup:create"] });
		mocks.getBackupRecord.mockResolvedValue({ id: "bk_1", type: "DATABASE", status: "COMPLETED", teamId: null });
		mocks.jobFindFirst.mockResolvedValue(null);
		mocks.enqueueJob.mockResolvedValue({ id: "job_1" });
		mocks.prepareBackupRecordRetry.mockResolvedValue({ id: "bk_1", type: "DATABASE" });
		mocks.voidBackupRecord.mockResolvedValue({ id: "bk_1", status: "VOID" });
	});

	it("drill needs backup:restore; retry and void need backup:create", async () => {
		routeSession.current = customerSession(["backup:read"]);
		expect((await drill.POST(post("drill"), { params })).status).toBe(403);
		expect((await retry.POST(post("retry"), { params })).status).toBe(403);
		expect((await voidRoute.POST(post("void", { reason: "stale" }), { params })).status).toBe(403);
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("queues a non-destructive drill once per backup", async () => {
		const first = await drill.POST(post("drill"), { params });
		expect(first.status).toBe(202);
		expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "backup.drill", payload: expect.objectContaining({ backupId: "bk_1" }), maxAttempts: 1 }));
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_admin", "backup.drill", expect.objectContaining({ destructive: false }), undefined, null);

		mocks.jobFindFirst.mockResolvedValue({ id: "job_running" });
		expect(await (await drill.POST(post("drill"), { params })).json()).toMatchObject({ jobId: "job_running", deduped: true });
		expect(mocks.enqueueJob).toHaveBeenCalledTimes(1);

		mocks.jobFindFirst.mockResolvedValue(null);
		mocks.getBackupRecord.mockResolvedValue({ id: "bk_1", status: "RUNNING" });
		expect((await drill.POST(post("drill"), { params })).status).toBe(400);
		mocks.getBackupRecord.mockResolvedValue(null);
		expect((await drill.POST(post("drill"), { params })).status).toBe(404);
	});

	it("retry re-queues through the CAS helper and dedupes an in-flight create", async () => {
		const res = await retry.POST(post("retry"), { params });
		expect(res.status).toBe(202);
		expect(mocks.prepareBackupRecordRetry).toHaveBeenCalledWith({ id: "bk_1", session: expect.objectContaining({ userId: "u_admin" }) });
		expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "backup.create", payload: expect.objectContaining({ backupId: "bk_1" }) }));

		mocks.jobFindFirst.mockResolvedValue({ id: "job_running" });
		expect(await (await retry.POST(post("retry"), { params })).json()).toMatchObject({ deduped: true });
		expect(mocks.prepareBackupRecordRetry).toHaveBeenCalledTimes(1);
	});

	it("void needs a reason and keeps the service's refusal status", async () => {
		expect((await voidRoute.POST(post("void", {}), { params })).status).toBe(400);
		const ok = await voidRoute.POST(post("void", { reason: "superseded" }), { params });
		expect(ok.status).toBe(200);
		expect(mocks.voidBackupRecord).toHaveBeenCalledWith({ id: "bk_1", reason: "superseded", session: expect.objectContaining({ userId: "u_admin" }) });
		mocks.voidBackupRecord.mockRejectedValueOnce(new BusinessError("cannot void completed"));
		const refused = await voidRoute.POST(post("void", { reason: "superseded" }), { params });
		expect(refused.status).toBeGreaterThanOrEqual(400);
		expect(refused.status).toBeLessThan(500);
	});
});
