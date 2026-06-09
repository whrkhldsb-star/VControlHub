import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		enqueueJob: vi.fn(),
		claimNextJob: vi.fn(),
		completeJob: vi.fn(),
		failJob: vi.fn(),
		heartbeatJob: vi.fn(),
		findFirst: vi.fn(),
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
			findFirst: mocks.findFirst,
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
	});

	it("reuses an active same-slug lifecycle job instead of enqueueing a conflicting operation", async () => {
		const existing = { id: "job_existing", status: "RUNNING", payload: { action: "update", slug: "alist" } };
		mocks.findFirst.mockResolvedValueOnce(existing);

		const result = await enqueueQuickServiceJob({
			title: "QuickService stop: alist",
			createdBy: "u1",
			payload: { action: "stop", slug: "alist" },
		});

		expect(result).toEqual({ job: existing, taskId: "job:job_existing", reused: true });
		expect(mocks.findFirst).toHaveBeenCalledWith({
			where: {
				type: QUICK_SERVICE_JOB_TYPE,
				status: { in: ["PENDING", "RUNNING"] },
				payload: { path: ["slug"], equals: "alist" },
			},
			orderBy: [{ priority: "desc" }, { availableAt: "asc" }, { createdAt: "asc" }],
		});
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("enqueues a lifecycle job when the same slug has no active work", async () => {
		const created = { id: "job_new", status: "PENDING", payload: { action: "sync", slug: "alist" } };
		mocks.findFirst.mockResolvedValueOnce(null);
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
		mocks.heartbeatJob.mockResolvedValue({ count: 1 });
		mocks.completeJob.mockResolvedValue({ count: 1 });
		mocks.failJob.mockResolvedValue({ count: 1 });
	});

	it("records update progress and a log preview result for task-center triage", async () => {
		mocks.claimNextJob.mockResolvedValueOnce({ id: "job_update", payload: { action: "update", slug: "alist" } });
		vi.mocked(quickService.updateService).mockResolvedValueOnce({ status: "running", health: "healthy", logTail: "old line\nservice ready" });

		await expect(runQuickServiceJobWorkerOnce({ started: true, running: false, timer: null }, "test")).resolves.toBe(true);

		expect(mocks.heartbeatJob).toHaveBeenNthCalledWith(1, "job_update", expect.stringContaining(":quick-service:"), expect.objectContaining({
			progress: "准备执行 QuickService update: alist",
		}));
		expect(mocks.heartbeatJob).toHaveBeenNthCalledWith(2, "job_update", expect.stringContaining(":quick-service:"), expect.objectContaining({
			progress: "正在更新 alist：拉取镜像并重建容器",
		}));
		expect(mocks.completeJob).toHaveBeenCalledWith("job_update", expect.stringContaining(":quick-service:"), expect.objectContaining({
			action: "update",
			slug: "alist",
			status: "running",
			health: "healthy",
			logPreview: "更新完成：alist\n健康状态：healthy\nold line\nservice ready",
		}));
	});
});
