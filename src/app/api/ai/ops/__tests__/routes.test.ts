/**
 * TR-032 E02: /api/ai/ops/* route tests.
 *
 * Covers:
 *   - GET  /api/ai/ops/logs              (ai:ops:read, with filter+limit)
 *   - GET  /api/ai/ops/logs/[id]         (ai:ops:read, 404 on missing)
 *   - POST /api/ai/ops/scan              (ai:ops:manage, audit+latest log)
 *   - POST /api/ai/ops/logs/[id]/execute (ai:ops:manage + ai:ops:autonomous gate)
 *   - GET  /api/ai/ops/summary           (ai:ops:read)
 *   - GET  /api/ai/ops/settings          (ai:ops:read, default mode)
 *
 * All handlers are tested against mocked service + scan-worker +
 * requireApiPermission, following the M04 playbook + E01 cost route
 * test pattern. NB: `requireApiPermission` is the auth gate, and the
 * `requireSession` shortcut inside the gate is bypassed because the
 * mock resolves straight to a session object.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

const { mocks } = vi.hoisted(() => ({
	mocks: {
		requireApiPermission: vi.fn(),
		listAiOpsLogs: vi.fn(),
		getAiOpsLog: vi.fn(),
		summariseAiOps: vi.fn(),
		executeRecommendation: vi.fn(),
		runAiOpsScanWorkerOnce: vi.fn(),
		auditUserAction: vi.fn(),
		sessionHasPermission: vi.fn(),
		getSetting: vi.fn(),
		setSetting: vi.fn(),
	},
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
	requireApiPermission: mocks.requireApiPermission,
}));

vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: mocks.sessionHasPermission,
}));

vi.mock("@/lib/ai/ops/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/ai/ops/service")>();
	return {
		...actual,
		listAiOpsLogs: mocks.listAiOpsLogs,
		getAiOpsLog: mocks.getAiOpsLog,
		summariseAiOps: mocks.summariseAiOps,
		executeRecommendation: mocks.executeRecommendation,
	};
});

vi.mock("@/lib/ai/ops/scan-worker", () => ({
	runAiOpsScanWorkerOnce: mocks.runAiOpsScanWorkerOnce,
}));

vi.mock("@/lib/audit/service", () => ({
	auditUserAction: mocks.auditUserAction,
}));

vi.mock("@/lib/settings/service", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/settings/service")>();
	return {
		...actual,
		getSetting: mocks.getSetting,
		setSetting: mocks.setSetting,
	};
});

// Load all routes under test once; vi.hoisted ordering keeps the mocks
// bound before the dynamic import resolves.
const logsRoute = await import("../logs/route");
const logIdRoute = await import("../logs/[id]/route");
const scanRoute = await import("../scan/route");
const executeRoute = await import("../logs/[id]/execute/route");
const summaryRoute = await import("../summary/route");
const settingsRoute = await import("../settings/route");

const adminSession = { userId: "u-admin", username: "admin", user: { id: "u-admin" }, roles: ["admin"] as const };

const SAMPLE_LOG = {
	id: "log-1",
	triggerType: "manual",
	mode: "recommendation",
	status: "ok",
	findings: [],
	actions: [],
	notes: null,
	errorMessage: null,
	providerId: null,
	startedAt: "2026-06-17T10:00:00.000Z",
	completedAt: "2026-06-17T10:00:05.000Z",
	durationMs: 5000,
	triggeredById: "u-admin",
	createdAt: "2026-06-17T10:00:00.000Z",
	updatedAt: "2026-06-17T10:00:05.000Z",
};

const SAMPLE_SUMMARY = {
	total: 7,
	byStatus: { ok: 5, warning: 1, error: 0, skipped: 0, running: 1 },
	byMode: { recommendation: 6, autonomous: 1 },
	lastScanAt: "2026-06-17T10:00:00.000Z",
	lastErrorAt: null,
};

describe("/api/ai/ops/* routes", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.requireApiPermission.mockResolvedValue({ session: adminSession });
		mocks.listAiOpsLogs.mockResolvedValue([SAMPLE_LOG]);
		mocks.getAiOpsLog.mockResolvedValue(SAMPLE_LOG);
		mocks.summariseAiOps.mockResolvedValue(SAMPLE_SUMMARY);
		mocks.executeRecommendation.mockResolvedValue({ ok: true, executed: false, errorMessage: "需要管理员审批" });
		mocks.runAiOpsScanWorkerOnce.mockResolvedValue(true);
		mocks.sessionHasPermission.mockReturnValue(true);
		mocks.getSetting.mockImplementation(async (key: string) => {
			if (key === "ai.ops.mode") return "recommendation";
			if (key === "ai.ops.provider") return "";
			return "";
		});
		mocks.setSetting.mockResolvedValue(undefined);
	});

	// ── GET /api/ai/ops/logs ────────────────────────────────────────────
	describe("GET /api/ai/ops/logs", () => {
		it("requires ai:ops:read and forwards the filters to the service", async () => {
			const res = await logsRoute.GET(
				new Request("http://local/api/ai/ops/logs?mode=autonomous&status=warning&triggerType=manual&limit=10"),
			);
			expect(res.status).toBe(200);
			expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:ops:read");
			expect(mocks.listAiOpsLogs).toHaveBeenCalledWith({
				mode: "autonomous",
				status: "warning",
				triggerType: "manual",
				limit: 10,
			});
			const body = await res.json();
			expect(body.logs).toEqual([SAMPLE_LOG]);
		});

		it("returns 400 when mode is invalid", async () => {
			const res = await logsRoute.GET(new Request("http://local/api/ai/ops/logs?mode=bogus"));
			expect(res.status).toBe(400);
			expect(mocks.listAiOpsLogs).not.toHaveBeenCalled();
		});

		it("returns 403 when the caller lacks ai:ops:read", async () => {
			mocks.requireApiPermission.mockResolvedValueOnce(
				NextResponse.json({ error: "缺少权限" }, { status: 403 }),
			);
			const res = await logsRoute.GET(new Request("http://local/api/ai/ops/logs"));
			expect(res.status).toBe(403);
			expect(mocks.listAiOpsLogs).not.toHaveBeenCalled();
		});
	});

	// ── GET /api/ai/ops/logs/[id] ───────────────────────────────────────
	describe("GET /api/ai/ops/logs/[id]", () => {
		it("returns the requested log when present", async () => {
			const res = await logIdRoute.GET(
				new Request("http://local/api/ai/ops/logs/log-1"),
				{ params: Promise.resolve({ id: "log-1" }) },
			);
			expect(res.status).toBe(200);
			expect(mocks.getAiOpsLog).toHaveBeenCalledWith("log-1");
			const body = await res.json();
			expect(body.log).toEqual(SAMPLE_LOG);
		});

		it("returns 404 when the log is missing", async () => {
			mocks.getAiOpsLog.mockResolvedValueOnce(null);
			const res = await logIdRoute.GET(
				new Request("http://local/api/ai/ops/logs/missing"),
				{ params: Promise.resolve({ id: "missing" }) },
			);
			expect(res.status).toBe(404);
		});
	});

	// ── POST /api/ai/ops/scan ───────────────────────────────────────────
	describe("POST /api/ai/ops/scan", () => {
		it("triggers a manual scan, audits the action, and returns the latest log", async () => {
			const res = await scanRoute.POST(
				new Request("http://local/api/ai/ops/scan", {
					method: "POST",
					body: JSON.stringify({ notes: "investigate" }),
				}),
			);
			expect(res.status).toBe(200);
			expect(mocks.runAiOpsScanWorkerOnce).toHaveBeenCalledWith("manual");
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u-admin",
				"ai.ops.scan.manual",
				expect.objectContaining({ triggered: true, logId: "log-1", notes: "investigate" }),
			);
			const body = await res.json();
			expect(body.triggered).toBe(true);
			expect(body.latestLog).toEqual(SAMPLE_LOG);
		});

		it("returns triggered=false when the worker skipped the run", async () => {
			mocks.runAiOpsScanWorkerOnce.mockResolvedValueOnce(false);
			const res = await scanRoute.POST(
				new Request("http://local/api/ai/ops/scan", { method: "POST", body: "{}" }),
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.triggered).toBe(false);
		});

		it("rejects body with invalid mode field", async () => {
			const res = await scanRoute.POST(
				new Request("http://local/api/ai/ops/scan", {
					method: "POST",
					body: JSON.stringify({ mode: "garbage" }),
				}),
			);
			expect(res.status).toBe(400);
			expect(mocks.runAiOpsScanWorkerOnce).not.toHaveBeenCalled();
		});
	});

	// ── POST /api/ai/ops/logs/[id]/execute ──────────────────────────────
	describe("POST /api/ai/ops/logs/[id]/execute", () => {
		it("executes the action under ai:ops:manage and records an audit entry", async () => {
			mocks.executeRecommendation.mockResolvedValueOnce({
				ok: true,
				executed: true,
				action: { id: "a-1", action: "alert.evaluate", risk: "low", executed: true, executedAt: "2026-06-17T10:00:00.000Z" },
			});
			const res = await executeRoute.POST(
				new Request("http://local/api/ai/ops/logs/log-1/execute", {
					method: "POST",
					body: JSON.stringify({ actionId: "a-1" }),
				}),
				{ params: Promise.resolve({ id: "log-1" }) },
			);
			expect(res.status).toBe(200);
			expect(mocks.executeRecommendation).toHaveBeenCalledWith({
				logId: "log-1",
				actionId: "a-1",
				forceAutonomous: undefined,
			});
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u-admin",
				"ai.ops.recommendation.execute",
				expect.objectContaining({ logId: "log-1", actionId: "a-1", executed: true }),
			);
		});

		it("blocks forceAutonomous=true when the caller lacks ai:ops:autonomous", async () => {
			mocks.sessionHasPermission.mockReturnValue(false);
			const res = await executeRoute.POST(
				new Request("http://local/api/ai/ops/logs/log-1/execute", {
					method: "POST",
					body: JSON.stringify({ actionId: "a-1", forceAutonomous: true }),
				}),
				{ params: Promise.resolve({ id: "log-1" }) },
			);
			expect(res.status).toBe(403);
			expect(mocks.executeRecommendation).not.toHaveBeenCalled();
		});

		it("passes through service-side refusal messages with ok=true, executed=false", async () => {
			mocks.executeRecommendation.mockResolvedValueOnce({
				ok: true,
				executed: false,
				errorMessage: "需要管理员审批, 不会自动执行",
			});
			const res = await executeRoute.POST(
				new Request("http://local/api/ai/ops/logs/log-1/execute", {
					method: "POST",
					body: JSON.stringify({ actionId: "a-1" }),
				}),
				{ params: Promise.resolve({ id: "log-1" }) },
			);
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.result.executed).toBe(false);
			expect(body.result.errorMessage).toContain("需要管理员审批");
		});
	});

	// ── GET /api/ai/ops/summary ─────────────────────────────────────────
	describe("GET /api/ai/ops/summary", () => {
		it("returns the summary with the right permission gate", async () => {
			const res = await summaryRoute.GET(new Request("http://local/api/ai/ops/summary"));
			expect(res.status).toBe(200);
			expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:ops:read");
			const body = await res.json();
			expect(body.summary).toEqual(SAMPLE_SUMMARY);
		});
	});

	// ── GET /api/ai/ops/settings ────────────────────────────────────────
	describe("GET /api/ai/ops/settings", () => {
		it("returns the default mode + null provider + schedule hour", async () => {
			const res = await settingsRoute.GET(new Request("http://local/api/ai/ops/settings"));
			expect(res.status).toBe(200);
			expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:ops:read");
			const body = await res.json();
			expect(body.mode).toBe("recommendation");
			expect(body.providerId).toBeNull();
			expect(body.scanScheduleHour).toBe(2);
		});

		it("returns the stored provider when one is configured", async () => {
			mocks.getSetting.mockImplementation(async (key: string) => {
				if (key === "ai.ops.mode") return "autonomous";
				if (key === "ai.ops.provider") return "anthropic";
				return "";
			});
			const res = await settingsRoute.GET(new Request("http://local/api/ai/ops/settings"));
			expect(res.status).toBe(200);
			const body = await res.json();
			expect(body.mode).toBe("autonomous");
			expect(body.providerId).toBe("anthropic");
		});
	});

	// ── PATCH /api/ai/ops/settings ──────────────────────────────────────
	describe("PATCH /api/ai/ops/settings", () => {
		it("persists a new mode + provider and writes an audit entry", async () => {
			const res = await settingsRoute.PATCH(
				new Request("http://local/api/ai/ops/settings", {
					method: "PATCH",
					body: JSON.stringify({ mode: "autonomous", providerId: "anthropic" }),
				}),
			);
			expect(res.status).toBe(200);
			expect(mocks.requireApiPermission).toHaveBeenCalledWith("ai:ops:manage");
			expect(mocks.setSetting).toHaveBeenCalledWith("ai.ops.mode", "autonomous");
			expect(mocks.setSetting).toHaveBeenCalledWith("ai.ops.provider", "anthropic");
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u-admin",
				"ai.ops.settings.update",
				expect.objectContaining({
					keys: ["ai.ops.mode", "ai.ops.provider"],
					mode: { from: "recommendation", to: "autonomous" },
					providerId: { from: "", to: "anthropic" },
				}),
			);
			const body = await res.json();
			expect(body.mode).toBe("autonomous");
			expect(body.providerId).toBe("anthropic");
		});

		it("leaves the stored provider untouched when providerId is omitted", async () => {
			mocks.getSetting.mockImplementation(async (key: string) => {
				if (key === "ai.ops.mode") return "recommendation";
				if (key === "ai.ops.provider") return "anthropic";
				return "";
			});
			const res = await settingsRoute.PATCH(
				new Request("http://local/api/ai/ops/settings", {
					method: "PATCH",
					body: JSON.stringify({ mode: "autonomous" }),
				}),
			);
			expect(res.status).toBe(200);
			expect(mocks.setSetting).toHaveBeenCalledWith("ai.ops.mode", "autonomous");
			expect(mocks.setSetting).not.toHaveBeenCalledWith("ai.ops.provider", expect.anything());
			const body = await res.json();
			expect(body.mode).toBe("autonomous");
			expect(body.providerId).toBe("anthropic");
		});

		it("rejects an invalid providerId pattern with 400", async () => {
			const res = await settingsRoute.PATCH(
				new Request("http://local/api/ai/ops/settings", {
					method: "PATCH",
					body: JSON.stringify({ mode: "recommendation", providerId: "bad space!" }),
				}),
			);
			expect(res.status).toBe(400);
			expect(mocks.setSetting).not.toHaveBeenCalled();
		});

		it("rejects an invalid mode value with 400", async () => {
			const res = await settingsRoute.PATCH(
				new Request("http://local/api/ai/ops/settings", {
					method: "PATCH",
					body: JSON.stringify({ mode: "garbage" }),
				}),
			);
			expect(res.status).toBe(400);
			expect(mocks.setSetting).not.toHaveBeenCalled();
		});

		it("accepts an empty providerId to clear the stored value", async () => {
			mocks.getSetting.mockImplementation(async (key: string) => {
				if (key === "ai.ops.mode") return "autonomous";
				if (key === "ai.ops.provider") return "anthropic";
				return "";
			});
			const res = await settingsRoute.PATCH(
				new Request("http://local/api/ai/ops/settings", {
					method: "PATCH",
					body: JSON.stringify({ mode: "recommendation", providerId: "" }),
				}),
			);
			expect(res.status).toBe(200);
			expect(mocks.setSetting).toHaveBeenCalledWith("ai.ops.mode", "recommendation");
			expect(mocks.setSetting).toHaveBeenCalledWith("ai.ops.provider", "");
			const body = await res.json();
			expect(body.providerId).toBeNull();
		});
	});
});
