import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the six VPS backup routes.
 *
 * The property that matters most here is tenant isolation: every one of these
 * routes takes `serverId` straight from the URL, so `assertServerTeamAccess`
 * must run *before* any record is read, and every record lookup must be scoped
 * by `serverId` — otherwise a record id from another team's server would resolve.
 * The rest pins the compensation paths (an enqueue failure must not leave a
 * PENDING row behind) and the status rules the UI depends on.
 */
const mocks = vi.hoisted(() => ({
	prisma: {
		server: { findUnique: vi.fn() },
		vpsBackupRecord: { findFirst: vi.fn(), update: vi.fn() },
		vpsBackupSchedule: { findFirst: vi.fn() },
	},
	teamAccess: vi.fn(),
	backup: {
		listVpsBackupRecords: vi.fn(),
		createVpsBackupRecord: vi.fn(),
		deleteVpsBackupRecord: vi.fn(),
		resolveVpsBackupFilePath: vi.fn(),
	},
	schedule: {
		listVpsBackupSchedules: vi.fn(),
		createVpsBackupSchedule: vi.fn(),
		updateVpsBackupSchedule: vi.fn(),
		deleteVpsBackupSchedule: vi.fn(),
	},
	enqueueJob: vi.fn(),
	auditUserAction: vi.fn(),
	offsite: {
		loadOffsiteConfig: vi.fn(),
		validateOffsiteConfigForUse: vi.fn(),
		getObject: vi.fn(),
	},
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/server/team-access", () => ({ assertServerTeamAccess: mocks.teamAccess }));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/i18n/translations", () => ({
	getServerLocale: vi.fn(async () => "zh"),
	// Assert on keys, not prose: the copy is free to change.
	t: (key: string) => key,
}));
vi.mock("@/lib/backup/vps-backup-service", () => ({
	...mocks.backup,
	VPS_BACKUP_CREATE_JOB_TYPE: "vps-backup:create",
}));
vi.mock("@/lib/backup/vps-backup-schedule-service", () => mocks.schedule);
vi.mock("@/lib/storage/offsite/schema", () => ({
	loadOffsiteConfig: mocks.offsite.loadOffsiteConfig,
	validateOffsiteConfigForUse: mocks.offsite.validateOffsiteConfigForUse,
}));
vi.mock("@/lib/storage/offsite/s3-client", () => ({
	S3Client: class {
		getObject = mocks.offsite.getObject;
	},
}));
vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) {
				return new Response(JSON.stringify({ error: "输入参数无效" }), { status: 400 });
			}
			body = parsed.data;
		}
		try {
			return await handler({ session, body });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? 500;
			return new Response(JSON.stringify({ error: (error as Error).message }), { status });
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

const records = await import("../records/route");
const recordItem = await import("../records/[recordId]/route");
const recordRetry = await import("../records/[recordId]/retry/route");
const recordDownload = await import("../records/[recordId]/download/route");
const schedules = await import("../schedules/route");
const scheduleItem = await import("../schedules/[scheduleId]/route");

const serverParams = { params: Promise.resolve({ id: "srv_1" }) };
const recordParams = { params: Promise.resolve({ id: "srv_1", recordId: "rec_1" }) };
const scheduleParams = { params: Promise.resolve({ id: "srv_1", scheduleId: "sch_1" }) };

function json(url: string, method: string, body?: unknown) {
	return new Request(url, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const denied = () =>
	({ ok: false, response: Response.json({ error: "Server not found" }, { status: 404 }) }) as any;

describe("VPS backup routes", () => {
	beforeEach(() => {
		for (const group of [mocks.prisma.server, mocks.prisma.vpsBackupRecord, mocks.prisma.vpsBackupSchedule, mocks.backup, mocks.schedule, mocks.offsite]) {
			for (const stub of Object.values(group)) (stub as any).mockReset();
		}
		mocks.teamAccess.mockReset();
		mocks.enqueueJob.mockReset();
		mocks.auditUserAction.mockReset();
		mocks.guardCalls.length = 0;
		mocks.teamAccess.mockResolvedValue({ ok: true, server: { id: "srv_1", teamId: "team_1" } });
	});

	describe("tenant isolation", () => {
		it.each([
			["records GET", () => records.GET(json("https://a.test/r", "GET"), serverParams), () => mocks.backup.listVpsBackupRecords],
			["records POST", () => records.POST(json("https://a.test/r", "POST", { backupType: "mysql" }), serverParams), () => mocks.backup.createVpsBackupRecord],
			["record DELETE", () => recordItem.DELETE(json("https://a.test/r", "DELETE"), recordParams), () => mocks.backup.deleteVpsBackupRecord],
			["record retry", () => recordRetry.POST(json("https://a.test/r", "POST"), recordParams), () => mocks.backup.createVpsBackupRecord],
			["record download", () => recordDownload.GET(json("https://a.test/r", "GET"), recordParams), () => mocks.backup.resolveVpsBackupFilePath],
			["schedules GET", () => schedules.GET(json("https://a.test/s", "GET"), serverParams), () => mocks.schedule.listVpsBackupSchedules],
			["schedules POST", () => schedules.POST(json("https://a.test/s", "POST", { name: "n", cronExpression: "0 3 * * *", backupType: "mysql" }), serverParams), () => mocks.schedule.createVpsBackupSchedule],
			["schedule PATCH", () => scheduleItem.PATCH(json("https://a.test/s", "PATCH", { name: "n" }), scheduleParams), () => mocks.schedule.updateVpsBackupSchedule],
			["schedule DELETE", () => scheduleItem.DELETE(json("https://a.test/s", "DELETE"), scheduleParams), () => mocks.schedule.deleteVpsBackupSchedule],
		])("%s stops at the team guard and touches nothing", async (_name, call, effect) => {
			mocks.teamAccess.mockResolvedValue(denied());

			const response = await call();

			expect(response.status).toBe(404);
			expect(effect()).not.toHaveBeenCalled();
			expect(mocks.prisma.vpsBackupRecord.findFirst).not.toHaveBeenCalled();
			expect(mocks.prisma.vpsBackupSchedule.findFirst).not.toHaveBeenCalled();
		});

		it.each([
			["records GET", () => records.GET(json("https://a.test/r", "GET"), serverParams), "server:read"],
			["records POST", () => records.POST(json("https://a.test/r", "POST", { backupType: "mysql" }), serverParams), "server:write"],
			["record DELETE", () => recordItem.DELETE(json("https://a.test/r", "DELETE"), recordParams), "server:write"],
			["record retry", () => recordRetry.POST(json("https://a.test/r", "POST"), recordParams), "server:write"],
			["record download", () => recordDownload.GET(json("https://a.test/r", "GET"), recordParams), "server:read"],
			["schedules GET", () => schedules.GET(json("https://a.test/s", "GET"), serverParams), "server:read"],
			["schedules POST", () => schedules.POST(json("https://a.test/s", "POST", { name: "n", cronExpression: "0 3 * * *", backupType: "mysql" }), serverParams), "server:write"],
			["schedule PATCH", () => scheduleItem.PATCH(json("https://a.test/s", "PATCH", { name: "n" }), scheduleParams), "server:write"],
			["schedule DELETE", () => scheduleItem.DELETE(json("https://a.test/s", "DELETE"), scheduleParams), "server:write"],
		])("%s is gated on %s", async (_name, call, permission) => {
			mocks.teamAccess.mockResolvedValue(denied());

			await call();

			expect(mocks.guardCalls[0]).toMatchObject({ permission });
			expect(mocks.guardCalls[0]?.rateLimit).toBeDefined();
		});

		it("scopes every record lookup by serverId, so another server's record id is a 404", async () => {
			// A bare `findUnique({ id: recordId })` here would be the IDOR: the team
			// guard only proves the caller may reach *this* server.
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1", name: "web", enabled: true, teamId: "team_1" });
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue(null);

			for (const call of [
				() => recordItem.DELETE(json("https://a.test/r", "DELETE"), recordParams),
				() => recordRetry.POST(json("https://a.test/r", "POST"), recordParams),
				() => recordDownload.GET(json("https://a.test/r", "GET"), recordParams),
			]) {
				const response = await call();
				expect(response.status).toBe(404);
			}
			for (const call of mocks.prisma.vpsBackupRecord.findFirst.mock.calls) {
				expect(call[0].where).toEqual({ id: "rec_1", serverId: "srv_1" });
			}
		});
	});

	describe("manual trigger", () => {
		beforeEach(() => {
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1", name: "web", enabled: true, teamId: "team_1" });
			mocks.backup.createVpsBackupRecord.mockResolvedValue({ id: "rec_new" });
		});

		it("enqueues a backup job and answers 202 PENDING", async () => {
			const response = await records.POST(json("https://a.test/r", "POST", { backupType: "mysql" }), serverParams);

			expect(response.status).toBe(202);
			await expect(response.json()).resolves.toEqual({ recordId: "rec_new", status: "PENDING" });
			expect(mocks.enqueueJob).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "vps-backup:create",
					teamId: "team_1",
					maxAttempts: 1,
					payload: expect.objectContaining({ recordId: "rec_new", serverId: "srv_1", teamId: "team_1" }),
				}),
			);
		});

		it("refuses a custom backup with no paths", async () => {
			const response = await records.POST(json("https://a.test/r", "POST", { backupType: "custom" }), serverParams);

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({ error: "vpsBackupApi.errorCustomPathsRequired" });
			expect(mocks.backup.createVpsBackupRecord).not.toHaveBeenCalled();
		});

		it("refuses a backup of a disabled server", async () => {
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1", name: "web", enabled: false, teamId: "team_1" });

			const response = await records.POST(json("https://a.test/r", "POST", { backupType: "mysql" }), serverParams);

			expect(response.status).toBe(400);
			expect(mocks.backup.createVpsBackupRecord).not.toHaveBeenCalled();
		});

		it("rejects an unknown backupType at the schema boundary", async () => {
			const response = await records.POST(json("https://a.test/r", "POST", { backupType: "rm -rf" }), serverParams);

			expect(response.status).toBe(400);
			expect(mocks.backup.createVpsBackupRecord).not.toHaveBeenCalled();
		});

		it("marks the new record FAILED when the job cannot be enqueued", async () => {
			// Otherwise the row sits at PENDING forever and the UI shows a backup that
			// no worker will ever pick up.
			mocks.enqueueJob.mockRejectedValue(new Error("queue down"));

			const response = await records.POST(json("https://a.test/r", "POST", { backupType: "mysql" }), serverParams);

			expect(response.status).toBe(500);
			expect(mocks.prisma.vpsBackupRecord.update).toHaveBeenCalledWith({
				where: { id: "rec_new" },
				data: expect.objectContaining({ status: "FAILED", errorMessage: "queue down" }),
			});
		});

		it("falls back to the server's own team when the session has no workspace", async () => {
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1", name: "web", enabled: true, teamId: "team_9" });
			session.currentTeamId = null as any;
			try {
				await records.POST(json("https://a.test/r", "POST", { backupType: "mysql" }), serverParams);
			} finally {
				session.currentTeamId = "team_1";
			}

			// An unstamped job is `teamId: null`, which `teamWhere` reads as
			// shared-with-everyone.
			expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ teamId: "team_9" }));
		});

		it("lists records for the scoped server only", async () => {
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1" });
			mocks.backup.listVpsBackupRecords.mockResolvedValue([{ id: "rec_1" }]);

			const response = await records.GET(json("https://a.test/r", "GET"), serverParams);

			expect(response.status).toBe(200);
			expect(mocks.backup.listVpsBackupRecords).toHaveBeenCalledWith("srv_1");
		});
	});

	describe("retry", () => {
		beforeEach(() => {
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1", name: "web", enabled: true, teamId: "team_1" });
			mocks.backup.createVpsBackupRecord.mockResolvedValue({ id: "rec_retry" });
		});

		it("creates a fresh record inheriting the failed one's type and paths", async () => {
			// The status CAS only accepts PENDING→RUNNING, so a FAILED row can never
			// be re-run in place — the intent has to be copied forward.
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({
				id: "rec_1",
				status: "FAILED",
				backupType: "custom",
				paths: ["/etc", "/srv"],
			});

			const response = await recordRetry.POST(json("https://a.test/r", "POST"), recordParams);

			expect(response.status).toBe(202);
			expect(mocks.backup.createVpsBackupRecord).toHaveBeenCalledWith({
				serverId: "srv_1",
				backupType: "custom",
				createdBy: "u_1",
				paths: ["/etc", "/srv"],
			});
			expect(mocks.enqueueJob).toHaveBeenCalledWith(
				expect.objectContaining({ payload: expect.objectContaining({ paths: ["/etc", "/srv"] }) }),
			);
		});

		it.each(["PENDING", "RUNNING", "COMPLETED"])("refuses to retry a %s record", async (status) => {
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({ id: "rec_1", status, backupType: "mysql", paths: [] });

			const response = await recordRetry.POST(json("https://a.test/r", "POST"), recordParams);

			expect(response.status).toBe(409);
			expect(mocks.backup.createVpsBackupRecord).not.toHaveBeenCalled();
		});

		it("refuses to retry against a disabled server", async () => {
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1", name: "web", enabled: false, teamId: "team_1" });

			const response = await recordRetry.POST(json("https://a.test/r", "POST"), recordParams);

			expect(response.status).toBe(400);
			expect(mocks.prisma.vpsBackupRecord.findFirst).not.toHaveBeenCalled();
		});

		it("compensates the retry record when the enqueue fails", async () => {
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({ id: "rec_1", status: "FAILED", backupType: "mysql", paths: [] });
			mocks.enqueueJob.mockRejectedValue(new Error("queue down"));

			const response = await recordRetry.POST(json("https://a.test/r", "POST"), recordParams);

			expect(response.status).toBe(500);
			expect(mocks.prisma.vpsBackupRecord.update).toHaveBeenCalledWith({
				where: { id: "rec_retry" },
				data: expect.objectContaining({ status: "FAILED" }),
			});
		});
	});

	describe("delete record", () => {
		it("reports a RUNNING record as a conflict rather than a server error", async () => {
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({ id: "rec_1" });
			mocks.backup.deleteVpsBackupRecord.mockRejectedValue(new Error("Cannot delete a RUNNING backup"));

			const response = await recordItem.DELETE(json("https://a.test/r", "DELETE"), recordParams);

			expect(response.status).toBe(409);
		});

		it("degrades an unexpected failure to 500 without leaking the message", async () => {
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({ id: "rec_1" });
			mocks.backup.deleteVpsBackupRecord.mockRejectedValue(new Error("ENOSPC: /var/backups"));

			const response = await recordItem.DELETE(json("https://a.test/r", "DELETE"), recordParams);

			expect(response.status).toBe(500);
			await expect(response.json()).resolves.toEqual({ error: "vpsBackupApi.errorDeleteRecordFailed" });
		});

		it("deletes and audits a record it owns", async () => {
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({ id: "rec_1" });
			mocks.backup.deleteVpsBackupRecord.mockResolvedValue(undefined);

			const response = await recordItem.DELETE(json("https://a.test/r", "DELETE"), recordParams);

			expect(response.status).toBe(200);
			expect(mocks.backup.deleteVpsBackupRecord).toHaveBeenCalledWith("rec_1");
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"vps-backup.record.delete",
				{ serverId: "srv_1", recordId: "rec_1" },
				undefined,
				"team_1",
			);
		});
	});

	describe("download", () => {
		it("streams the local archive with its size and filename", async () => {
			const { mkdtempSync, writeFileSync } = await import("node:fs");
			const { join } = await import("node:path");
			const { tmpdir } = await import("node:os");
			const file = join(mkdtempSync(join(tmpdir(), "vch-vps-")), "backup.tar.gz");
			writeFileSync(file, "payload");

			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({
				id: "rec_1",
				localPath: "vps-backups/backup.tar.gz",
				backupType: "mysql",
				status: "COMPLETED",
				offsiteKey: null,
			});
			mocks.backup.resolveVpsBackupFilePath.mockReturnValue(file);

			const response = await recordDownload.GET(json("https://a.test/r", "GET"), recordParams);

			expect(response.status).toBe(200);
			expect(response.headers.get("content-length")).toBe("7");
			expect(response.headers.get("content-disposition")).toBe('attachment; filename="mysql-rec_1.tar.gz"');
			expect(response.headers.get("x-vch-backup-source")).toBeNull();
			await expect(response.text()).resolves.toBe("payload");
		});

		it("falls back to the offsite copy when the local file is gone", async () => {
			// The record is still COMPLETED after a disk loss or a manual cleanup;
			// answering 404 while an S3 object exists would be a dead download.
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({
				id: "rec_1",
				localPath: "vps-backups/gone.tar.gz",
				backupType: "mysql",
				status: "COMPLETED",
				offsiteKey: "offsite/rec_1.tar.gz",
			});
			mocks.backup.resolveVpsBackupFilePath.mockReturnValue("/nonexistent/vch-test/gone.tar.gz");
			mocks.offsite.loadOffsiteConfig.mockResolvedValue({ enabled: true });
			mocks.offsite.validateOffsiteConfigForUse.mockReturnValue([]);
			mocks.offsite.getObject.mockResolvedValue({ body: "remote-bytes", size: 12 });

			const response = await recordDownload.GET(json("https://a.test/r", "GET"), recordParams);

			expect(response.status).toBe(200);
			expect(response.headers.get("x-vch-backup-source")).toBe("offsite");
			expect(response.headers.get("content-length")).toBe("12");
			expect(mocks.offsite.getObject).toHaveBeenCalledWith("offsite/rec_1.tar.gz");
		});

		it.each([
			["offsite is disabled", { enabled: false }, [] as string[], { body: "x", size: 1 }],
			["offsite is misconfigured", { enabled: true }, ["missing bucket"], { body: "x", size: 1 }],
			["the object is gone too", { enabled: true }, [] as string[], null],
		])("404s when the local file is missing and %s", async (_case, config, issues, object) => {
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({
				id: "rec_1",
				localPath: "vps-backups/gone.tar.gz",
				backupType: "mysql",
				status: "COMPLETED",
				offsiteKey: "offsite/rec_1.tar.gz",
			});
			mocks.backup.resolveVpsBackupFilePath.mockReturnValue("/nonexistent/vch-test/gone.tar.gz");
			mocks.offsite.loadOffsiteConfig.mockResolvedValue(config);
			mocks.offsite.validateOffsiteConfigForUse.mockReturnValue(issues);
			mocks.offsite.getObject.mockResolvedValue(object);

			const response = await recordDownload.GET(json("https://a.test/r", "GET"), recordParams);

			expect(response.status).toBe(404);
			await expect(response.json()).resolves.toEqual({ error: "vpsBackupApi.errorFileNotFound" });
		});

		it("404s without touching offsite when the record has no offsite key", async () => {
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({
				id: "rec_1",
				localPath: "vps-backups/gone.tar.gz",
				backupType: "mysql",
				status: "COMPLETED",
				offsiteKey: null,
			});
			mocks.backup.resolveVpsBackupFilePath.mockReturnValue("/nonexistent/vch-test/gone.tar.gz");

			const response = await recordDownload.GET(json("https://a.test/r", "GET"), recordParams);

			expect(response.status).toBe(404);
			expect(mocks.offsite.loadOffsiteConfig).not.toHaveBeenCalled();
		});

		it.each([
			["a RUNNING record", { status: "RUNNING", localPath: "x" }],
			["a COMPLETED record with no file recorded", { status: "COMPLETED", localPath: null }],
		])("refuses to download %s", async (_case, patch) => {
			mocks.prisma.vpsBackupRecord.findFirst.mockResolvedValue({
				id: "rec_1",
				backupType: "mysql",
				offsiteKey: null,
				...patch,
			});

			const response = await recordDownload.GET(json("https://a.test/r", "GET"), recordParams);

			expect(response.status).toBe(400);
			await expect(response.json()).resolves.toEqual({ error: "vpsBackupApi.errorNotCompleted" });
			expect(mocks.backup.resolveVpsBackupFilePath).not.toHaveBeenCalled();
		});
	});

	describe("schedules", () => {
		it("creates a schedule and answers 201", async () => {
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1", name: "web" });
			mocks.schedule.createVpsBackupSchedule.mockResolvedValue({ id: "sch_1", name: "nightly" });

			const response = await schedules.POST(
				json("https://a.test/s", "POST", { name: "nightly", cronExpression: "0 3 * * *", backupType: "mysql", retentionDays: 30 }),
				serverParams,
			);

			expect(response.status).toBe(201);
			expect(mocks.schedule.createVpsBackupSchedule).toHaveBeenCalledWith({
				serverId: "srv_1",
				name: "nightly",
				cronExpression: "0 3 * * *",
				backupType: "mysql",
				retentionDays: 30,
				createdById: "u_1",
			});
		});

		it("keeps a ValidationError from the service as a 4xx instead of a blanket 500", async () => {
			// An invalid cron expression is the caller's mistake; a 500 would send
			// whoever is on call looking for a server fault.
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1", name: "web" });
			const { ValidationError } = await import("@/lib/errors");
			mocks.schedule.createVpsBackupSchedule.mockRejectedValue(new ValidationError("bad cron"));

			const response = await schedules.POST(
				json("https://a.test/s", "POST", { name: "nightly", cronExpression: "not a cron", backupType: "mysql" }),
				serverParams,
			);

			expect(response.status).toBe(400);
		});

		it("keeps a ValidationError from an update as a 4xx too", async () => {
			const { ValidationError } = await import("@/lib/errors");
			mocks.schedule.updateVpsBackupSchedule.mockRejectedValue(new ValidationError("bad cron"));

			const response = await scheduleItem.PATCH(json("https://a.test/s", "PATCH", { cronExpression: "nope" }), scheduleParams);

			expect(response.status).toBe(400);
		});

		it("degrades an unexpected update failure to 500", async () => {
			mocks.schedule.updateVpsBackupSchedule.mockRejectedValue(new Error("connection reset"));

			const response = await scheduleItem.PATCH(json("https://a.test/s", "PATCH", { name: "n" }), scheduleParams);

			expect(response.status).toBe(500);
			await expect(response.json()).resolves.toEqual({ error: "vpsBackupApi.errorUpdateFailed" });
		});

		it("passes the server id into the update so the schedule cannot be borrowed", async () => {
			mocks.schedule.updateVpsBackupSchedule.mockResolvedValue({ id: "sch_1", status: "PAUSED" });

			const response = await scheduleItem.PATCH(json("https://a.test/s", "PATCH", { status: "PAUSED" }), scheduleParams);

			expect(response.status).toBe(200);
			expect(mocks.schedule.updateVpsBackupSchedule).toHaveBeenCalledWith("sch_1", "srv_1", { status: "PAUSED" });
		});

		it.each([
			["an out-of-range retentionDays", { retentionDays: 0 }],
			["an unknown status", { status: "ARCHIVED" }],
			["an unknown backupType", { backupType: "everything" }],
		])("rejects %s at the schema boundary", async (_case, body) => {
			const response = await scheduleItem.PATCH(json("https://a.test/s", "PATCH", body), scheduleParams);

			expect(response.status).toBe(400);
			expect(mocks.schedule.updateVpsBackupSchedule).not.toHaveBeenCalled();
		});

		it("404s a schedule that belongs to another server before deleting anything", async () => {
			mocks.prisma.vpsBackupSchedule.findFirst.mockResolvedValue(null);

			const response = await scheduleItem.DELETE(json("https://a.test/s", "DELETE"), scheduleParams);

			expect(response.status).toBe(404);
			expect(mocks.prisma.vpsBackupSchedule.findFirst).toHaveBeenCalledWith({
				where: { id: "sch_1", serverId: "srv_1" },
				select: { id: true },
			});
			expect(mocks.schedule.deleteVpsBackupSchedule).not.toHaveBeenCalled();
		});

		it("deletes a schedule it owns and audits it", async () => {
			mocks.prisma.vpsBackupSchedule.findFirst.mockResolvedValue({ id: "sch_1" });
			mocks.schedule.deleteVpsBackupSchedule.mockResolvedValue(undefined);

			const response = await scheduleItem.DELETE(json("https://a.test/s", "DELETE"), scheduleParams);

			expect(response.status).toBe(200);
			expect(mocks.schedule.deleteVpsBackupSchedule).toHaveBeenCalledWith("sch_1", "srv_1");
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"vps-backup.schedule.delete",
				{ serverId: "srv_1", scheduleId: "sch_1" },
				undefined,
				"team_1",
			);
		});

		it("lists schedules for the scoped server only", async () => {
			mocks.prisma.server.findUnique.mockResolvedValue({ id: "srv_1" });
			mocks.schedule.listVpsBackupSchedules.mockResolvedValue([{ id: "sch_1" }]);

			const response = await schedules.GET(json("https://a.test/s", "GET"), serverParams);

			expect(response.status).toBe(200);
			expect(mocks.schedule.listVpsBackupSchedules).toHaveBeenCalledWith("srv_1");
		});
	});
});
