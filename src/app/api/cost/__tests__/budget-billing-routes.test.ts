import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotFoundError } from "@/lib/errors";
import { customerSession, routeSession } from "@/test/route-session-mock";

vi.mock("@/lib/auth/api-session", async () => {
	const { NextResponse } = await import("next/server");
	const unauthenticated = () => NextResponse.json({ error: "unauthenticated" }, { status: 401 });
	return {
		getApiSession: vi.fn(async () => routeSession.current),
		requireApiSession: vi.fn(async () => routeSession.current ?? unauthenticated()),
		isSessionPayload: (value: unknown) => !(value instanceof Response),
	};
});
vi.mock("@/lib/http/rate-limit-presets", () => ({
	GENERAL_WRITE_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	GENERAL_READ_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	AGENT_POLL_LIMIT: { maxRequests: 1000, windowMs: 60_000 },
	withRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
	rateLimitResponse: vi.fn(() => new Response("rate limited", { status: 429 })),
}));

const mocks = vi.hoisted(() => ({ updateCostBudget: vi.fn(), deleteCostBudget: vi.fn(), checkBudgetAlerts: vi.fn(), syncCloudBillingAccount: vi.fn(), auditUserAction: vi.fn() }));
vi.mock("@/lib/cost/service", () => ({ updateCostBudget: mocks.updateCostBudget, deleteCostBudget: mocks.deleteCostBudget, checkBudgetAlerts: mocks.checkBudgetAlerts }));
vi.mock("@/lib/cost/cloud-billing/service", () => ({ syncCloudBillingAccount: mocks.syncCloudBillingAccount }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

const budget = await import("../budgets/[id]/route");
const check = await import("../budgets/check/route");
const sync = await import("../billing-accounts/[id]/sync/route");
const req = (method: string, url: string, body?: unknown) =>
	new Request(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
const params = Promise.resolve({ id: "b_1" });

describe("cost budget and billing routes (cost:manage)", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		routeSession.current = customerSession(["cost:manage"]);
		mocks.updateCostBudget.mockResolvedValue({ id: "b_1", name: "Infra" });
		mocks.checkBudgetAlerts.mockResolvedValue({ checked: 2, triggered: 1, notificationsSent: 1 });
		mocks.syncCloudBillingAccount.mockResolvedValue({ run: { month: "2026-10", status: "SUCCESS" }, imported: 3, skipped: 0 });
	});

	it("cost:read is not enough for any of them", async () => {
		routeSession.current = customerSession(["cost:read"]);
		expect((await budget.PATCH(req("PATCH", "http://local/api/cost/budgets/b_1", { name: "x" }), { params })).status).toBe(403);
		expect((await budget.DELETE(req("DELETE", "http://local/api/cost/budgets/b_1"), { params })).status).toBe(403);
		expect((await check.POST(req("POST", "http://local/api/cost/budgets/check"))).status).toBe(403);
		expect((await sync.POST(req("POST", "http://local/api/cost/billing-accounts/b_1/sync", {}), { params })).status).toBe(403);
	});

	it("updates and deletes a budget inside the caller's scope with audit rows", async () => {
		expect((await budget.PATCH(req("PATCH", "http://local/api/cost/budgets/b_1", { name: "Infra" }), { params })).status).toBe(200);
		expect(mocks.updateCostBudget).toHaveBeenCalledWith("b_1", { name: "Infra" }, expect.objectContaining({ currentTeamId: "team_1" }));
		expect((await budget.PATCH(req("PATCH", "http://local/api/cost/budgets/b_1", {}), { params })).status).toBe(400);
		expect((await budget.DELETE(req("DELETE", "http://local/api/cost/budgets/b_1"), { params })).status).toBe(200);
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "cost.budget.delete", { budgetId: "b_1" }, "WARNING", "team_1");
		mocks.deleteCostBudget.mockRejectedValueOnce(new NotFoundError("gone"));
		expect((await budget.DELETE(req("DELETE", "http://local/api/cost/budgets/b_1"), { params })).status).toBe(404);
	});

	it("evaluates budgets for the caller's tenant only and syncs a billing account for a month", async () => {
		const res = await check.POST(req("POST", "http://local/api/cost/budgets/check"));
		expect(await res.json()).toEqual({ result: { checked: 2, triggered: 1, notificationsSent: 1 } });
		expect(mocks.checkBudgetAlerts).toHaveBeenCalledWith(expect.any(Date), expect.objectContaining({ currentTeamId: "team_1" }));

		const synced = await sync.POST(req("POST", "http://local/api/cost/billing-accounts/b_1/sync", { month: "2026-10" }), { params });
		expect(synced.status).toBe(200);
		expect(mocks.syncCloudBillingAccount).toHaveBeenCalledWith("b_1", "2026-10", expect.objectContaining({ currentTeamId: "team_1" }));
		expect(mocks.auditUserAction).toHaveBeenCalledWith("u_cust", "cost.billing_account.sync", expect.objectContaining({ accountId: "b_1", month: "2026-10", imported: 3 }), undefined, "team_1");
		expect((await sync.POST(req("POST", "http://local/api/cost/billing-accounts/b_1/sync", { month: "2026-13" }), { params })).status).toBe(400);
	});
});
