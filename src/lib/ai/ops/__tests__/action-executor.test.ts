import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for `executeAiOpsAction` — the single place where an AI-ops
 * recommendation turns into a real side effect.
 *
 * The security property is the allow-list, and it is a *second* gate: the
 * service already refuses to auto-execute anything outside the safe set, so this
 * check exists because the `action` string ultimately came from an LLM. The set
 * is closed over two entries (`alert.evaluate`, `cache.purge:stale`) and the
 * `switch` has its own `default` behind it, so even a value added to the
 * constant without an implementation degrades to a recorded refusal rather than
 * a silent no-op reported as success.
 *
 * The second property is that every outcome — refused, succeeded, threw — comes
 * back as an auditable row with `executed` set correctly. A throw escaping this
 * function would abort the whole autonomous scan and lose the record of what had
 * already run.
 */
const mocks = vi.hoisted(() => ({
	alertRuleCount: vi.fn(),
	jobFindMany: vi.fn(),
	aiOpsLogFindMany: vi.fn(),
	aiOpsLogDeleteMany: vi.fn(),
	evaluateAlerts: vi.fn(),
	pruneCompletedJobsByType: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: {
		alertRule: { count: mocks.alertRuleCount },
		job: { findMany: mocks.jobFindMany },
		aiOpsLog: { findMany: mocks.aiOpsLogFindMany, deleteMany: mocks.aiOpsLogDeleteMany },
	},
}));
vi.mock("@/lib/health/service-alerts", () => ({ evaluateAlerts: mocks.evaluateAlerts }));
vi.mock("@/lib/job/service", () => ({ pruneCompletedJobsByType: mocks.pruneCompletedJobsByType }));

import { executeAiOpsAction } from "../action-executor";
import { AI_OPS_LOG_RETENTION_KEEP, AI_OPS_SAFE_AUTONOMOUS_ACTIONS } from "../types";

function input(action: string, risk: "low" | "medium" | "high" = "low") {
	return { id: "a-1", action, risk };
}

