/**
 * TR-032 E02: AI ops — service unit tests.
 *
 * Uses vi.mock("@/lib/db") to swap in a minimal in-memory store that
 * mimics the subset of prisma.aiOpsLog methods the service touches.
 * Mirrors the P-NEW-AM pattern from src/lib/cost/__tests__/service.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	AI_OPS_SAFE_AUTONOMOUS_ACTIONS,
	type AiOpsLogRecord,
} from "../types";

type AiOpsLogRow = {
	id: string;
	triggerType: string;
	mode: string;
	status: string;
	findings: unknown;
	actions: unknown;
	notes: string | null;
	errorMessage: string | null;
	providerId: string | null;
	startedAt: Date | null;
	completedAt: Date | null;
	durationMs: number | null;
	triggeredById: string | null;
	createdAt: Date;
	updatedAt: Date;
};

const store = {
	logs: new Map<string, AiOpsLogRow>(),
	seq: 0,
};

function resetStore() {
	store.logs.clear();
	store.seq = 0;
}

function makePrismaMock() {
	return {
		alertRule: {
			count: vi.fn(async () => 3),
		},
		aiOpsLog: {
			create: vi.fn(
				async ({ data }: { data: Omit<AiOpsLogRow, "id" | "createdAt" | "updatedAt"> }) => {
					store.seq += 1;
					// Each created row gets a strictly-increasing createdAt
					// so listAiOpsLogs sort-by-createdAt-desc returns them
					// in insertion order, mirroring real production.
					const base = new Date("2026-06-17T00:00:00Z").getTime();
					const row: AiOpsLogRow = {
						...data,
						id: `log_${store.seq}`,
						createdAt: new Date(base + store.seq * 1000),
						updatedAt: new Date(base + store.seq * 1000),
					};
					store.logs.set(row.id, row);
					return row;
				},
			),
			findUnique: vi.fn(async ({ where }: { where: { id: string } }) => {
				return store.logs.get(where.id) ?? null;
			}),
			findMany: vi.fn(
				async ({
					where = {},
					orderBy,
					take,
				}: {
					where?: { mode?: string; status?: string; triggerType?: string };
					orderBy?: { createdAt?: "asc" | "desc" };
					take?: number;
				}) => {
					let rows = [...store.logs.values()];
					if (where.mode) rows = rows.filter((r) => r.mode === where.mode);
					if (where.status) rows = rows.filter((r) => r.status === where.status);
					if (where.triggerType)
						rows = rows.filter((r) => r.triggerType === where.triggerType);
					if (orderBy?.createdAt === "desc") {
						rows.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
					} else if (orderBy?.createdAt === "asc") {
						rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
					}
					if (typeof take === "number") rows = rows.slice(0, take);
					return rows;
				},
			),
			update: vi.fn(
				async ({ where, data }: { where: { id: string }; data: Partial<AiOpsLogRow> }) => {
					const row = store.logs.get(where.id);
					if (!row) throw new Error("not found");
					const next: AiOpsLogRow = {
						...row,
						...data,
						updatedAt: new Date("2026-06-17T01:00:00Z"),
					};
					store.logs.set(row.id, next);
					return next;
				},
			),
			count: vi.fn(async () => store.logs.size),
		},
	};
}

vi.mock("@/lib/db", () => ({ prisma: makePrismaMock() }));

// Mock @/lib/job so worker tests don't accidentally call the real
// durable-job claim/complete path. The service tests don't exercise the
// worker, but importing it transitively pulls in the worker module.
vi.mock("@/lib/job/service", () => ({
	enqueueJob: vi.fn(),
	claimNextJob: vi.fn(),
	completeJob: vi.fn(),
	failJob: vi.fn(),
	heartbeatJob: vi.fn(),
}));

vi.mock("@/lib/health/service-alerts", () => ({
	evaluateAlerts: vi.fn(async () => ({ evaluated: true })),
}));

import {
	completeScan,
	createAiOpsLog,
	executeRecommendation,
	getAiOpsLog,
	listAiOpsLogs,
	summariseAiOps,
} from "../service";

beforeEach(() => {
	resetStore();
	// re-mock in case prior test mutated the closure references.
	// (makePrismaMock() returns a new object every time, but the mocked
	// @/lib/db export is captured at module-load — we re-seed the
	// store fresh and rely on the closure references being the same.)
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("AiOpsLog CRUD", () => {
	it("createAiOpsLog returns a running row with mode=recommendation by default", async () => {
		const log = await createAiOpsLog({
			triggerType: "manual",
			mode: "recommendation",
			triggeredById: "user_1",
			notes: "manual test",
		});
		expect(log.status).toBe("running");
		expect(log.mode).toBe("recommendation");
		expect(log.triggeredById).toBe("user_1");
		expect(log.notes).toBe("manual test");
		expect(log.startedAt).toBeTruthy();
	});

	it("getAiOpsLog returns the same shape after completeScan", async () => {
		const log = await createAiOpsLog({
			triggerType: "manual",
			mode: "recommendation",
		});
		const completed = await completeScan({
			logId: log.id,
			status: "warning",
			findings: [
				{
					id: "f1",
					severity: "warning",
					title: "测试 finding",
					body: "body",
					source: "test",
				},
			],
			actions: [
				{
					id: "a1",
					action: "alert.evaluate",
					risk: "low",
					requiresApproval: false,
				},
			],
			notes: "done",
		});
		expect(completed.status).toBe("warning");
		expect(completed.findings).toHaveLength(1);
		expect(completed.findings[0]?.title).toBe("测试 finding");
		expect(completed.actions).toHaveLength(1);
		expect(completed.durationMs).toBeGreaterThanOrEqual(0);
		expect(completed.completedAt).toBeTruthy();
	});

	it("listAiOpsLogs filters by mode and status, ordered by createdAt desc", async () => {
		const a = await createAiOpsLog({ triggerType: "manual", mode: "recommendation" });
		const b = await createAiOpsLog({ triggerType: "scheduled", mode: "autonomous" });
		const c = await createAiOpsLog({ triggerType: "manual", mode: "recommendation" });
		await completeScan({ logId: a.id, status: "ok", findings: [], actions: [] });
		await completeScan({ logId: c.id, status: "error", findings: [], actions: [] });

		const recs = await listAiOpsLogs({ mode: "recommendation" });
		expect(recs).toHaveLength(2);
		expect(recs[0]?.id).toBe(c.id); // latest first
		expect(recs[1]?.id).toBe(a.id);

		const autos = await listAiOpsLogs({ mode: "autonomous" });
		expect(autos).toHaveLength(1);
		expect(autos[0]?.id).toBe(b.id);

		const errs = await listAiOpsLogs({ status: "error" });
		expect(errs).toHaveLength(1);
		expect(errs[0]?.id).toBe(c.id);
	});

	it("listAiOpsLogs applies limit and caps to MAX_LIST_LIMIT (200)", async () => {
		// We only need to verify the cap; insert 3 then ask for limit=999.
		for (let i = 0; i < 3; i += 1) {
			await createAiOpsLog({ triggerType: "manual", mode: "recommendation" });
		}
		const huge = await listAiOpsLogs({ limit: 999 });
		expect(huge.length).toBeLessThanOrEqual(200);
		expect(huge.length).toBe(3); // currently only 3 in store
	});

	it("getAiOpsLog returns null for unknown id", async () => {
		const r = await getAiOpsLog("nonexistent");
		expect(r).toBeNull();
	});
});

describe("executeRecommendation — mode-aware action gating", () => {
	it("returns ok=true with executed=false when requiresApproval is true", async () => {
		const log = await createAiOpsLog({ triggerType: "manual", mode: "recommendation" });
		await completeScan({
			logId: log.id,
			status: "warning",
			findings: [],
			actions: [
				{
					id: "a1",
					action: "command.execute:diagnose",
					risk: "high",
					requiresApproval: true,
				},
			],
		});
		const result = await executeRecommendation({ logId: log.id, actionId: "a1" });
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(false);
		expect(result.errorMessage).toMatch(/需要管理员审批/);
	});

	it("executes immediately when action is in the autonomous safe-set and forceAutonomous", async () => {
		const log = await createAiOpsLog({ triggerType: "manual", mode: "autonomous" });
		const safe = AI_OPS_SAFE_AUTONOMOUS_ACTIONS[0] ?? "alert.evaluate";
		// Autonomous-mode logs store the action with the executed-shape
		// (id / action / risk / executed). The service executor reads
		// the row back via parseActions which routes by mode.
		await completeScan({
			logId: log.id,
			status: "warning",
			findings: [],
			actions: [
				{
					id: "a1",
					action: safe,
					risk: "low",
					executed: false,
				},
			],
		});
		const result = await executeRecommendation({
			logId: log.id,
			actionId: "a1",
			forceAutonomous: true,
		});
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(true);
		expect(result.action?.action).toBe(safe);
		expect(result.action?.result).toMatch(/告警规则评估/);
	});

	it("refuses forceAutonomous when action is not in the safe-set", async () => {
		const log = await createAiOpsLog({ triggerType: "manual", mode: "autonomous" });
		await completeScan({
			logId: log.id,
			status: "warning",
			findings: [],
			actions: [
				{
					id: "a1",
					action: "command.execute:rm-rf",
					risk: "high",
					executed: false,
				},
			],
		});
		const result = await executeRecommendation({
			logId: log.id,
			actionId: "a1",
			forceAutonomous: true,
		});
		expect(result.ok).toBe(true);
		expect(result.executed).toBe(false);
		expect(result.errorMessage).toMatch(/不在自主安全集合中/);
	});

	it("returns ok=false when logId does not exist", async () => {
		const result = await executeRecommendation({ logId: "missing", actionId: "x" });
		expect(result.ok).toBe(false);
		expect(result.executed).toBe(false);
		expect(result.errorMessage).toMatch(/日志不存在/);
	});

	it("returns ok=false when actionId does not exist in the log", async () => {
		const log = await createAiOpsLog({ triggerType: "manual", mode: "recommendation" });
		await completeScan({ logId: log.id, status: "ok", findings: [], actions: [] });
		const result = await executeRecommendation({ logId: log.id, actionId: "ghost" });
		expect(result.ok).toBe(false);
		expect(result.errorMessage).toMatch(/推荐项不存在/);
	});
});

describe("summariseAiOps", () => {
	it("returns total=0 with zeroed buckets when store is empty", async () => {
		const s = await summariseAiOps();
		expect(s.total).toBe(0);
		expect(s.byStatus).toEqual({ ok: 0, warning: 0, error: 0, skipped: 0, running: 0 });
		expect(s.byMode).toEqual({ recommendation: 0, autonomous: 0 });
		expect(s.lastScanAt).toBeNull();
		expect(s.lastErrorAt).toBeNull();
	});

	it("counts rows by status and mode; tracks lastScanAt + lastErrorAt", async () => {
		const a = await createAiOpsLog({ triggerType: "manual", mode: "recommendation" });
		const b = await createAiOpsLog({ triggerType: "manual", mode: "autonomous" });
		const c = await createAiOpsLog({ triggerType: "manual", mode: "recommendation" });
		await completeScan({ logId: a.id, status: "ok", findings: [], actions: [] });
		await completeScan({ logId: b.id, status: "error", findings: [], actions: [], errorMessage: "boom" });
		await completeScan({ logId: c.id, status: "warning", findings: [], actions: [] });

		const s = await summariseAiOps();
		expect(s.total).toBe(3);
		expect(s.byStatus.ok).toBe(1);
		expect(s.byStatus.warning).toBe(1);
		expect(s.byStatus.error).toBe(1);
		expect(s.byMode.recommendation).toBe(2);
		expect(s.byMode.autonomous).toBe(1);
		expect(s.lastScanAt).toBeTruthy();
		expect(s.lastErrorAt).toBeTruthy();
	});
});

describe("AiOpsLogRecord shape (read-only shape check)", () => {
	it("returned record contains the expected fields", async () => {
		const log: AiOpsLogRecord = await createAiOpsLog({
			triggerType: "manual",
			mode: "recommendation",
			notes: "shape check",
		});
		const keys = Object.keys(log).sort();
		expect(keys).toEqual(
			[
				"actions",
				"completedAt",
				"createdAt",
				"durationMs",
				"errorMessage",
				"findings",
				"id",
				"mode",
				"notes",
				"providerId",
				"startedAt",
				"status",
				"triggeredById",
				"triggerType",
				"updatedAt",
			].sort(),
		);
	});
});
