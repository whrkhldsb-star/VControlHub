import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, announceMock, claimDeliveries } = vi.hoisted(() => ({
	prismaMock: {
		costBudget: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn(), delete: vi.fn() },
		costEntry: { aggregate: vi.fn(), groupBy: vi.fn() },
		user: { findMany: vi.fn() },
		notification: { findMany: vi.fn(), createManyAndReturn: vi.fn() },
		$transaction: vi.fn(), $queryRaw: vi.fn(),
	},
	announceMock: vi.fn(),
	claimDeliveries: vi.fn(),
}));

vi.mock("../budget-deliveries", () => ({ ensureBudgetDeliveryTable: vi.fn(), claimBudgetDeliveries: claimDeliveries }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/notification/service", async (importOriginal) => ({ ...await importOriginal<typeof import("@/lib/notification/service")>(), announceStoredNotifications: announceMock }));
// Two evaluators must not both alert one budget period: serialised per period.
const lockKeys = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/concurrency/advisory-lock", () => ({
	acquireAdvisoryLock: vi.fn(async (namespace: string, key: string) => {
		lockKeys.push(`${namespace}|${key}`);
		return async () => undefined;
	}),
}));

const { createCostBudget, updateCostBudget, deleteCostBudget, listCostBudgets, getBudgetPeriodRange, checkBudgetAlerts } = await import("../service");

const decimal = (value: string) => ({ toFixed: () => value, toString: () => value });
const budgetRow = {
	id: "budget-1", category: "vps", name: "VPS 月度预算", limitAmount: decimal("100.00"),
	currency: "CNY", period: "monthly", alertThresholdPercent: 80, enabled: true,
	createdAt: new Date("2026-01-01T00:00:00.000Z"), updatedAt: new Date("2026-01-01T00:00:00.000Z"),
};

