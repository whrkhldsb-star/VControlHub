import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		enqueueJob: vi.fn(),
		claimNextJob: vi.fn(),
		completeJob: vi.fn(),
		failJob: vi.fn(),
		heartbeatJob: vi.fn(),
		findMany: vi.fn(),
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
		},
	},
}));

vi.mock("./service", () => ({
	installService: vi.fn(),
	startService: vi.fn(),
	stopService: vi.fn(),
	syncServiceStatus: vi.fn(),
	uninstallService: vi.fn(),
	updateService: vi.fn(),
}));

const { enqueueQuickServiceJob, runQuickServiceJobWorkerOnce, QUICK_SERVICE_JOB_TYPE } = await import("./job-worker");
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