describe("executeAiOpsAction", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		for (const m of Object.values(mocks)) m.mockReset();
		mocks.alertRuleCount.mockResolvedValue(3);
		mocks.evaluateAlerts.mockResolvedValue(undefined);
		mocks.jobFindMany.mockResolvedValue([]);
		mocks.aiOpsLogFindMany.mockResolvedValue([]);
		mocks.aiOpsLogDeleteMany.mockResolvedValue({ count: 0 });
		mocks.pruneCompletedJobsByType.mockResolvedValue({ count: 0 });
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
			const result = await executeAiOpsAction(input(action));
			expect(result.executed).toBe(false);
			expect(result.errorMessage).toContain("not in the autonomous safe set");
			expect(mocks.evaluateAlerts).not.toHaveBeenCalled();
			expect(mocks.pruneCompletedJobsByType).not.toHaveBeenCalled();
			expect(mocks.aiOpsLogDeleteMany).not.toHaveBeenCalled();
		});

		it("has an implementation for every action in the safe set", async () => {
			// A constant entry with no `case` would fall to `default` — refused, but
			// silently, so the recommendation would look permanently broken.
			for (const action of AI_OPS_SAFE_AUTONOMOUS_ACTIONS) {
				const result = await executeAiOpsAction(input(action));
				expect(result.errorMessage ?? "").not.toContain("Unknown safe action");
			}
		});

		it("echoes the id and risk back on a refusal so the row stays auditable", async () => {
			const result = await executeAiOpsAction({ id: "a-9", action: "nope", risk: "high" });
			expect(result).toMatchObject({ id: "a-9", action: "nope", risk: "high", executed: false });
			expect(Date.parse(result.executedAt!)).not.toBeNaN();
		});
	});

	describe("alert.evaluate", () => {
		it("runs the evaluation and reports the enabled rule count", async () => {
			const result = await executeAiOpsAction(input("alert.evaluate"));
			expect(mocks.evaluateAlerts).toHaveBeenCalledTimes(1);
			expect(result.executed).toBe(true);
			expect(result.result).toContain("enabled rules: 3");
		});

		it("still executes when the pre-count query fails", async () => {
			// The count is decoration; losing it must not skip the evaluation.
			mocks.alertRuleCount.mockRejectedValue(new Error("db down"));
			const result = await executeAiOpsAction(input("alert.evaluate"));
			expect(mocks.evaluateAlerts).toHaveBeenCalledTimes(1);
			expect(result.executed).toBe(true);
			expect(result.result).not.toContain("enabled rules");
		});

		it("reports executed:false with the message when evaluation throws", async () => {
			mocks.evaluateAlerts.mockRejectedValue(new Error("smtp unreachable"));
			const result = await executeAiOpsAction(input("alert.evaluate"));
			expect(result.executed).toBe(false);
			expect(result.errorMessage).toBe("smtp unreachable");
		});

		it("stringifies a non-Error throw rather than losing it", async () => {
			mocks.evaluateAlerts.mockRejectedValue("plain string failure");
			const result = await executeAiOpsAction(input("alert.evaluate"));
			expect(result.executed).toBe(false);
			expect(result.errorMessage).toBe("plain string failure");
		});
	});

	describe("cache.purge:stale", () => {
		it("prunes each job type separately and sums the counts", async () => {
			// Per-type, not global: a single "keep latest 25" across all types would
			// let one high-frequency type consume the whole quota and delete every
			// record of the quiet ones.
			mocks.jobFindMany.mockResolvedValue([{ type: "alert.evaluate" }, { type: "backup.run" }]);
			mocks.pruneCompletedJobsByType
				.mockResolvedValueOnce({ count: 4 })
				.mockResolvedValueOnce({ count: 6 });
			const result = await executeAiOpsAction(input("cache.purge:stale"));
			expect(mocks.pruneCompletedJobsByType).toHaveBeenNthCalledWith(1, { type: "alert.evaluate", keepLatest: 25 });
			expect(mocks.pruneCompletedJobsByType).toHaveBeenNthCalledWith(2, { type: "backup.run", keepLatest: 25 });
			expect(result.executed).toBe(true);
			expect(result.result).toContain("10");
		});

		it("enumerates distinct types with no take cap so every type is prune-eligible", async () => {
			await executeAiOpsAction(input("cache.purge:stale"));
			const call = mocks.jobFindMany.mock.calls[0]![0] as Record<string, unknown>;
			expect(call.distinct).toEqual(["type"]);
			expect(call).not.toHaveProperty("take");
		});

		it("keeps going when one type's prune fails", async () => {
			mocks.jobFindMany.mockResolvedValue([{ type: "a" }, { type: "b" }]);
			mocks.pruneCompletedJobsByType
				.mockRejectedValueOnce(new Error("deadlock"))
				.mockResolvedValueOnce({ count: 2 });
			const result = await executeAiOpsAction(input("cache.purge:stale"));
			expect(result.executed).toBe(true);
			expect(result.result).toContain("2");
		});

		it("deletes ops logs outside the retention window", async () => {
			mocks.aiOpsLogFindMany.mockResolvedValue([{ id: "l1" }, { id: "l2" }]);
			mocks.aiOpsLogDeleteMany.mockResolvedValue({ count: 7 });
			const result = await executeAiOpsAction(input("cache.purge:stale"));
			expect(mocks.aiOpsLogFindMany).toHaveBeenCalledWith(
				expect.objectContaining({ orderBy: { createdAt: "desc" }, take: AI_OPS_LOG_RETENTION_KEEP }),
			);
			expect(mocks.aiOpsLogDeleteMany).toHaveBeenCalledWith({ where: { id: { notIn: ["l1", "l2"] } } });
			expect(result.result).toContain("7");
		});

		it("does not issue an unbounded delete when the keep query returns nothing", async () => {
			// `notIn: []` matches every row — the guard is the `length > 0` check, so
			// an empty keep-set must skip the delete entirely rather than wipe the
			// whole table.
			mocks.aiOpsLogFindMany.mockResolvedValue([]);
			await executeAiOpsAction(input("cache.purge:stale"));
			expect(mocks.aiOpsLogDeleteMany).not.toHaveBeenCalled();
		});

		it("reports zero pruned rather than failing when nothing is eligible", async () => {
			const result = await executeAiOpsAction(input("cache.purge:stale"));
			expect(result.executed).toBe(true);
			expect(result.result).toContain("0");
		});
	});
});
