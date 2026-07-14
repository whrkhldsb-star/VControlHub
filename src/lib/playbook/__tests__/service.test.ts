import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		findMany: vi.fn(),
		findUnique: vi.fn(),
		create: vi.fn(),
		update: vi.fn(),
		delete: vi.fn(),
		auditUserAction: vi.fn(),
		executePlaybookChain: vi.fn(),
	},
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		playbook: {
			findMany: mocks.findMany,
			findUnique: mocks.findUnique,
			create: mocks.create,
			update: mocks.update,
			delete: mocks.delete,
		},
		playbookRun: {
			findMany: mocks.findMany,
			create: mocks.create,
			update: mocks.update,
		},
	},
}));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("../executor", () => ({ executePlaybookChain: mocks.executePlaybookChain }));

import {
	createPlaybook,
	deletePlaybook,
	getPlaybook,
	listPlaybookRuns,
	listPlaybooks,
	runPlaybook,
	updatePlaybook,
} from "../service";

const baseRow = {
	id: "pb1",
	name: "Cleanup",
	description: null,
	triggerType: "cron",
	triggerConfig: { expression: "0 3 * * *" },
	steps: [
		{
			id: "s1",
			name: "run",
			type: "run_command",
			config: { command: "ls", serverIds: ["srv1"] },
			retry: 0,
			timeoutSec: 60,
		},
	],
	chainRetry: 0,
	enabled: true,
	createdById: "u1",
	createdAt: new Date("2026-01-01T00:00:00Z"),
	updatedAt: new Date("2026-01-01T00:00:00Z"),
};

