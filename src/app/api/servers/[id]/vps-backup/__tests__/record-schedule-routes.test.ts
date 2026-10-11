import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";
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
	UPLOAD_CHUNK_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({
	assertServerTeamAccess: vi.fn(), recordFindFirst: vi.fn(), serverFindUnique: vi.fn(), scheduleFindFirst: vi.fn(),
	deleteVpsBackupRecord: vi.fn(), createVpsBackupRecord: vi.fn(), enqueueJob: vi.fn(),
	updateVpsBackupSchedule: vi.fn(), deleteVpsBackupSchedule: vi.fn(), auditUserAction: vi.fn(),
}));
vi.mock("@/lib/server/team-access", () => ({ assertServerTeamAccess: mocks.assertServerTeamAccess }));
vi.mock("@/lib/db", () => ({ prisma: { vpsBackupRecord: { findFirst: mocks.recordFindFirst }, server: { findUnique: mocks.serverFindUnique }, vpsBackupSchedule: { findFirst: mocks.scheduleFindFirst } } }));
vi.mock("@/lib/backup/vps-backup-service", async (original) => ({ ...((await original()) as Record<string, unknown>), deleteVpsBackupRecord: mocks.deleteVpsBackupRecord, createVpsBackupRecord: mocks.createVpsBackupRecord }));
vi.mock("@/lib/backup/vps-backup-schedule-service", async (original) => ({ ...((await original()) as Record<string, unknown>), updateVpsBackupSchedule: mocks.updateVpsBackupSchedule, deleteVpsBackupSchedule: mocks.deleteVpsBackupSchedule }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const record = await import("../records/[recordId]/route");
const retry = await import("../records/[recordId]/retry/route");
const schedule = await import("../schedules/[scheduleId]/route");
const req = (method: string, url: string, body?: unknown) =>
	new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const recordParams = Promise.resolve({ id: "srv_1", recordId: "rec_1" });
const scheduleParams = Promise.resolve({ id: "srv_1", scheduleId: "sch_1" });

describe("VPS backup record and schedule routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["server:write"]);
		mocks.assertServerTeamAccess.mockResolvedValue({ ok: true });
		mocks.recordFindFirst.mockResolvedValue({ id: "rec_1", status: "FAILED", backupType: "FULL", paths: ["/srv"] });
		mocks.serverFindUnique.mockResolvedValue({ id: "srv_1", name: "web", enabled: true, teamId: "team_1" });
		mocks.createVpsBackupRecord.mockResolvedValue({ id: "rec_2" });
		mocks.enqueueJob.mockResolvedValue({ id: "job_1" });
		mocks.scheduleFindFirst.mockResolvedValue({ id: "sch_1" });
		mocks.updateVpsBackupSchedule.mockResolvedValue({ id: "sch_1", name: "nightly" });
	});

	it("every route needs server:write and manage-level access to the server", async () => {
		routeSession.current = customerSession(["server:read"]);
		expect((await record.DELETE(req("DELETE", "http://local/x"), { params: recordParams })).status).toBe(403);
		expect((await retry.POST(req("POST", "http://local/x"), { params: recordParams })).status).toBe(403);
		expect((await schedule.PATCH(req("PATCH", "http://local/x", { name: "n" }), { params: scheduleParams })).status).toBe(403);
		routeSession.current = customerSession(["server:write"]);
		mocks.assertServerTeamAccess.mockResolvedValue({ ok: false, response: new Response("no", { status: 404 }) });
		expect((await record.DELETE(req("DELETE", "http://local/x"), { params: recordParams })).status).toBe(404);
		expect(mocks.assertServerTeamAccess).toHaveBeenLastCalledWith(expect.anything(), "srv_1", "manage");
		expect(mocks.deleteVpsBackupRecord).not.toHaveBeenCalled();
	});

	it("deletes a record of this server only, turning a running record into a conflict", async () => {
		expect((await record.DELETE(req("DELETE", "http://local/x"), { params: recordParams })).status).toBe(200);
		expect(mocks.recordFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "rec_1", serverId: "srv_1" } }));
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "vps-backup.record.delete", { serverId: "srv_1", recordId: "rec_1" }, undefined, "team_1");
		mocks.deleteVpsBackupRecord.mockRejectedValueOnce(new Error("Record is RUNNING"));
		expect((await record.DELETE(req("DELETE", "http://local/x"), { params: recordParams })).status).toBe(409);
		mocks.recordFindFirst.mockResolvedValue(null);
		expect((await record.DELETE(req("DELETE", "http://local/x"), { params: recordParams })).status).toBe(404);
	});

	it("retries a failed record as a fresh record that inherits type and paths", async () => {
		const res = await retry.POST(req("POST", "http://local/x"), { params: recordParams });
		expect(res.status).toBeLessThan(300);
		expect(mocks.createVpsBackupRecord).toHaveBeenCalledWith({ serverId: "srv_1", backupType: "FULL", createdBy: "u_cust", paths: ["/srv"] });
		expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ payload: expect.objectContaining({ recordId: "rec_2", serverId: "srv_1", paths: ["/srv"] }), teamId: "team_1", maxAttempts: 1 }));
		mocks.recordFindFirst.mockResolvedValue({ id: "rec_1", status: "COMPLETED", backupType: "FULL", paths: [] });
		expect((await retry.POST(req("POST", "http://local/x"), { params: recordParams })).status).toBe(409);
		mocks.serverFindUnique.mockResolvedValue({ id: "srv_1", name: "web", enabled: false, teamId: "team_1" });
		expect((await retry.POST(req("POST", "http://local/x"), { params: recordParams })).status).toBe(400);
	});

	it("updates and deletes a schedule of this server with validation and audit", async () => {
		expect((await schedule.PATCH(req("PATCH", "http://local/x", { retentionDays: 0 }), { params: scheduleParams })).status).toBe(400);
		const updated = await schedule.PATCH(req("PATCH", "http://local/x", { name: "nightly", status: "PAUSED" }), { params: scheduleParams });
		expect(updated.status).toBe(200);
		expect(mocks.updateVpsBackupSchedule).toHaveBeenCalledWith("sch_1", "srv_1", { name: "nightly", status: "PAUSED" });
		mocks.updateVpsBackupSchedule.mockRejectedValueOnce(new ValidationError("bad cron"));
		expect((await schedule.PATCH(req("PATCH", "http://local/x", { cronExpression: "nope" }), { params: scheduleParams })).status).toBe(400);
		expect((await schedule.DELETE(req("DELETE", "http://local/x"), { params: scheduleParams })).status).toBe(200);
		expect(mocks.deleteVpsBackupSchedule).toHaveBeenCalled();
		mocks.scheduleFindFirst.mockResolvedValue(null);
		expect((await schedule.DELETE(req("DELETE", "http://local/x"), { params: scheduleParams })).status).toBe(404);
	});
});
