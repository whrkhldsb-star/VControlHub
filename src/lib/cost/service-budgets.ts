import { claimBudgetDeliveries, ensureBudgetDeliveryTable } from "./budget-deliveries";
import { wallClockInAppTimeZone } from "@/lib/datetime/time-zone";
import { Prisma } from "@prisma/client";
import { liveCustomerRowsWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { announceStoredNotifications, notificationContentData } from "@/lib/notification/service";
import { createCostBudgetSchema, updateCostBudgetSchema } from "./schema";
import type { CostBudgetPeriod, CostBudgetRecord, CostCategory, CostCurrency, CostCurrencyBucket } from "./types";
import { DEFAULT_CURRENCY, isoDateOnly, type TeamSession } from "./service-internals";
import { permissionHoldersWhere } from "@/lib/auth/permission-holders";
import { acquireAdvisoryLock } from "@/lib/concurrency/advisory-lock";

type BudgetRow = {
	id: string; category: string; name: string; limitAmount: Prisma.Decimal; currency: string;
	period: string; alertThresholdPercent: number; enabled: boolean; createdAt: Date; updatedAt: Date;
};

/**
 * The budget period `now` falls in. "Now" is read on the application clock
 * (a month turns at midnight in Asia/Shanghai, not at 08:00), while the
 * bounds stay calendar dates stored as UTC midnight, matching effectiveDate.
 */
export function getBudgetPeriodRange(period: CostBudgetPeriod, now = new Date()): { start: Date; endExclusive: Date } {
	const wall = wallClockInAppTimeZone(now);
	const year = wall.year; const month = wall.month - 1;
	if (period === "monthly") return { start: new Date(Date.UTC(year, month, 1)), endExclusive: new Date(Date.UTC(year, month + 1, 1)) };
	if (period === "quarterly") { const start = Math.floor(month / 3) * 3; return { start: new Date(Date.UTC(year, start, 1)), endExclusive: new Date(Date.UTC(year, start + 3, 1)) }; }
	return { start: new Date(Date.UTC(year, 0, 1)), endExclusive: new Date(Date.UTC(year + 1, 0, 1)) };
}

type BudgetUsage = { amount: string; others: CostCurrencyBucket[] };

/**
 * Usage of every budget in one grouped query per distinct period (A8-07): the
 * list and the daily check used to run two aggregates per budget.
 */
async function loadBudgetUsage(rows: Array<BudgetRow & { teamId?: string | null }>, now: Date, db: Prisma.TransactionClient = prisma): Promise<Map<string, BudgetUsage>> {
	const usage = new Map<string, BudgetUsage>();
	const byPeriod = new Map<string, Array<BudgetRow & { teamId?: string | null }>>();
	for (const row of rows) byPeriod.set(row.period, [...(byPeriod.get(row.period) ?? []), row]);
	for (const [period, group] of byPeriod) {
		const range = getBudgetPeriodRange(period as CostBudgetPeriod, now);
		const grouped = await db.costEntry.groupBy({
			by: ["category", "currency", "teamId"],
			where: { category: { in: [...new Set(group.map((row) => row.category))] }, effectiveDate: { gte: range.start, lt: range.endExclusive } },
			_sum: { amount: true },
			_count: { _all: true },
		});
		for (const row of group) {
			const mine = grouped.filter((entry) => entry.category === row.category && (entry.teamId ?? null) === (row.teamId ?? null));
			const own = mine.find((entry) => entry.currency === row.currency);
			usage.set(row.id, {
				amount: own?._sum.amount?.toFixed(2) ?? "0.00",
				others: mine
					.filter((entry) => entry.currency !== row.currency)
					.map((entry) => ({ currency: entry.currency as CostCurrency, totalAmount: entry._sum.amount?.toFixed(2) ?? "0.00", entryCount: entry._count._all }))
					.sort((a, b) => a.currency.localeCompare(b.currency)),
			});
		}
	}
	return usage;
}

async function budgetToRecord(row: BudgetRow & { teamId?: string | null }, now = new Date(), preloaded?: BudgetUsage): Promise<CostBudgetRecord> {
	const range = getBudgetPeriodRange(row.period as CostBudgetPeriod, now);
	const usage = preloaded ?? (await loadBudgetUsage([row], now)).get(row.id) ?? { amount: "0.00", others: [] };
	const otherCurrencyUsage = usage.others;
	const usageAmount = usage.amount; const limitAmount = row.limitAmount.toFixed(2);
	const used = new Prisma.Decimal(usageAmount);
	const percentNumerator = used.times(100);
	const usageStatus = used.gte(limitAmount) ? "exhausted"
		: percentNumerator.gte(new Prisma.Decimal(limitAmount).times(row.alertThresholdPercent)) ? "threshold" : "within";
	return { id: row.id, category: row.category as CostCategory, name: row.name, limitAmount, currency: row.currency as CostCurrency, period: row.period as CostBudgetPeriod, alertThresholdPercent: row.alertThresholdPercent, enabled: row.enabled, usageAmount, usageStatus, usagePercent: percentNumerator.div(limitAmount).toDecimalPlaces(1).toNumber(), periodStart: isoDateOnly(range.start), periodEnd: isoDateOnly(new Date(range.endExclusive.getTime() - 1)), otherCurrencyUsage, teamId: row.teamId ?? null, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}

export async function createCostBudget(input: unknown, session?: TeamSession | null): Promise<CostBudgetRecord> {
	const parsed = createCostBudgetSchema.parse(input); const teamId = session ? teamCreateData(session).teamId : null;
	const row = await prisma.costBudget.create({ data: { category: parsed.category, name: parsed.name, limitAmount: new Prisma.Decimal(parsed.limitAmount), currency: parsed.currency ?? DEFAULT_CURRENCY, period: parsed.period ?? "monthly", alertThresholdPercent: parsed.alertThresholdPercent ?? 80, enabled: parsed.enabled ?? true, teamId: teamId ?? null } });
	return budgetToRecord(row);
}
export async function listCostBudgets(now = new Date(), session?: TeamSession | null): Promise<CostBudgetRecord[]> {
	return prisma.$transaction(async tx => {
		const rows = await tx.costBudget.findMany({ where: budgetScope(session), orderBy: { createdAt: "desc" } });
		const usage = await loadBudgetUsage(rows, now, tx);
		return Promise.all(rows.map((row) => budgetToRecord(row, now, usage.get(row.id))));
	}, { isolationLevel: "RepeatableRead" });
}

function budgetScope(session?: TeamSession | null): Prisma.CostBudgetWhereInput {
	return session ? { AND: [teamWhere(session), liveCustomerRowsWhere()] } : liveCustomerRowsWhere();
}

export async function updateCostBudget(id: string, input: unknown, session?: TeamSession | null): Promise<CostBudgetRecord> {
	const parsed = updateCostBudgetSchema.parse(input); const data: Prisma.CostBudgetUpdateInput = { ...parsed };
	if (parsed.limitAmount !== undefined) data.limitAmount = new Prisma.Decimal(parsed.limitAmount);
	if (session) {
		const claimed = await prisma.costBudget.updateMany({ where: { id, ...teamWhere(session) }, data });
		if (claimed.count === 0) throw new NotFoundError(t("backend.cost.costBudgetNotFound"));
		const row = await prisma.costBudget.findFirst({ where: { id, ...teamWhere(session) } });
		if (!row) throw new NotFoundError(t("backend.cost.costBudgetNotFound")); return budgetToRecord(row);
	}
	return budgetToRecord(await prisma.costBudget.update({ where: { id }, data }));
}
export async function deleteCostBudget(id: string, session?: TeamSession | null): Promise<void> {
	if (session) { const claimed = await prisma.costBudget.deleteMany({ where: { id, ...teamWhere(session) } }); if (claimed.count === 0) throw new NotFoundError(t("backend.cost.costBudgetNotFound")); return; }
	await prisma.costBudget.delete({ where: { id } });
}

export async function checkBudgetAlerts(now = new Date(), session?: TeamSession | null) {
	const budgets = await listCostBudgets(now, session);
	let triggered = 0, notificationsSent = 0, duplicatesSkipped = 0;
	for (const [index, candidate] of budgets.entries()) {
		if (!candidate.enabled || candidate.usageStatus === "within") continue;
		if (!triggered) await ensureBudgetDeliveryTable();
		const release = await acquireAdvisoryLock("cost-budget-alert", `${candidate.id}:${candidate.periodStart}`);
		try {
			const delivery = await prisma.$transaction(async tx => {
				// Serialize customer archival and budget edits with the receipt. The
				// locked budget stays current through the usage read and every page.
				if (candidate.teamId) await tx.$queryRaw`SELECT id FROM teams WHERE id = ${candidate.teamId} FOR SHARE`;
				await tx.$queryRaw`SELECT id FROM cost_budgets WHERE id = ${candidate.id} FOR SHARE`;
				const row = await tx.costBudget.findFirst({ where: { ...budgetScope(session), id: candidate.id } });
				if (!row) return null;
				const usage = await loadBudgetUsage([row], now, tx);
				const budget = await budgetToRecord(row, now, usage.get(row.id));
				budgets[index] = budget;
				if (!budget.enabled || budget.usageStatus === "within") return null;
				const actionUrl = `/cost-summary?budget=${budget.id}&periodStart=${budget.periodStart}`;
				const content = notificationContentData({ notice: { code: "costBudgetAlert", params: {
					budget: budget.name, used: budget.usageAmount, currency: budget.currency,
					percent: budget.usagePercent, threshold: budget.alertThresholdPercent, limit: budget.limitAmount,
				} } });
				const pages = [];
				let recipients = 0;
				let after: string | undefined;
				do {
					const managers: { id: string }[] = await tx.user.findMany({
						where: { status: { not: "DISABLED" }, ...permissionHoldersWhere("cost:manage", budget.teamId),
							...(after ? { id: { gt: after } } : {}) },
						orderBy: { id: "asc" }, select: { id: true }, take: 1000,
					});
					if (!managers.length) break;
					recipients += managers.length;
					const users = await claimBudgetDeliveries(tx, budget.id, budget.periodStart, managers.map(row => row.id));
					if (users.length) {
						// Adopt pre-upgrade deliveries while their inbox rows still exist.
						const legacy = await tx.notification.findMany({ where: { type: "system", actionUrl, userId: { in: users } }, select: { userId: true } });
						const sent = new Set(legacy.map(row => row.userId));
						const data = users.filter(id => !sent.has(id)).map(userId => ({ userId, type: "system", ...content, actionUrl, teamId: budget.teamId ?? null }));
						if (data.length) pages.push(await tx.notification.createManyAndReturn({ data }));
					}
					after = managers.length === 1000 ? managers[managers.length - 1]!.id : undefined;
				} while (after);
				return { pages, recipients };
			}, { timeout: 120_000 });
			if (delivery) {
				triggered++;
				let sent = 0;
				for (const page of delivery.pages) {
					await announceStoredNotifications(page);
					sent += page.length;
				}
				notificationsSent += sent;
				duplicatesSkipped += delivery.recipients - sent;
			}
		} finally {
			await release();
		}
	}
	return { checked: budgets.length, triggered, notificationsSent, duplicatesSkipped, budgets };
}
