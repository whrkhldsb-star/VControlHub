import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tenant-scope and self-destruction guards in the sync-job CRUD layer.
 *
 * A SyncJob is a stored, executable rsync between two servers, so the two things
 * that must hold are: a caller can only name servers inside their own scope
 * (otherwise `storage:write` would be enough to rsync another team's VPS), and a
 * job can never be pointed at itself with --delete (which would wipe the
 * directory it is reading from). `@/lib/auth/team-scope` is kept real so these
 * tests pin the actual filters, not a restatement of them.
 */
const mocks = vi.hoisted(() => ({
	prisma: {
		server: { findMany: vi.fn() },
		syncJob: {
			create: vi.fn(),
			findMany: vi.fn(),
			findFirst: vi.fn(),
			deleteMany: vi.fn(),
			updateMany: vi.fn(),
		},
	},
}));

vi.mock("@/lib/db", () => ({ prisma: mocks.prisma }));
vi.mock("@/lib/i18n/service-translations", () => ({ t: (key: string) => key }));
vi.mock("@/lib/logging", () => ({
	createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));

const { createSyncJob, deleteSyncJob, getSyncJob, listSyncJobs, updateSyncJob } = await import(
	"../service-crud"
);

const operator = { userId: "u_1", roles: ["operator"] as never, currentTeamId: "team_1" };
const teamless = { userId: "u_2", roles: ["operator"] as never, currentTeamId: null };
const admin = { userId: "u_3", roles: ["admin"] as never, currentTeamId: "team_1" };

const baseInput = {
	name: "nightly",
	sourceServerId: "srv_a",
	sourcePath: "/data",
	targetServerId: "srv_b",
	targetPath: "/backup",
};

const jobRow = {
	id: "job_1",
	teamId: "team_1",
	status: "IDLE",
	syncType: "MIRROR",
	sourceServerId: "srv_a",
	targetServerId: "srv_b",
	sourcePath: "/data",
	targetPath: "/backup",
	deleteOrphans: false,
};

describe("sync job CRUD scoping", () => {
	beforeEach(() => {
		for (const stub of [
			mocks.prisma.server.findMany,
			mocks.prisma.syncJob.create,
			mocks.prisma.syncJob.findMany,
			mocks.prisma.syncJob.findFirst,
			mocks.prisma.syncJob.deleteMany,
			mocks.prisma.syncJob.updateMany,
		]) {
			stub.mockReset();
		}
		mocks.prisma.server.findMany.mockResolvedValue([{ id: "srv_a" }, { id: "srv_b" }]);
		mocks.prisma.syncJob.create.mockResolvedValue({ ...jobRow });
		mocks.prisma.syncJob.findFirst.mockResolvedValue({ ...jobRow });
		mocks.prisma.syncJob.deleteMany.mockResolvedValue({ count: 1 });
		mocks.prisma.syncJob.updateMany.mockResolvedValue({ count: 1 });
	});

	describe("createSyncJob", () => {
		it("resolves both endpoints under the caller's server scope", async () => {
			await createSyncJob({ ...baseInput, session: operator });
			expect(mocks.prisma.server.findMany).toHaveBeenCalledWith({
				where: { id: { in: ["srv_a", "srv_b"] }, teamId: "team_1" },
				select: { id: true },
			});
		});

		it("refuses when an endpoint is outside the caller's scope", async () => {
			// Only one of the two ids came back — the other belongs to another team.
			mocks.prisma.server.findMany.mockResolvedValue([{ id: "srv_a" }]);

			await expect(createSyncJob({ ...baseInput, session: operator })).rejects.toThrow(
				/outside your team scope/,
			);
			expect(mocks.prisma.syncJob.create).not.toHaveBeenCalled();
		});

		it("gives a teamless session no server scope to work with", async () => {
			mocks.prisma.server.findMany.mockResolvedValue([]);
			await expect(createSyncJob({ ...baseInput, session: teamless })).rejects.toThrow();
			expect(mocks.prisma.server.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: expect.objectContaining({ id: expect.anything() }),
				}),
			);
			const where = mocks.prisma.server.findMany.mock.calls[0]?.[0]?.where as Record<string, unknown>;
			// A null currentTeamId must not degrade to "no filter".
			expect(where.teamId).toBeUndefined();
			expect(where.id).not.toEqual({ in: ["srv_a", "srv_b"] });
		});

		it("lets a global manager reach any server", async () => {
			await createSyncJob({ ...baseInput, session: admin });
			expect(mocks.prisma.server.findMany).toHaveBeenCalledWith({
				where: { id: { in: ["srv_a", "srv_b"] } },
				select: { id: true },
			});
		});

		it("stamps the caller's team on the new job", async () => {
			await createSyncJob({ ...baseInput, session: operator });
			expect(mocks.prisma.syncJob.create).toHaveBeenCalledWith(
				expect.objectContaining({ data: expect.objectContaining({ teamId: "team_1" }) }),
			);
		});

		it("refuses a job that syncs one path onto itself", async () => {
			await expect(
				createSyncJob({
					...baseInput,
					targetServerId: "srv_a",
					targetPath: "/data/",
					session: operator,
				}),
			).rejects.toThrow();
			expect(mocks.prisma.server.findMany).not.toHaveBeenCalled();
			expect(mocks.prisma.syncJob.create).not.toHaveBeenCalled();
		});

		it("refuses a job with no endpoints at all", async () => {
			await expect(
				createSyncJob({ ...baseInput, sourceServerId: "", targetServerId: "", session: operator }),
			).rejects.toThrow();
			expect(mocks.prisma.syncJob.create).not.toHaveBeenCalled();
		});

		it("forces deleteOrphans off for a BIDIRECTIONAL job", async () => {
			await createSyncJob({ ...baseInput, syncType: "BIDIRECTIONAL", deleteOrphans: true, session: operator });
			expect(mocks.prisma.syncJob.create).toHaveBeenCalledWith(
				expect.objectContaining({ data: expect.objectContaining({ deleteOrphans: false }) }),
			);
		});
	});

	describe("read paths", () => {
		it("scopes a single job to the caller's team", async () => {
			await getSyncJob("job_1", operator);
			expect(mocks.prisma.syncJob.findFirst).toHaveBeenCalledWith(
				expect.objectContaining({ where: { id: "job_1", teamId: "team_1" } }),
			);
		});

		it("quarantines legacy teamless jobs from a teamless session", async () => {
			await getSyncJob("job_1", teamless);
			const where = mocks.prisma.syncJob.findFirst.mock.calls[0]?.[0]?.where as Record<string, unknown>;
			// Not `{ teamId: null }`: an unassigned job is quarantined, not shared.
			expect(where.id).toBe("__unassigned_sync_jobs_require_team_manage__");
		});

		it("never hands SSH credentials to the display query", async () => {
			await getSyncJob("job_1", operator);
			const include = mocks.prisma.syncJob.findFirst.mock.calls[0]?.[0]?.include as Record<string, any>;
			expect(include.sourceServer.select.sshKey).toBeUndefined();
			expect(include.sourceServer).not.toHaveProperty("include");
			expect(include.targetServer).not.toHaveProperty("include");
		});

		it("scopes the list query too", async () => {
			mocks.prisma.syncJob.findMany.mockResolvedValue([]);
			await listSyncJobs(operator);
			expect(mocks.prisma.syncJob.findMany).toHaveBeenCalledWith(
				expect.objectContaining({ where: { teamId: "team_1" } }),
			);
		});
	});

	describe("deleteSyncJob", () => {
		it("404s a job outside the caller's team before deleting anything", async () => {
			mocks.prisma.syncJob.findFirst.mockResolvedValue(null);
			await expect(deleteSyncJob("job_other", operator)).rejects.toThrow();
			expect(mocks.prisma.syncJob.deleteMany).not.toHaveBeenCalled();
		});

		it("refuses to delete a RUNNING job", async () => {
			mocks.prisma.syncJob.findFirst.mockResolvedValue({ ...jobRow, status: "RUNNING" });
			await expect(deleteSyncJob("job_1", operator)).rejects.toThrow();
			expect(mocks.prisma.syncJob.deleteMany).not.toHaveBeenCalled();
		});

		it("re-applies both the status and the team filter in the delete itself", async () => {
			await deleteSyncJob("job_1", operator);
			expect(mocks.prisma.syncJob.deleteMany).toHaveBeenCalledWith({
				where: { id: "job_1", status: { not: "RUNNING" }, teamId: "team_1" },
			});
		});

		it("reports a lost race instead of a silent success", async () => {
			mocks.prisma.syncJob.deleteMany.mockResolvedValue({ count: 0 });
			await expect(deleteSyncJob("job_1", operator)).rejects.toThrow();
		});
	});

	describe("updateSyncJob", () => {
		it("404s a job outside the caller's team before updating anything", async () => {
			mocks.prisma.syncJob.findFirst.mockResolvedValue(null);
			await expect(updateSyncJob("job_other", { name: "x" }, operator)).rejects.toThrow();
			expect(mocks.prisma.syncJob.updateMany).not.toHaveBeenCalled();
		});

		it("refuses a PATCH that would make source and target the same path", async () => {
			mocks.prisma.syncJob.findFirst.mockResolvedValue({ ...jobRow, targetServerId: "srv_a" });
			await expect(updateSyncJob("job_1", { targetPath: "/data" }, operator)).rejects.toThrow();
			expect(mocks.prisma.syncJob.updateMany).not.toHaveBeenCalled();
		});

		it("writes only the provided fields and clears the schedule on null", async () => {
			await updateSyncJob("job_1", { schedule: null, name: "renamed" }, operator);
			expect(mocks.prisma.syncJob.updateMany).toHaveBeenCalledWith({
				where: { id: "job_1", teamId: "team_1" },
				data: { name: "renamed", schedule: null },
			});
		});

		it("recomputes deleteOrphans when the sync type changes", async () => {
			await updateSyncJob("job_1", { syncType: "BIDIRECTIONAL", deleteOrphans: true }, operator);
			const data = mocks.prisma.syncJob.updateMany.mock.calls[0]?.[0]?.data as Record<string, unknown>;
			expect(data.deleteOrphans).toBe(false);
			expect(data.syncType).toBe("BIDIRECTIONAL");
		});

		it("404s when the row vanished between the read and the write", async () => {
			mocks.prisma.syncJob.updateMany.mockResolvedValue({ count: 0 });
			await expect(updateSyncJob("job_1", { name: "x" }, operator)).rejects.toThrow();
		});
	});
});