describe("playbook service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.auditUserAction.mockReturnValue(undefined);
		mocks.executePlaybookChain.mockResolvedValue({ results: [] });
	});

	it("listPlaybooks narrows the raw rows", async () => {
		mocks.findMany.mockResolvedValue([baseRow]);
		const result = await listPlaybooks();
		expect(result).toHaveLength(1);
		expect(result[0]?.triggerType).toBe("cron");
		expect(result[0]?.steps[0]?.type).toBe("run_command");
	});

	it("getPlaybook returns null when missing", async () => {
		mocks.findUnique.mockResolvedValue(null);
		expect(await getPlaybook("missing")).toBeNull();
	});

	it("createPlaybook persists the playbook and audits", async () => {
		mocks.create.mockResolvedValue(baseRow);
		const playbook = await createPlaybook(
			{
				name: "Cleanup",
				triggerType: "cron",
				triggerConfig: { expression: "0 3 * * *" },
				steps: [
					{
						id: "s1",
						name: "run",
						type: "run_command",
						config: { command: "ls", serverIds: ["srv1"] },
						retry: 0,
						timeoutSec: 60,
					},
				],
				chainRetry: 0,
				enabled: true,
			},
			"u1",
		);
		expect(playbook.id).toBe("pb1");
		expect(mocks.create).toHaveBeenCalled();
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u1",
			"playbook.create",
			expect.objectContaining({ playbookId: "pb1", name: "Cleanup", stepCount: 1 }),
		);
	});

	it("updatePlaybook only writes the provided fields", async () => {
		mocks.update.mockResolvedValue({ ...baseRow, name: "Renamed" });
		await updatePlaybook(
			{ id: "pb1", name: "Renamed" },
			"u1",
		);
		expect(mocks.update).toHaveBeenCalledWith({
			where: { id: "pb1" },
			data: expect.objectContaining({ name: "Renamed" }),
		});
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u1",
			"playbook.update",
			expect.objectContaining({ playbookId: "pb1", name: "Renamed" }),
		);
	});

	it("deletePlaybook audits with the right action", async () => {
		mocks.delete.mockResolvedValue({});
		await deletePlaybook("pb1", "u1");
		expect(mocks.delete).toHaveBeenCalledWith({ where: { id: "pb1" } });
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u1", "playbook.delete", { playbookId: "pb1" });
	});

	it("listPlaybookRuns takes the latest 50", async () => {
		mocks.findMany.mockResolvedValue([]);
		await listPlaybookRuns("pb1");
		expect(mocks.findMany).toHaveBeenCalledWith(
			expect.objectContaining({ where: { playbookId: "pb1" }, take: 50 }),
		);
	});

	it("runPlaybook rejects when playbook is missing", async () => {
		mocks.findUnique.mockResolvedValue(null);
		await expect(
			runPlaybook({ playbookId: "missing", dryRun: true }),
		).rejects.toThrow(/playbook not found/);
	});

	it("runPlaybook rejects when playbook is disabled", async () => {
		mocks.findUnique.mockResolvedValue({ ...baseRow, enabled: false });
		await expect(
			runPlaybook({ playbookId: "pb1", dryRun: false }),
		).rejects.toThrow(/disabled/);
	});

	it("runPlaybook writes a PlaybookRun with status=running then completed", async () => {
		mocks.findUnique.mockResolvedValue(baseRow);
		mocks.create
			.mockResolvedValueOnce({ id: "run-1", playbookId: "pb1", status: "running", dryRun: true, stepResults: [], errorMessage: null, startedAt: new Date(), completedAt: null, createdById: null, createdAt: new Date(), updatedAt: new Date(), triggerContext: null })
			.mockResolvedValueOnce({ id: "run-1-final", playbookId: "pb1", status: "completed", dryRun: true, stepResults: [], errorMessage: null, startedAt: new Date(), completedAt: new Date(), createdById: null, createdAt: new Date(), updatedAt: new Date(), triggerContext: null });
		mocks.executePlaybookChain.mockResolvedValue({ results: [
			{ stepId: "s1", status: "dry_run", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z", summary: "ok" },
		] });
		mocks.update.mockResolvedValue({
			id: "run-1-final",
			playbookId: "pb1",
			status: "completed",
			dryRun: true,
			stepResults: [],
			errorMessage: null,
			startedAt: new Date(),
			completedAt: new Date(),
			createdById: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			triggerContext: null,
		});
		const run = await runPlaybook({ playbookId: "pb1", dryRun: true, createdById: "u1" });
		expect(run.status).toBe("completed");
		expect(mocks.executePlaybookChain).toHaveBeenCalledWith({
			playbook: expect.objectContaining({ id: "pb1" }),
			runId: "run-1",
			dryRun: true,
		});
		expect(mocks.auditUserAction).toHaveBeenCalledWith(
			"u1",
			"playbook.run",
			expect.objectContaining({ playbookId: "pb1", runId: "run-1", dryRun: true, status: "completed" }),
		);
	});

	it("runPlaybook marks status=failed when a step fails", async () => {
		mocks.findUnique.mockResolvedValue(baseRow);
		mocks.create.mockResolvedValueOnce({
			id: "run-2",
			playbookId: "pb1",
			status: "running",
			dryRun: false,
			stepResults: [],
			errorMessage: null,
			startedAt: new Date(),
			completedAt: null,
			createdById: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			triggerContext: null,
		});
		mocks.executePlaybookChain.mockResolvedValue({ results: [
			{ stepId: "s1", status: "failed", startedAt: "2026-01-01T00:00:00Z", completedAt: "2026-01-01T00:00:01Z", summary: "", error: "boom" },
		] });
		mocks.update.mockResolvedValue({
			id: "run-2",
			playbookId: "pb1",
			status: "failed",
			dryRun: false,
			stepResults: [],
			errorMessage: "boom",
			startedAt: new Date(),
			completedAt: new Date(),
			createdById: null,
			createdAt: new Date(),
			updatedAt: new Date(),
			triggerContext: null,
		});
		const run = await runPlaybook({ playbookId: "pb1", dryRun: false, createdById: "u1" });
		expect(run.status).toBe("failed");
		// The update call's `where.id` comes from the auto-created run row; we
		// only assert the data payload here.
		expect(mocks.update).toHaveBeenCalledWith(
			expect.objectContaining({
				data: expect.objectContaining({ status: "failed", errorMessage: "boom" }),
			}),
		);
	});
});
