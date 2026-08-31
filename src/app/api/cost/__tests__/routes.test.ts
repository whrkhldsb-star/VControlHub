import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Contract tests for the six cost routes (3 billing-account, 3 budget).
 *
 * Cloud billing accounts hold encrypted provider credentials, so two properties
 * matter beyond the usual scoping: `teamId` is session-derived and a
 * client-supplied one must be stripped rather than honoured, and the schemas are
 * `.strict()` so an unknown field is a 400 instead of being silently dropped
 * into the stored config. The schemas are kept real for exactly that reason;
 * the service's own team filters are covered by
 * `src/lib/cost/cloud-billing/__tests__/service.test.ts` and
 * `src/lib/cost/__tests__/budget-service.test.ts`.
 */
const mocks = vi.hoisted(() => ({
	billing: {
		listCloudBillingAccounts: vi.fn(),
		createCloudBillingAccount: vi.fn(),
		getCloudBillingAccount: vi.fn(),
		updateCloudBillingAccount: vi.fn(),
		deleteCloudBillingAccount: vi.fn(),
		syncCloudBillingAccount: vi.fn(),
	},
	cost: {
		listCostBudgets: vi.fn(),
		createCostBudget: vi.fn(),
		updateCostBudget: vi.fn(),
		deleteCostBudget: vi.fn(),
		checkBudgetAlerts: vi.fn(),
	},
	auditUserAction: vi.fn(),
	guardCalls: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/cost/cloud-billing/service", () => mocks.billing);
vi.mock("@/lib/cost/service", () => mocks.cost);
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));

vi.mock("@/lib/http/api-guard", () => ({
	withApiRoute: vi.fn(async (request: Request, options: any, handler: any) => {
		mocks.guardCalls.push(options);
		let body: unknown = undefined;
		if (options.bodySchema) {
			const raw = await request.clone().json().catch(() => undefined);
			const parsed = options.bodySchema.safeParse(raw);
			if (!parsed.success) return Response.json({ error: "输入参数无效" }, { status: 400 });
			body = parsed.data;
		}
		try {
			return await handler({ session, body });
		} catch (error) {
			// Mirror the real guard: an AppError keeps its own status.
			const status = (error as { status?: number }).status ?? options.errorStatus ?? 500;
			return Response.json({ error: (error as Error).message }, { status });
		}
	}),
}));

const session = {
	userId: "u_1",
	username: "op",
	roles: ["operator"],
	mustChangePassword: false,
	currentTeamId: "team_1",
};

const accounts = await import("../billing-accounts/route");
const accountItem = await import("../billing-accounts/[id]/route");
const accountSync = await import("../billing-accounts/[id]/sync/route");
const budgets = await import("../budgets/route");
const budgetItem = await import("../budgets/[id]/route");
const budgetCheck = await import("../budgets/check/route");

const idParams = { params: Promise.resolve({ id: "acct_1" }) };

function req(method: string, body?: unknown, url = "https://a.test/api/cost/x") {
	return new Request(url, {
		method,
		headers: { "content-type": "application/json" },
		...(body === undefined ? {} : { body: JSON.stringify(body) }),
	});
}

const accountView = {
	id: "acct_1",
	name: "aws-prod",
	provider: "aws",
	currency: "USD",
	enabled: true,
	teamId: "team_1",
	hasCredentials: true,
};

const budgetView = {
	id: "bud_1",
	category: "vps",
	name: "vps monthly",
	limitAmount: "500.00",
	currency: "USD",
};

function accountBody(overrides: Record<string, unknown> = {}) {
	return {
		name: "aws-prod",
		provider: "aws",
		credentials: { accessKeyId: "AKIA...", secretAccessKey: "s3cr3t" },
		...overrides,
	};
}

describe("cost routes", () => {
	beforeEach(() => {
		for (const group of [mocks.billing, mocks.cost]) {
			for (const stub of Object.values(group)) stub.mockReset();
		}
		mocks.auditUserAction.mockReset();
		mocks.guardCalls.length = 0;
		mocks.billing.listCloudBillingAccounts.mockResolvedValue([accountView]);
		mocks.billing.createCloudBillingAccount.mockResolvedValue(accountView);
		mocks.billing.getCloudBillingAccount.mockResolvedValue(accountView);
		mocks.billing.updateCloudBillingAccount.mockResolvedValue(accountView);
		mocks.billing.deleteCloudBillingAccount.mockResolvedValue(undefined);
		mocks.billing.syncCloudBillingAccount.mockResolvedValue({
			run: { month: "2026-08", status: "SUCCESS" },
			imported: 12,
			skipped: 1,
		});
		mocks.cost.listCostBudgets.mockResolvedValue([budgetView]);
		mocks.cost.createCostBudget.mockResolvedValue(budgetView);
		mocks.cost.updateCostBudget.mockResolvedValue(budgetView);
		mocks.cost.deleteCostBudget.mockResolvedValue(undefined);
		mocks.cost.checkBudgetAlerts.mockResolvedValue({ checked: 3, triggered: 1, notificationsSent: 1 });
	});

	describe("permission split", () => {
		it.each([
			["list accounts", async () => accounts.GET(req("GET")), "cost:read", 120],
			["create account", async () => accounts.POST(req("POST", accountBody())), "cost:manage", 30],
			["read account", async () => accountItem.GET(req("GET"), idParams), "cost:read", 120],
			["patch account", async () => accountItem.PATCH(req("PATCH", { name: "x" }), idParams), "cost:manage", 30],
			["delete account", async () => accountItem.DELETE(req("DELETE"), idParams), "cost:manage", 30],
			["sync account", async () => accountSync.POST(req("POST", {}), idParams), "cost:manage", 30],
			["list budgets", async () => budgets.GET(req("GET")), "cost:read", 120],
			["create budget", async () => budgets.POST(req("POST", { category: "vps", name: "b", limitAmount: "10.00" })), "cost:manage", 30],
			["patch budget", async () => budgetItem.PATCH(req("PATCH", { name: "x" }), idParams), "cost:manage", 30],
			["delete budget", async () => budgetItem.DELETE(req("DELETE"), idParams), "cost:manage", 30],
			["check budgets", async () => budgetCheck.POST(req("POST")), "cost:manage", 30],
		])("%s requires %s at %s/min", async (_label, call, permission, maxRequests) => {
			await call();
			expect(mocks.guardCalls[0]).toMatchObject({
				permission,
				rateLimit: { maxRequests, windowMs: 60_000 },
			});
		});
	});

	describe("billing accounts", () => {
		it("lists through the session-scoped service", async () => {
			const res = await accounts.GET(req("GET"));
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ accounts: [accountView] });
			expect(mocks.billing.listCloudBillingAccounts).toHaveBeenCalledWith(session);
		});

		it("creates an account, returns 201 and audits it", async () => {
			const res = await accounts.POST(req("POST", accountBody({ currency: "USD" })));

			expect(res.status).toBe(201);
			expect(mocks.billing.createCloudBillingAccount).toHaveBeenCalledWith(
				expect.objectContaining({ name: "aws-prod", provider: "aws" }),
				session,
			);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"cost.billing_account.create",
				{ accountId: "acct_1", provider: "aws", name: "aws-prod", teamId: "team_1" },
				undefined,
				"team_1",
			);
		});

		it("strips a client-supplied teamId instead of honouring it", async () => {
			await accounts.POST(req("POST", accountBody({ teamId: "team_victim" })));
			const input = mocks.billing.createCloudBillingAccount.mock.calls[0]?.[0] as Record<string, unknown>;
			expect(input).not.toHaveProperty("teamId");
		});

		it("never echoes the submitted credentials back to the client", async () => {
			const res = await accounts.POST(req("POST", accountBody()));
			const text = await res.text();
			expect(text).not.toContain("s3cr3t");
			expect(JSON.parse(text).account).toMatchObject({ hasCredentials: true });
		});

		it.each([
			["an unknown provider", { provider: "hetzner" }],
			["a blank name", { name: "" }],
			["an unknown top-level field", { region: "eu-west-1" }],
			["a non-public billingCsvUrl", { config: { billingCsvUrl: "http://127.0.0.1/bill.csv" } }],
			["a credentials URL with embedded auth", { config: { billingCsvUrl: "https://user:pw@example.com/b.csv" } }],
		])("rejects %s", async (_label, overrides) => {
			const res = await accounts.POST(req("POST", accountBody(overrides)));
			expect(res.status).toBe(400);
			expect(mocks.billing.createCloudBillingAccount).not.toHaveBeenCalled();
		});

		it("keeps a 404 for an account outside the caller's scope", async () => {
			const { NotFoundError } = await import("@/lib/errors");
			mocks.billing.getCloudBillingAccount.mockRejectedValue(new NotFoundError("not found"));
			const res = await accountItem.GET(req("GET"), idParams);
			expect(res.status).toBe(404);
		});

		it("requires at least one field on PATCH", async () => {
			const res = await accountItem.PATCH(req("PATCH", {}), idParams);
			expect(res.status).toBe(400);
			expect(mocks.billing.updateCloudBillingAccount).not.toHaveBeenCalled();
		});

		it("does not let PATCH move an account to another team", async () => {
			await accountItem.PATCH(req("PATCH", { name: "x", teamId: "team_victim" }), idParams);
			const input = mocks.billing.updateCloudBillingAccount.mock.calls[0]?.[1] as Record<string, unknown>;
			expect(input).not.toHaveProperty("teamId");
		});

		it("deletes and audits", async () => {
			const res = await accountItem.DELETE(req("DELETE"), idParams);
			expect(res.status).toBe(200);
			expect(mocks.billing.deleteCloudBillingAccount).toHaveBeenCalledWith("acct_1", session);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"cost.billing_account.delete",
				{ accountId: "acct_1" },
				undefined,
				"team_1",
			);
		});

		it("syncs a specific month and audits the import counts", async () => {
			const res = await accountSync.POST(req("POST", { month: "2026-08" }), idParams);

			expect(res.status).toBe(200);
			expect(mocks.billing.syncCloudBillingAccount).toHaveBeenCalledWith("acct_1", "2026-08", session);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"cost.billing_account.sync",
				{ accountId: "acct_1", month: "2026-08", imported: 12, skipped: 1, status: "SUCCESS" },
				undefined,
				"team_1",
			);
		});

		it.each([["2026-13"], ["26-08"], ["2026-8"]])("rejects the malformed month %s", async (month) => {
			const res = await accountSync.POST(req("POST", { month }), idParams);
			expect(res.status).toBe(400);
			expect(mocks.billing.syncCloudBillingAccount).not.toHaveBeenCalled();
		});

		it("defaults to the current month when none is given", async () => {
			await accountSync.POST(req("POST", {}), idParams);
			expect(mocks.billing.syncCloudBillingAccount).toHaveBeenCalledWith("acct_1", undefined, session);
		});
	});

	describe("budgets", () => {
		it("lists budgets for the caller's scope", async () => {
			const res = await budgets.GET(req("GET"));
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ budgets: [budgetView] });
			expect(mocks.cost.listCostBudgets).toHaveBeenCalledWith(expect.any(Date), session);
		});

		it("creates a budget and audits it", async () => {
			const res = await budgets.POST(
				req("POST", { category: "vps", name: "vps monthly", limitAmount: "500.00", currency: "USD" }),
			);

			expect(res.status).toBe(200);
			expect(mocks.cost.createCostBudget).toHaveBeenCalledWith(
				expect.objectContaining({ category: "vps", limitAmount: "500.00" }),
				session,
			);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"cost.budget.create",
				{ budgetId: "bud_1", category: "vps", limitAmount: "500.00", currency: "USD" },
				undefined,
				"team_1",
			);
		});

		it.each([
			["a zero limit", { limitAmount: "0" }],
			["a negative limit", { limitAmount: "-5.00" }],
			["three decimal places", { limitAmount: "5.005" }],
			["an unknown category", { category: "gpu" }],
			["an unknown currency", { currency: "GBP" }],
			["a threshold over 100", { alertThresholdPercent: 101 }],
		])("rejects %s", async (_label, overrides) => {
			const res = await budgets.POST(
				req("POST", { category: "vps", name: "b", limitAmount: "10.00", ...overrides }),
			);
			expect(res.status).toBe(400);
			expect(mocks.cost.createCostBudget).not.toHaveBeenCalled();
		});

		it("rejects an empty PATCH and an unknown field", async () => {
			expect((await budgetItem.PATCH(req("PATCH", {}), idParams)).status).toBe(400);
			expect((await budgetItem.PATCH(req("PATCH", { nope: 1 }), idParams)).status).toBe(400);
			expect(mocks.cost.updateCostBudget).not.toHaveBeenCalled();
		});

		it("audits a budget deletion at WARNING", async () => {
			const res = await budgetItem.DELETE(req("DELETE"), idParams);
			expect(res.status).toBe(200);
			expect(mocks.cost.deleteCostBudget).toHaveBeenCalledWith("acct_1", session);
			expect(mocks.auditUserAction).toHaveBeenCalledWith(
				"u_1",
				"cost.budget.delete",
				{ budgetId: "acct_1" },
				"WARNING",
				"team_1",
			);
		});

		it("evaluates only the caller's budgets on check", async () => {
			const res = await budgetCheck.POST(req("POST"));

			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({
				result: { checked: 3, triggered: 1, notificationsSent: 1 },
			});
			// Without the session this would evaluate the whole fleet's budgets.
			expect(mocks.cost.checkBudgetAlerts).toHaveBeenCalledWith(expect.any(Date), session);
		});
	});
});
