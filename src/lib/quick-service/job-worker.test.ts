import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		enqueueJob: vi.fn(),
		claimNextJob: vi.fn(),
		completeJob: vi.fn(),
		failJob: vi.fn(),
		heartbeatJob: vi.fn(),
		findMany: vi.fn(),
		quickServiceFindMany: vi.fn(),
	},
}));

vi.mock("@/lib/job/service", () => ({
	enqueueJob: mocks.enqueueJob,
	claimNextJob: mocks.claimNextJob,
	completeJob: mocks.completeJob,
	failJob: mocks.failJob,
	heartbeatJob: mocks.heartbeatJob,
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		job: {
			findMany: mocks.findMany,
			findUnique: vi.fn().mockResolvedValue(null),
			update: vi.fn().mockResolvedValue({}),
		},
		quickService: { findMany: mocks.quickServiceFindMany },
	},
}));

vi.mock("@/lib/concurrency/advisory-lock", () => ({
	tryAcquireAdvisoryLock: vi.fn(async () => async () => {}),
	acquireAdvisoryLock: vi.fn(async () => async () => {}),
}));

vi.mock("./service", () => ({
	installService: vi.fn(),
	startService: vi.fn(),
	stopService: vi.fn(),
	syncServiceStatus: vi.fn(),
	uninstallService: vi.fn(),
	updateService: vi.fn(),
}));
vi.mock("./execution-authorization", () => ({ assertQuickServiceExecutionAuthorized: vi.fn(async () => {}) }));

const { enqueueQuickServiceJob, runQuickServiceJobWorkerOnce, QUICK_SERVICE_JOB_TYPE, reconcileStuckQuickServiceInstalls } = await import("./job-worker");
const quickService = await import("./service");

describe("QuickService lifecycle job enqueue", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findMany.mockResolvedValue([]);
	});

	it("rejects a different operation while the same service already has active work", async () => {
		const existing = { id: "job_existing", status: "RUNNING", payload: { action: "update", slug: "alist" } };
		mocks.findMany.mockResolvedValueOnce([existing]);

		await expect(enqueueQuickServiceJob({
			title: "QuickService stop: alist",
			createdBy: "u1",
			payload: { action: "stop", slug: "alist" },
		})).rejects.toThrow("already has a different lifecycle task in progress");

		expect(mocks.findMany).toHaveBeenCalled();
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("reuses only an equivalent active operation", async () => {
		const existing = { id: "job_existing", status: "RUNNING", payload: { action: "uninstall", slug: "alist", deleteVolumes: false } };
		mocks.findMany.mockResolvedValueOnce([existing]);

		const result = await enqueueQuickServiceJob({
			title: "Uninstall alist",
			payload: { action: "uninstall", slug: "alist", deleteVolumes: false },
		});

		expect(result).toEqual({ job: existing, taskId: "job:job_existing", reused: true });
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("enqueues a lifecycle job when the same slug has no active work", async () => {
		const created = { id: "job_new", status: "PENDING", payload: { action: "sync", slug: "alist" } };
		mocks.findMany.mockResolvedValueOnce([]);
		mocks.enqueueJob.mockResolvedValueOnce(created);

		const result = await enqueueQuickServiceJob({
			title: "QuickService sync: alist",
			payload: { action: "sync", slug: "alist" },
		});

		expect(result).toEqual({ job: created, taskId: "job:job_new", reused: false });
		expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({
			type: QUICK_SERVICE_JOB_TYPE,
			title: "QuickService sync: alist",
			payload: { action: "sync", slug: "alist" },
			maxAttempts: 1,
		}));
	});
});

describe("QuickService lifecycle job worker observability", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findMany.mockResolvedValue([]);
		mocks.heartbeatJob.mockResolvedValue({ count: 1 });
		mocks.completeJob.mockResolvedValue({ count: 1 });
		mocks.failJob.mockResolvedValue({ count: 1 });
	});

	it("records update progress and a log preview result for task-center triage", async () => {
		mocks.claimNextJob.mockResolvedValueOnce({ id: "job_update", payload: { action: "update", slug: "alist" } });
		vi.mocked(quickService.updateService).mockResolvedValueOnce({ status: "running", health: "healthy", logTail: "old line\nservice ready" });

		const ran = await runQuickServiceJobWorkerOnce(undefined, "test");
		expect(ran).not.toBe(false);
		expect(quickService.updateService).toHaveBeenCalledWith("alist", "hub-host");
		expect(mocks.completeJob).toHaveBeenCalled();
	});
});

describe("QuickService stuck install sweep", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.findMany.mockResolvedValue([]);
	});

	it("re-reads installs left unfinished with no job running for them", async () => {
		// A replaced container whose final save failed left the row
		// "installing" (every other operation refuses it) with the old id.
		mocks.quickServiceFindMany.mockResolvedValueOnce([
			{ slug: "alist", instanceKey: "hub-host" },
			{ slug: "busy", instanceKey: "hub-host" },
		]);
		mocks.findMany.mockImplementation(async (args: { where: { payload: { equals: string } } }) =>
			args.where.payload.equals === "busy" ? [{ id: "job_busy", status: "RUNNING", payload: { action: "start", slug: "busy" } }] : []);
		vi.mocked(quickService.syncServiceStatus).mockResolvedValue("running");

		await expect(reconcileStuckQuickServiceInstalls(new Date("2026-10-20T12:00:00Z"))).resolves.toBe(1);
		expect(mocks.quickServiceFindMany).toHaveBeenCalledWith(expect.objectContaining({
			where: { status: "installing", updatedAt: { lt: new Date("2026-10-20T11:45:00Z") } },
		}));
		expect(quickService.syncServiceStatus).toHaveBeenCalledTimes(1);
		expect(quickService.syncServiceStatus).toHaveBeenCalledWith("alist", "hub-host");
	});
});

