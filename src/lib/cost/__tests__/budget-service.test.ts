import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, createNotificationMock } = vi.hoisted(() => ({
	prismaMock: {
		costBudget: { create: vi.fn(), findMany: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
		costEntry: { aggregate: vi.fn() },
		user: { findMany: vi.fn() },
		notification: { findFirst: vi.fn() },
	},
	createNotificationMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/notification/service", () => ({ createNotification: createNotificationMock }));

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
		prismaMock.costEntry.aggregate.mockResolvedValue({ _sum: { amount: decimal("85.00") } });
		prismaMock.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
		prismaMock.notification.findFirst.mockResolvedValue(null);
		createNotificationMock.mockResolvedValue({ id: "notification-1" });
	});

	it("supports CRUD and returns usage with percentage", async () => {
		const created = await createCostBudget({ category: "vps", name: "VPS 月度预算", limitAmount: "100.00", currency: "CNY", period: "monthly", alertThresholdPercent: 80, enabled: true });
		expect(created.limitAmount).toBe("100.00");
		const listed = await listCostBudgets(new Date("2026-06-15T10:00:00.000Z"));
		expect(listed[0]).toMatchObject({ usageAmount: "85.00", usagePercent: 85 });
		expect(prismaMock.costEntry.aggregate).toHaveBeenCalledWith({
			where: { category: "vps", currency: "CNY", effectiveDate: { gte: new Date("2026-06-01T00:00:00.000Z"), lt: new Date("2026-07-01T00:00:00.000Z") } },
			_sum: { amount: true },
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

	it("notifies cost managers once per budget period", async () => {
		const first = await checkBudgetAlerts(new Date("2026-06-15T10:00:00.000Z"));
		expect(first).toMatchObject({ checked: 1, triggered: 1, notificationsSent: 2, duplicatesSkipped: 0 });
		expect(createNotificationMock).toHaveBeenCalledTimes(2);
		expect(createNotificationMock).toHaveBeenCalledWith(expect.objectContaining({ userId: "admin-1", type: "system", actionUrl: "/cost-summary?budget=budget-1&periodStart=2026-06-01" }));

		vi.clearAllMocks();
		prismaMock.costBudget.findMany.mockResolvedValue([budgetRow]);
		prismaMock.costEntry.aggregate.mockResolvedValue({ _sum: { amount: decimal("85.00") } });
		prismaMock.user.findMany.mockResolvedValue([{ id: "admin-1" }, { id: "admin-2" }]);
		prismaMock.notification.findFirst.mockResolvedValue({ id: "existing" });
		const second = await checkBudgetAlerts(new Date("2026-06-16T10:00:00.000Z"));
		expect(second.notificationsSent).toBe(0);
		expect(second.duplicatesSkipped).toBe(2);
		expect(createNotificationMock).not.toHaveBeenCalled();
	});
});
