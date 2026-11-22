import type { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LeaseLostError } from "@/lib/job/heartbeat-runner";
import { executeAiOpsAction, executeScanAction } from "../action-executor";
import { pruneAiOpsLogs } from "../retention";
import { AI_OPS_LOG_RETENTION_KEEP, AI_OPS_SAFE_AUTONOMOUS_ACTIONS } from "../types";

const mocks = vi.hoisted(() => ({
	enqueueJob: vi.fn(), jobFindMany: vi.fn(), jobDeleteMany: vi.fn(),
	aiOpsLogFindMany: vi.fn(), aiOpsLogDeleteMany: vi.fn(),
	lease: vi.fn(), receipt: vi.fn(), saveReceipt: vi.fn(),
}));
vi.mock("@/lib/job/service", () => ({ enqueueJob: mocks.enqueueJob }));
vi.mock("@/lib/db", () => {
	const client = {
		job: { findMany: mocks.jobFindMany, deleteMany: mocks.jobDeleteMany, findUniqueOrThrow: mocks.receipt, update: mocks.saveReceipt },
		aiOpsLog: { findMany: mocks.aiOpsLogFindMany, deleteMany: mocks.aiOpsLogDeleteMany },
		$queryRaw: mocks.lease, $executeRaw: vi.fn(),
		setting: { findMany: vi.fn(async () => [{ key: "ai.ops.mode", value: "autonomous" }]) },
	};
	return { prisma: { ...client, $transaction: (run: (db: typeof client) => unknown) => run(client) } };
});
const tx = { $executeRaw: mocks.jobDeleteMany } as unknown as Prisma.TransactionClient;
const check = vi.fn(async () => undefined);
const input = (action: string) => ({ id: "a-1", action, risk: "low" as const });
describe("executeAiOpsAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const m of Object.values(mocks)) m.mockReset();
		mocks.enqueueJob.mockResolvedValue({ id: "alert-job" });
		mocks.jobFindMany.mockResolvedValue([]);
		mocks.aiOpsLogFindMany.mockResolvedValue([]);
		mocks.aiOpsLogDeleteMany.mockResolvedValue({ count: 0 });
		mocks.lease.mockResolvedValue([{ id: "job" }]);
		mocks.receipt.mockResolvedValue({ payload: {} });
	});

	describe("allow-list", () => {
		it.each([
			"rm -rf /",
			"server.delete",
			"command.execute",
			"storage.delete",
			"alert.evaluate; id",
			"ALERT.EVALUATE",
			"",
		])("refuses %s without any side effect", async (action) => {
			const result = await executeAiOpsAction(input(action), tx, check);
			expect(result.executed).toBe(false);
			expect(result.errorMessage).toContain("not in the autonomous safe set");
			expect(mocks.enqueueJob).not.toHaveBeenCalled();
			expect(mocks.jobDeleteMany).not.toHaveBeenCalled();
			expect(mocks.aiOpsLogDeleteMany).not.toHaveBeenCalled();
		});

		it("has an implementation for every action in the safe set", async () => {
			// A constant entry with no `case` would fall to `default` — refused, but
			// silently, so the recommendation would look permanently broken.
			for (const action of AI_OPS_SAFE_AUTONOMOUS_ACTIONS) {
				const result = await executeAiOpsAction(input(action), tx, check);
				expect(result.errorMessage ?? "").not.toContain("Unknown safe action");
			}
		});

		it("echoes the id and risk back on a refusal so the row stays auditable", async () => {
			const result = await executeAiOpsAction({ id: "a-9", action: "nope", risk: "high" }, tx, check);
			expect(result).toMatchObject({ id: "a-9", action: "nope", risk: "high", executed: false });
			expect(Date.parse(result.executedAt!)).not.toBeNaN();
		});
	});

	it("hands evaluation to the heartbeat-managed worker and keeps its job receipt", async () => {
		const result = await executeAiOpsAction(input("alert.evaluate"), tx, check);
		expect(result).toMatchObject({ executed: true, result: expect.stringContaining("alert-job") });
		expect(mocks.enqueueJob).toHaveBeenCalledWith(expect.objectContaining({ type: "alert.evaluate", maxAttempts: 1 }), tx);
	});

	it("checks the exact lease after the receipt lookup and before dispatch", async () => {
		mocks.lease.mockResolvedValueOnce([{ id: "job" }]).mockResolvedValueOnce([]);
		await expect(executeScanAction("job", "owner", 3, input("alert.evaluate"), new AbortController().signal, { providerId: "", binding: "" })).rejects.toBeInstanceOf(LeaseLostError);
		expect(mocks.lease.mock.calls[0]?.slice(1)).toEqual(["job", "owner", 3]);
		expect(mocks.enqueueJob).not.toHaveBeenCalled();
	});

	it("returns the durable result after the worker loses its reply", async () => {
		const action = input("alert.evaluate");
		const result = await executeScanAction("job", "owner", 3, action, new AbortController().signal, { providerId: "", binding: "" });
		mocks.receipt.mockResolvedValue({ payload: { actionReceipts: [result] } });
		expect(await executeScanAction("job", "new-owner", 4, action, new AbortController().signal, { providerId: "", binding: "" })).toEqual(result);
		expect(mocks.enqueueJob).toHaveBeenCalledOnce();
		expect(mocks.receipt.mock.calls[0]).toEqual(mocks.receipt.mock.calls[1]);
	});

	it("deletes only the saved set of old completed jobs", async () => {
		const cleanup = { cutoff: "2026-10-31T00:00:00.000Z", ids: ["old"] };
		mocks.jobDeleteMany.mockResolvedValue(1);
		expect(await executeAiOpsAction({ ...input("cache.purge:stale"), cleanup }, tx, check)).toMatchObject({ executed: true });
		expect(mocks.jobDeleteMany).toHaveBeenCalledOnce();
		expect(check).toHaveBeenCalledOnce();
		expect(mocks.aiOpsLogDeleteMany).not.toHaveBeenCalled();
	});

	it("requires a new scan for a legacy cleanup without a frozen set", async () => {
		expect(await executeAiOpsAction(input("cache.purge:stale"), tx, check)).toMatchObject({ executed: false });
		expect(mocks.jobDeleteMany).not.toHaveBeenCalled();
	});

	describe("independent scheduled report retention", () => {
		it("deletes ops logs outside the retention window", async () => {
			const boundary = { id: "l1", createdAt: new Date() };
			mocks.aiOpsLogFindMany.mockResolvedValue([boundary]);
			mocks.aiOpsLogDeleteMany.mockResolvedValue({ count: 7 });
			const result = await pruneAiOpsLogs();
			expect(mocks.aiOpsLogFindMany).toHaveBeenCalledWith(
				expect.objectContaining({ skip: AI_OPS_LOG_RETENTION_KEEP - 1, take: 1 }),
			);
			expect(mocks.aiOpsLogDeleteMany).toHaveBeenCalledWith({ where: { status: { not: "running" }, OR: [{ createdAt: { lt: boundary.createdAt } }, { createdAt: boundary.createdAt, id: { lt: boundary.id } }] } });
			expect(result.count).toBe(7);
		});

		it("retains a completed report while its job is waiting for acknowledgement", async () => {
			mocks.aiOpsLogFindMany.mockResolvedValue([{ id: "boundary", createdAt: new Date() }]);
			mocks.jobFindMany.mockResolvedValueOnce([{ id: "unacknowledged" }]);
			await pruneAiOpsLogs();
			expect(mocks.jobFindMany).toHaveBeenCalledWith({
				where: { type: "ai.ops.scan", status: { in: ["PENDING", "RUNNING"] } }, select: { id: true },
			});
			expect(mocks.aiOpsLogDeleteMany).toHaveBeenCalledWith({ where: expect.objectContaining({
				AND: [{ OR: [{ jobId: null }, { jobId: { notIn: ["unacknowledged"] } }] }],
			}) });
		});

		it("does not issue an unbounded delete when the keep query returns nothing", async () => {
			// `notIn: []` matches every row — the guard is the `length > 0` check, so
			// an empty keep-set must skip the delete entirely rather than wipe the
			// whole table.
			mocks.aiOpsLogFindMany.mockResolvedValue([]);
			await pruneAiOpsLogs();
			expect(mocks.aiOpsLogDeleteMany).not.toHaveBeenCalled();
		});

		it("reports zero pruned rather than failing when nothing is eligible", async () => {
			const result = await pruneAiOpsLogs();
			expect(result.count).toBe(0);
		});
	});
});
