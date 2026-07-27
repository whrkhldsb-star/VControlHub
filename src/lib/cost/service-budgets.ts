import { Prisma } from "@prisma/client";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";
import { createNotification } from "@/lib/notification/service";
import { createCostBudgetSchema, updateCostBudgetSchema } from "./schema";
import type { CostBudgetPeriod, CostBudgetRecord, CostCategory, CostCurrency } from "./types";
import { DEFAULT_CURRENCY, isoDateOnly, type TeamSession } from "./service-internals";

type BudgetRow = {
	id: string; category: string; name: string; limitAmount: Prisma.Decimal; currency: string;
	period: string; alertThresholdPercent: number; enabled: boolean; createdAt: Date; updatedAt: Date;
};

export function getBudgetPeriodRange(period: CostBudgetPeriod, now = new Date()): { start: Date; endExclusive: Date } {
	const year = now.getUTCFullYear(); const month = now.getUTCMonth();
	if (period === "monthly") return { start: new Date(Date.UTC(year, month, 1)), endExclusive: new Date(Date.UTC(year, month + 1, 1)) };
	if (period === "quarterly") { const start = Math.floor(month / 3) * 3; return { start: new Date(Date.UTC(year, start, 1)), endExclusive: new Date(Date.UTC(year, start + 3, 1)) }; }
	return { start: new Date(Date.UTC(year, 0, 1)), endExclusive: new Date(Date.UTC(year + 1, 0, 1)) };
}

async function budgetToRecord(row: BudgetRow & { teamId?: string | null }, now = new Date(), session?: TeamSession | null): Promise<CostBudgetRecord> {
	const range = getBudgetPeriodRange(row.period as CostBudgetPeriod, now);
	const aggregate = await prisma.costEntry.aggregate({ where: { category: row.category, currency: row.currency, effectiveDate: { gte: range.start, lt: range.endExclusive }, ...(session ? teamWhere(session) : row.teamId ? { teamId: row.teamId } : {}) }, _sum: { amount: true } });
	const usageAmount = aggregate._sum.amount?.toFixed(2) ?? "0.00"; const limitAmount = row.limitAmount.toFixed(2);
	return { id: row.id, category: row.category as CostCategory, name: row.name, limitAmount, currency: row.currency as CostCurrency, period: row.period as CostBudgetPeriod, alertThresholdPercent: row.alertThresholdPercent, enabled: row.enabled, usageAmount, usagePercent: Number(((Number(usageAmount) / Number(limitAmount)) * 100).toFixed(1)), periodStart: isoDateOnly(range.start), periodEnd: isoDateOnly(new Date(range.endExclusive.getTime() - 1)), teamId: row.teamId ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function createCostBudget(input: unknown, session?: TeamSession | null): Promise<CostBudgetRecord> {
	const parsed = createCostBudgetSchema.parse(input); const teamId = session ? teamCreateData(session).teamId : null;
	const row = await prisma.costBudget.create({ data: { category: parsed.category, name: parsed.name, limitAmount: new Prisma.Decimal(parsed.limitAmount), currency: parsed.currency ?? DEFAULT_CURRENCY, period: parsed.period ?? "monthly", alertThresholdPercent: parsed.alertThresholdPercent ?? 80, enabled: parsed.enabled ?? true, teamId: teamId ?? null } });
	return budgetToRecord(row, new Date(), session);
}
export async function listCostBudgets(now = new Date(), session?: TeamSession | null): Promise<CostBudgetRecord[]> {
	const rows = await prisma.costBudget.findMany({ where: session ? teamWhere(session) : {}, orderBy: { createdAt: "desc" } });
	return Promise.all(rows.map((row) => budgetToRecord(row, now, session)));
}
export async function getCostBudget(id: string, now = new Date(), session?: TeamSession | null): Promise<CostBudgetRecord | null> {
	const row = session ? await prisma.costBudget.findFirst({ where: { id, ...teamWhere(session) } }) : await prisma.costBudget.findUnique({ where: { id } });
	return row ? budgetToRecord(row, now, session) : null;
}
export async function updateCostBudget(id: string, input: unknown, session?: TeamSession | null): Promise<CostBudgetRecord> {
	const parsed = updateCostBudgetSchema.parse(input); const data: Prisma.CostBudgetUpdateInput = { ...parsed };
	if (parsed.limitAmount !== undefined) data.limitAmount = new Prisma.Decimal(parsed.limitAmount);
	if (session) {
		const claimed = await prisma.costBudget.updateMany({ where: { id, ...teamWhere(session) }, data });
		if (claimed.count === 0) throw new NotFoundError(t("backend.cost.costBudgetNotFound"));
		const row = await prisma.costBudget.findFirst({ where: { id, ...teamWhere(session) } });
		if (!row) throw new NotFoundError(t("backend.cost.costBudgetNotFound")); return budgetToRecord(row, new Date(), session);
	}
	return budgetToRecord(await prisma.costBudget.update({ where: { id }, data }), new Date(), session);
}
export async function deleteCostBudget(id: string, session?: TeamSession | null): Promise<void> {
	if (session) { const claimed = await prisma.costBudget.deleteMany({ where: { id, ...teamWhere(session) } }); if (claimed.count === 0) throw new NotFoundError(t("backend.cost.costBudgetNotFound")); return; }
	await prisma.costBudget.delete({ where: { id } });
}

async function listCostBudgetAlertManagers(teamId: string | null | undefined) {
	return prisma.user.findMany({ where: { roles: { some: { role: { permissions: { some: { permission: { key: "cost:manage" } } } } } }, ...(teamId ? { OR: [{ teamMemberships: { some: { teamId } } }, { roles: { some: { role: { permissions: { some: { permission: { key: "team:manage" } } } } } } }] } : {}) }, select: { id: true }, take: 1000 });
}
export async function checkBudgetAlerts(now = new Date(), session?: TeamSession | null) {
	const budgets = await listCostBudgets(now, session); let triggered = 0; let notificationsSent = 0; let duplicatesSkipped = 0;
	for (const budget of budgets) {
		if (!budget.enabled || budget.usagePercent < budget.alertThresholdPercent) continue; triggered += 1;
		const actionUrl = `/cost-summary?budget=${budget.id}&periodStart=${budget.periodStart}`;
		for (const manager of await listCostBudgetAlertManagers(budget.teamId)) {
			if (await prisma.notification.findFirst({ where: { userId: manager.id, type: "system", actionUrl } })) { duplicatesSkipped += 1; continue; }
			await createNotification({ userId: manager.id, type: "system", title: `Cost budget alert: ${budget.name}`, message: `${budget.usageAmount} ${budget.currency} used (${budget.usagePercent}%), threshold ${budget.alertThresholdPercent}% of ${budget.limitAmount} ${budget.currency}.`, actionUrl, teamId: budget.teamId ?? null }); notificationsSent += 1;
		}
	}
	return { checked: budgets.length, triggered, notificationsSent, duplicatesSkipped, budgets };
}
