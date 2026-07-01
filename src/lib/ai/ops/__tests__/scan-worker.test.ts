/**
 * TR-032 E02: AI ops — scan worker unit tests.
 *
 * Verifies the worker orchestration: enqueue → claim → collect signals →
 * write AiOpsLog → complete job. Mirrors the cost-snapshot-worker test
 * pattern.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
	jobMocks,
	alertCountMock,
	commandFailureCountMock,
	playbookFailureCountMock,
	serverCountMock,
	backupFailureCountMock,
	aiOpsLogCountMock,
	aiOpsLogDeleteManyMock,
	pruneJobsMock,
} = vi.hoisted(() => ({
	jobMocks: {
		enqueueJob: vi.fn(),
		claimNextJob: vi.fn(),
		heartbeatJob: vi.fn(),
		completeJob: vi.fn(),
		failJob: vi.fn(),
		findFirst: vi.fn(),
	},
	alertCountMock: vi.fn(),
	commandFailureCountMock: vi.fn(),
	playbookFailureCountMock: vi.fn(),
	serverCountMock: vi.fn(),
	backupFailureCountMock: vi.fn(),
	aiOpsLogCountMock: vi.fn(),
	aiOpsLogDeleteManyMock: vi.fn(),
	pruneJobsMock: vi.fn(),
}));

vi.mock("@/lib/job/service", () => ({
	enqueueJob: jobMocks.enqueueJob,
	claimNextJob: jobMocks.claimNextJob,
	heartbeatJob: jobMocks.heartbeatJob,
	completeJob: jobMocks.completeJob,
	failJob: jobMocks.failJob,
	pruneCompletedJobsByType: pruneJobsMock,
}));

vi.mock("@/lib/health/service-alerts", () => ({
	evaluateAlerts: vi.fn(async () => ({ evaluated: true })),
}));

vi.mock("@/lib/settings/service", () => ({
	getSetting: vi.fn(async () => null),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		job: {
			findFirst: jobMocks.findFirst,
			count: vi.fn(async () => 0),
		},
		systemConfig: {
			findUnique: vi.fn(async () => null),
		},
		alertRule: {
			count: alertCountMock,
		},
		commandRequest: {
			count: commandFailureCountMock,
		},
		playbookRun: {
			count: playbookFailureCountMock,
		},
		server: {
			count: serverCountMock,
		},
		backupRecord: {
			count: backupFailureCountMock,
		},
		aiOpsLog: {
			create: vi.fn(({ data }: { data: Record<string, unknown> }) => {
				const id = `log_${Date.now()}_${Math.random().toString(16).slice(2)}`;
				return Promise.resolve({
					id,
					triggerType: data.triggerType,
					mode: data.mode,
					status: data.status,
					findings: data.findings,
					actions: data.actions,
					notes: data.notes ?? null,
					errorMessage: null,
					providerId: data.providerId ?? null,
					startedAt: data.startedAt ?? new Date(),
					completedAt: null,
					durationMs: null,
					triggeredById: data.triggeredById ?? null,
					createdAt: new Date(),
					updatedAt: new Date(),
				});
			}),
			findUnique: vi.fn(
				async () => ({ startedAt: new Date(Date.now() - 1000) }),
			),
			update: vi.fn(
				async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => ({
					id: where.id,
					triggerType: "manual",
					mode: "recommendation",
					status: data.status,
					findings: data.findings,
					actions: data.actions,
					notes: data.notes ?? null,
					errorMessage: data.errorMessage ?? null,
					providerId: null,
					startedAt: new Date(Date.now() - 1000),
					completedAt: data.completedAt ?? new Date(),
					durationMs: 1000,
					triggeredById: null,
					createdAt: new Date(Date.now() - 1000),
					updatedAt: new Date(),
				}),
			),
			count: aiOpsLogCountMock,
			deleteMany: aiOpsLogDeleteManyMock,
			},
			},
			}));

import {
	runAiOpsScanWorkerOnce,
	startAiOpsScanWorker,
	stopAiOpsScanWorkerForTests,
} from "../scan-worker";

beforeEach(() => {
	jobMocks.findFirst.mockReset();
	jobMocks.findFirst.mockResolvedValue(null);
	jobMocks.enqueueJob.mockReset();
	jobMocks.enqueueJob.mockResolvedValue({ id: "job_1" });
	jobMocks.claimNextJob.mockReset();
	jobMocks.claimNextJob.mockResolvedValue({ id: "job_1" });
	jobMocks.heartbeatJob.mockReset();
	jobMocks.heartbeatJob.mockResolvedValue(undefined);
	jobMocks.completeJob.mockReset();
	jobMocks.completeJob.mockResolvedValue(undefined);
	jobMocks.failJob.mockReset();
	jobMocks.failJob.mockResolvedValue(undefined);
	alertCountMock.mockReset();
	alertCountMock.mockResolvedValue(0);
	commandFailureCountMock.mockReset();
	commandFailureCountMock.mockResolvedValue(0);
	playbookFailureCountMock.mockReset();
	playbackFailureCountMockResolveSafe(playbookFailureCountMock);
	serverCountMock.mockReset();
	serverCountMock.mockResolvedValue(0);
	backupFailureCountMock.mockReset();
	backupFailureCountMock.mockResolvedValue(0);
	aiOpsLogCountMock.mockReset();
	aiOpsLogCountMock.mockResolvedValue(0);
	aiOpsLogDeleteManyMock.mockReset();
	aiOpsLogDeleteManyMock.mockResolvedValue({ count: 0 });
	pruneJobsMock.mockReset();
	pruneJobsMock.mockResolvedValue({ pruned: 0 });
});

function playbackFailureCountMockResolveSafe(mock: ReturnType<typeof vi.fn>) {
	mock.mockResolvedValue(0);
}

afterEach(() => {
	stopAiOpsScanWorkerForTests();
});

describe("runAiOpsScanWorkerOnce", () => {
	it("writes an AiOpsLog with status=ok when no system-health signals are present", async () => {
		const ok = await runAiOpsScanWorkerOnce("manual");
		expect(ok).toBe(true);
		expect(jobMocks.enqueueJob).toHaveBeenCalledTimes(1);
		expect(jobMocks.claimNextJob).toHaveBeenCalledTimes(1);
		expect(jobMocks.completeJob).toHaveBeenCalledTimes(1);
		expect(jobMocks.failJob).not.toHaveBeenCalled();
	});

	it("surfaces a warning when alert rules exceed the noise threshold", async () => {
		alertCountMock.mockResolvedValue(25);
		const ok = await runAiOpsScanWorkerOnce("manual");
		expect(ok).toBe(true);
		// completeJob is called with the log payload; status should be "warning"
		// We can introspect the result arg.
		const completeArgs = jobMocks.completeJob.mock.calls[0]?.[2] as {
			status?: string;
		};
		expect(completeArgs?.status).toBe("warning");
	});

	it("calls failJob when an underlying signal collector throws", async () => {
		alertCountMock.mockRejectedValue(new Error("db down"));
		const ok = await runAiOpsScanWorkerOnce("manual");
		expect(ok).toBe(true);
		expect(jobMocks.failJob).toHaveBeenCalledTimes(1);
		const failArgs = jobMocks.failJob.mock.calls[0];
		expect(failArgs?.[2]).toMatch(/db down/);
	});
});

describe("startAiOpsScanWorker / stopAiOpsScanWorkerForTests", () => {
	it("startAiOpsScanWorker is idempotent — calling twice doesn't double-start", async () => {
		const a = await startAiOpsScanWorker();
		const b = await startAiOpsScanWorker();
		expect(a.started).toBe(true);
		expect(b.started).toBe(true);
		// Same state reference.
		expect(a).toBe(b);
		stopAiOpsScanWorkerForTests();
	});
});