describe("cost budget service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		prismaMock.costBudget.create.mockResolvedValue(budgetRow);
		prismaMock.costBudget.update.mockResolvedValue({ ...budgetRow, name: "更新预算" });
		prismaMock.costBudget.delete.mockResolvedValue(budgetRow);
		prismaMock.costBudget.findMany.mockResolvedValue([budgetRow]);
		prismaMock.costBudget.findFirst.mockImplementation(async ({ where }) => (await prismaMock.costBudget.findMany()).find((row: { id: string }) => row.id === where.id));
		// One groupBy per period serves every budget's own-currency usage and
		// other-currency spend (A8); default: 85 CNY on the shared vps budget.
		prismaMock.costEntry.groupBy.mockResolvedValue([{ category: "vps", currency: "CNY", teamId: null, _sum: { amount: decimal("85.00") }, _count: { _all: 2 } }]);
		prismaMock.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
		prismaMock.notification.findMany.mockResolvedValue([]);
		const receipts = new Set<string>();
		prismaMock.$transaction.mockImplementation(fn => fn(prismaMock));
		claimDeliveries.mockImplementation((_tx, budget, period, users: string[]) => users.filter(id => {
			const key = JSON.stringify([budget, period, id]);
			if (receipts.has(key)) return false;
			receipts.add(key);
			return true;
		}));
		prismaMock.notification.createManyAndReturn.mockImplementation(({ data }) => data);
	});

	it("supports CRUD and returns usage with percentage", async () => {
		const created = await createCostBudget({ category: "vps", name: "VPS 月度预算", limitAmount: "100.00", currency: "CNY", period: "monthly", alertThresholdPercent: 80, enabled: true });
		expect(created.limitAmount).toBe("100.00");
		const listed = await listCostBudgets(new Date("2026-06-15T10:00:00.000Z"));
		expect(listed[0]).toMatchObject({ usageAmount: "85.00", usagePercent: 85 });
		expect(prismaMock.costEntry.groupBy).toHaveBeenCalledWith({
			by: ["category", "currency", "teamId"],
			where: { category: { in: ["vps"] }, effectiveDate: { gte: new Date("2026-06-01T00:00:00.000Z"), lt: new Date("2026-07-01T00:00:00.000Z") } },
			_sum: { amount: true },
			_count: { _all: true },
		});
		await updateCostBudget("budget-1", { name: "更新预算" });
		expect(prismaMock.costBudget.update).toHaveBeenCalled();
		await deleteCostBudget("budget-1");
		expect(prismaMock.costBudget.delete).toHaveBeenCalledWith({ where: { id: "budget-1" } });
	});

	it("calculates monthly, quarterly, and yearly UTC ranges", () => {
		const now = new Date("2026-06-15T10:00:00.000Z");
		expect(getBudgetPeriodRange("monthly", now)).toEqual({ start: new Date("2026-06-01T00:00:00.000Z"), endExclusive: new Date("2026-07-01T00:00:00.000Z") });
		expect(getBudgetPeriodRange("quarterly", now)).toEqual({ start: new Date("2026-04-01T00:00:00.000Z"), endExclusive: new Date("2026-07-01T00:00:00.000Z") });
		expect(getBudgetPeriodRange("yearly", now)).toEqual({ start: new Date("2026-01-01T00:00:00.000Z"), endExclusive: new Date("2027-01-01T00:00:00.000Z") });
	});

	it("checks only live customers' budgets on the daily run", async () => {
		// A deleted customer's budgets kept alerting its managers and the admins.
		prismaMock.costBudget.findMany.mockResolvedValueOnce([]);
		await checkBudgetAlerts(new Date("2026-06-15T10:00:00.000Z"));
		expect(prismaMock.costBudget.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { OR: [{ teamId: null }, { team: { deletedAt: null } }] } }));
	});

	it("rechecks a changed budget before claiming any period receipt", async () => {
		prismaMock.costBudget.findFirst.mockResolvedValueOnce({ ...budgetRow, limitAmount: decimal("1000") });
		const result = await checkBudgetAlerts(new Date("2026-06-15"));
		expect(result).toMatchObject({ triggered: 0, notificationsSent: 0, budgets: [{ usageStatus: "within" }] });
		expect(prismaMock.notification.createManyAndReturn).not.toHaveBeenCalled();
	});

	it("notifies cost managers once per budget period", async () => {
		const first = await checkBudgetAlerts(new Date("2026-06-15T10:00:00.000Z"));
		expect(first).toMatchObject({ checked: 1, triggered: 1, notificationsSent: 2, duplicatesSkipped: 0 });
		expect(announceMock).toHaveBeenCalledTimes(1);
		expect(announceMock).toHaveBeenCalledWith(expect.arrayContaining([expect.objectContaining({ userId: "admin-1", type: "system", actionUrl: "/cost-summary?budget=budget-1&periodStart=2026-06-01" })]));

		vi.clearAllMocks();
		prismaMock.costBudget.findMany.mockResolvedValue([budgetRow]);
		prismaMock.costEntry.groupBy.mockResolvedValue([{ category: "vps", currency: "CNY", teamId: null, _sum: { amount: decimal("85.00") }, _count: { _all: 2 } }]);
		prismaMock.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
		// Inbox cleared between checks. Only independent receipts survive.
		prismaMock.notification.findMany.mockResolvedValue([]);
		const second = await checkBudgetAlerts(new Date("2026-06-16T10:00:00.000Z"));
		expect(second.notificationsSent).toBe(0);
		expect(second.duplicatesSkipped).toBe(2);
		expect(lockKeys).toContain("cost-budget-alert|budget-1:2026-06-01");
		expect(prismaMock.notification.createManyAndReturn).not.toHaveBeenCalled();
	});

	it("displays 80.0% at 79.96 without consuming the alert due at 80.00", async () => {
		const now = new Date("2026-06-01");
		for (const amount of ["79.96", "80.00"]) {
			prismaMock.costEntry.groupBy.mockResolvedValue([{ category: "vps", currency: "CNY", teamId: null, _sum: { amount: decimal(amount) }, _count: { _all: 1 } }]);
			const result = await checkBudgetAlerts(now);
			expect(result.budgets[0]).toMatchObject({ usagePercent: 80, usageStatus: amount === "79.96" ? "within" : "threshold" });
			expect(result.notificationsSent).toBe(amount === "79.96" ? 0 : 2);
		}
	});

	it("walks all managers by stable id, adopting existing inbox deliveries on upgrade", async () => {
		const first = Array.from({ length: 1000 }, (_, i) => ({ id: String(i).padStart(4, "0") }));
		prismaMock.user.findMany.mockResolvedValueOnce(first).mockResolvedValueOnce([{ id: "1000" }]);
		prismaMock.notification.findMany.mockResolvedValueOnce([{ userId: "0000" }]);
		const result = await checkBudgetAlerts(new Date("2026-06-01"));
		expect(result).toMatchObject({ notificationsSent: 1000, duplicatesSkipped: 1 });
		expect(prismaMock.user.findMany.mock.calls[1]?.[0]).toMatchObject({ where: { id: { gt: "0999" } }, orderBy: { id: "asc" } });
		expect(announceMock.mock.lastCall?.[0]).toMatchObject([{ userId: "1000" }]);
	});

	it("scopes budget alert recipients to the budget team (not all cost:manage users)", async () => {
		const teamBudget = { ...budgetRow, id: "budget-team", teamId: "team-a" };
		prismaMock.costBudget.findMany.mockResolvedValue([teamBudget]);
		prismaMock.costEntry.groupBy.mockResolvedValue([{ category: "vps", currency: "CNY", teamId: "team-a", _sum: { amount: decimal("90.00") }, _count: { _all: 1 } }]);
		prismaMock.user.findMany.mockResolvedValue([{ id: "team-a-manager" }]);
		prismaMock.notification.findMany.mockResolvedValue([]);

		const result = await checkBudgetAlerts(new Date("2026-06-15T10:00:00.000Z"));
		expect(result.notificationsSent).toBe(1);
		expect(prismaMock.user.findMany).toHaveBeenCalledWith(
			expect.objectContaining({
				// Platform administrators plus team-a accounts allowed to manage cost.
				where: expect.objectContaining({
					OR: [
						{ roles: { some: { role: { key: "admin" } } } },
						{ teamMembership: { is: { teamId: "team-a", team: { deletedAt: null }, identityTemplate: { permissions: { has: "cost:manage" } } } } },
					],
				}),
			}),
		);
		expect(announceMock).toHaveBeenCalledWith(
			[expect.objectContaining({ userId: "team-a-manager", teamId: "team-a" })],
		);
	});

	it("restricts null-team (shared) budget alerts to platform administrators, not every customer's cost managers", async () => {
		const sharedBudget = { ...budgetRow, id: "budget-shared", teamId: null };
		prismaMock.costBudget.findMany.mockResolvedValue([sharedBudget]);
		prismaMock.costEntry.groupBy.mockResolvedValue([{ category: "vps", currency: "CNY", teamId: null, _sum: { amount: decimal("90.00") }, _count: { _all: 1 } }]);
		prismaMock.user.findMany.mockResolvedValue([{ id: "global-admin" }]);
		prismaMock.notification.findMany.mockResolvedValue([]);

		await checkBudgetAlerts(new Date("2026-06-15T10:00:00.000Z"));

		const where = prismaMock.user.findMany.mock.calls.at(-1)![0].where;
		// No broadcast to any customer's cost managers; administrators only.
		expect(where.OR).toBeUndefined();
		expect(where.roles).toEqual({ some: { role: { key: "admin" } } });
	});

	it("aggregates a team budget by the budget team even for a global administrator", async () => {
		const teamBudget = { ...budgetRow, id: "budget-team", teamId: "team-a"
};
		prismaMock.costBudget.findMany.mockResolvedValue([teamBudget]);
		const adminSession = {
			userId: "admin-1",
			roles: ["admin"] as import("@/lib/auth/rbac").RoleKey[],
			currentTeamId: null,
		};

		// Spend of another team and of the shared pool under the same category must not count.
		prismaMock.costEntry.groupBy.mockResolvedValue([
			{ category: "vps", currency: "CNY", teamId: "team-a", _sum: { amount: decimal("40.00") }, _count: { _all: 1 } },
			{ category: "vps", currency: "CNY", teamId: "team-b", _sum: { amount: decimal("30.00") }, _count: { _all: 1 } },
			{ category: "vps", currency: "CNY", teamId: null, _sum: { amount: decimal("85.00") }, _count: { _all: 2 } },
		]);
		const listed = await listCostBudgets(new Date("2026-06-15T10:00:00.000Z"), adminSession);

		expect(listed[0]).toMatchObject({ usageAmount: "40.00", usagePercent: 40 });
	});
});
