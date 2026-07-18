/**
 * TR-031 E01: Cost tracking — service layer.
 *
 * Source of truth is `cost_entries` (itemized). `cost_snapshots` is a
 * daily aggregate written by the snapshot worker (separate file).
 *
 * Functions exposed:
 *   - createCostEntry / updateCostEntry / deleteCostEntry / getCostEntry
 *   - listCostEntries    (filter by month / category)
 *   - summarizeMonth     (per-category aggregation for a given YYYY-MM)
 *   - listRecentSnapshots (trend chart data)
 *
 * All public functions take plain TS objects (CreateCostEntryInput etc.)
 * — the route layer is responsible for zod parsing. The service returns
 * `CostEntryRecord` / `CostSummary` shapes (decimal-as-string).
 */
import { Prisma } from "@prisma/client";

import type { RoleKey } from "@/lib/auth/rbac";
import { teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { createNotification } from "@/lib/notification/service";

type TeamSession = { userId: string; roles: RoleKey[]; currentTeamId: string | null };


import { createCostBudgetSchema, createCostEntrySchema, updateCostBudgetSchema, updateCostEntrySchema } from "./schema";
import type {
	CostBudgetPeriod,
	CostBudgetRecord,
	CostCategory,
	CostCurrency,
	CostEntryRecord,
	CostSnapshotRecord,
	CostSummary,
	DailySnapshot,
} from "./types";
import { COST_CATEGORY_VALUES } from "./types";

const DEFAULT_CURRENCY: CostCurrency = "CNY";
const DEFAULT_LIST_LIMIT = 100;

function isoDateOnly(d: Date): string {
	// YYYY-MM-DD in UTC — matches @db.Date semantics and how we persist.
	return d.toISOString().slice(0, 10);
}

function monthBoundsUtc(month: string): { start: Date; endExclusive: Date } {
	const parts = month.split("-");
	const y = Number(parts[0]);
	const m = Number(parts[1]);
	if (!Number.isFinite(y) || !Number.isFinite(m) || m < 1 || m > 12) {
		throw new Error(`Invalid month: ${month}`);
	}
	// First instant of the requested month (UTC).
	const start = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
	// First instant of the next month = exclusive upper bound.
	// Date.UTC handles year rollover (month 12 → year+1, month 0).
	const endExclusive = new Date(Date.UTC(y, m, 1, 0, 0, 0, 0));
	return { start, endExclusive };
}

function startOfMonthUtc(month: string): Date {
	return monthBoundsUtc(month).start;
}

function endOfMonthUtc(month: string): Date {
	return monthBoundsUtc(month).endExclusive;
}

function lastDayIsoOfMonth(month: string): string {
	const { start, endExclusive } = monthBoundsUtc(month);
	// Last inclusive day = exclusive start of next month minus 1 ms.
	const last = new Date(endExclusive.getTime() - 1);
	void start;
	return isoDateOnly(last);
}

function toRecord(entry: {
	id: string;
	category: string;
	provider: string;
	amount: Prisma.Decimal;
	currency: string;
	effectiveDate: Date;
	notes: string | null;
	createdById: string | null;
	sourceType: string | null;
	sourceRef: string | null;
	tags: string[];
	teamId?: string | null;
	createdAt: Date;
	updatedAt: Date;
}): CostEntryRecord {
	return {
		id: entry.id,
		category: entry.category as CostCategory,
		provider: entry.provider,
		amount: entry.amount.toFixed(2),
		currency: (entry.currency as CostCurrency) ?? DEFAULT_CURRENCY,
		effectiveDate: isoDateOnly(entry.effectiveDate),
		notes: entry.notes,
		createdById: entry.createdById,
		sourceType: entry.sourceType,
		sourceRef: entry.sourceRef,
		tags: entry.tags,
		teamId: entry.teamId ?? null,
		createdAt: entry.createdAt.toISOString(),
		updatedAt: entry.updatedAt.toISOString(),
	};
}

function tagValue(value: string): string {
	return value.trim().toLocaleLowerCase().replace(/\s+/gu, "-").slice(0, 128);
}

function automaticTags(sourceType: string, category: CostCategory, provider: string, sourceRef?: string | null): string[] {
	return [
		`source:${tagValue(sourceType)}`,
		`category:${category}`,
		`provider:${tagValue(provider)}`,
		...(sourceRef ? [`server:${tagValue(sourceRef)}`] : []),
	];
}

function toSnapshot(snap: {
	id: string;
	snapshotDate: Date;
	totalAmount: Prisma.Decimal;
	byCategory: Prisma.JsonValue;
	entryCount: number;
	createdAt: Date;
}): CostSnapshotRecord {
	const by = (snap.byCategory ?? {}) as Record<string, unknown>;
	const byCategory = Object.fromEntries(
		COST_CATEGORY_VALUES.map((c) => [c, typeof by[c] === "string" ? (by[c] as string) : "0.00"]),
	) as Record<CostCategory, string>;
	return {
		id: snap.id,
		snapshotDate: isoDateOnly(snap.snapshotDate),
		totalAmount: snap.totalAmount.toFixed(2),
		byCategory,
		entryCount: snap.entryCount,
		createdAt: snap.createdAt.toISOString(),
	};
}

function emptyByCategory(): Record<CostCategory, string> {
	return Object.fromEntries(COST_CATEGORY_VALUES.map((c) => [c, "0.00"])) as Record<
		CostCategory,
		string
	>;
}

function addDecimal(target: Record<CostCategory, string>, cat: CostCategory, amount: string) {
	const cur = Number(target[cat] ?? "0");
	const inc = Number(amount);
	const next = (Number.isFinite(cur) ? cur : 0) + (Number.isFinite(inc) ? inc : 0);
	target[cat] = next.toFixed(2);
}

/* ── CRUD ─────────────────────────────────────────────────── */

export async function createCostEntry(
	input: unknown,
	createdById?: string | null,
	session?: TeamSession | null,
): Promise<CostEntryRecord> {
	const parsed = createCostEntrySchema.parse(input);
	const teamId = session ? teamCreateData(session).teamId : null;
	const entry = await prisma.costEntry.create({
		data: {
			category: parsed.category,
			provider: parsed.provider,
			amount: new Prisma.Decimal(parsed.amount),
			currency: parsed.currency ?? DEFAULT_CURRENCY,
			effectiveDate: new Date(`${parsed.effectiveDate}T00:00:00Z`),
			notes: parsed.notes ?? null,
			sourceType: "manual",
			sourceRef: null,
			tags: automaticTags("manual", parsed.category, parsed.provider),
			createdById: createdById ?? null,
			teamId: teamId ?? null,
		},
	});
	return toRecord(entry);
}

export async function updateCostEntry(
	id: string,
	input: unknown,
	session?: TeamSession | null,
): Promise<CostEntryRecord> {
	const parsed = updateCostEntrySchema.parse(input);
	const teamFilter = session ? teamWhere(session) : {};
	const current = session
		? await prisma.costEntry.findFirst({ where: { id, ...teamFilter } })
		: await prisma.costEntry.findUnique({ where: { id } });
	if (!current) throw new NotFoundError("Cost entry not found");
	const data: Prisma.CostEntryUpdateInput = {};
	if (parsed.category !== undefined) data.category = parsed.category;
	if (parsed.provider !== undefined) data.provider = parsed.provider;
	if (parsed.amount !== undefined) data.amount = new Prisma.Decimal(parsed.amount);
	if (parsed.currency !== undefined) data.currency = parsed.currency;
	if (parsed.effectiveDate !== undefined) {
		data.effectiveDate = new Date(`${parsed.effectiveDate}T00:00:00Z`);
	}
	if (parsed.notes !== undefined) data.notes = parsed.notes;
	if (parsed.category !== undefined || parsed.provider !== undefined) {
		data.tags = automaticTags(
			current.sourceType ?? "manual",
			(parsed.category ?? current.category) as CostCategory,
			parsed.provider ?? current.provider,
			current.sourceRef,
		);
	}
	if (session) {
		const claimed = await prisma.costEntry.updateMany({ where: { id, ...teamFilter }, data });
		if (claimed.count === 0) throw new NotFoundError("Cost entry not found");
		const entry = await prisma.costEntry.findFirst({ where: { id, ...teamFilter } });
		if (!entry) throw new NotFoundError("Cost entry not found");
		return toRecord(entry);
	}
	const entry = await prisma.costEntry.update({ where: { id }, data });
	return toRecord(entry);
}

export async function deleteCostEntry(id: string, session?: TeamSession | null): Promise<void> {
	if (session) {
		const claimed = await prisma.costEntry.deleteMany({ where: { id, ...teamWhere(session) } });
		if (claimed.count === 0) throw new NotFoundError("Cost entry not found");
		return;
	}
	await prisma.costEntry.delete({ where: { id } });
}

export async function getCostEntry(id: string, session?: TeamSession | null): Promise<CostEntryRecord | null> {
	const entry = session
		? await prisma.costEntry.findFirst({ where: { id, ...teamWhere(session) } })
		: await prisma.costEntry.findUnique({ where: { id } });
	return entry ? toRecord(entry) : null;
}

export interface ListCostEntriesOptions {
	month?: string;
	category?: CostCategory;
	limit?: number;
	session?: TeamSession | null;
}

export async function listCostEntries(
	options: ListCostEntriesOptions = {},
): Promise<CostEntryRecord[]> {
	const where: Prisma.CostEntryWhereInput = {
		...(options.session ? teamWhere(options.session) : {}),
	};
	if (options.category) where.category = options.category;
	if (options.month) {
		where.effectiveDate = {
			gte: startOfMonthUtc(options.month),
			lt: endOfMonthUtc(options.month),
		};
	}
	const rows = await prisma.costEntry.findMany({
		where,
		orderBy: { effectiveDate: "desc" },
		take: options.limit ?? DEFAULT_LIST_LIMIT,
	});
	return rows.map(toRecord);
}

/* ── Aggregation ──────────────────────────────────────────── */

export async function summarizeMonth(
	month: string,
	currency: CostCurrency = DEFAULT_CURRENCY,
	session?: TeamSession | null,
): Promise<CostSummary> {
	const start = startOfMonthUtc(month);
	const end = endOfMonthUtc(month);
	const rows = await prisma.costEntry.findMany({
		where: {
			effectiveDate: { gte: start, lt: end },
			...(session ? teamWhere(session) : {}),
		},
		select: { category: true, amount: true, currency: true },
		take: 10000, // P2: 单期间 cost entry 数,1w 作 hard 上界
	});

	const byCategory = emptyByCategory();
	let total = 0;
	let count = 0;
	for (const r of rows) {
		// We only count entries in the requested currency — mixed currencies
		// are not summed (avoids silently inflating CNY totals with USD).
		if (r.currency !== currency) continue;
		const cat = (COST_CATEGORY_VALUES as readonly string[]).includes(r.category)
			? (r.category as CostCategory)
			: "other";
		const amt = r.amount.toString();
		addDecimal(byCategory, cat, amt);
		total += Number.isFinite(Number(amt)) ? Number(amt) : 0;
		count += 1;
	}

	return {
		month,
		currency,
		totalAmount: total.toFixed(2),
		byCategory,
		entryCount: count,
		rangeStart: isoDateOnly(start),
		rangeEnd: lastDayIsoOfMonth(month),
	};
}

export async function listRecentSnapshots(
	limit = 30,
	session?: TeamSession | null,
): Promise<DailySnapshot[]> {
	// When a session is provided, derive snapshots from team-scoped cost entries
	// instead of reading the global CostSnapshot table (which aggregates ALL
	// teams). This prevents cross-tenant cost visibility.
	if (session) {
		const today = new Date();
		const days = Math.max(1, Math.min(limit, 365));
		const rows = await prisma.costEntry.findMany({
			where: {
				...teamWhere(session),
				effectiveDate: {
					gte: new Date(today.getTime() - days * 24 * 60 * 60 * 1000),
				},
			},
			select: { effectiveDate: true, category: true, amount: true, currency: true },
			take: 10000,
		});
		const byDay = new Map<string, { total: number; byCategory: Record<string, string>; count: number }>();
		for (const r of rows) {
			if (r.currency !== DEFAULT_CURRENCY) continue;
			const dayKey = isoDateOnly(r.effectiveDate);
			let bucket = byDay.get(dayKey);
			if (!bucket) {
				bucket = { total: 0, byCategory: emptyByCategory(), count: 0 };
				byDay.set(dayKey, bucket);
			}
			const cat = (COST_CATEGORY_VALUES as readonly string[]).includes(r.category)
				? (r.category as CostCategory)
				: "other";
			addDecimal(bucket.byCategory, cat, r.amount.toString());
			bucket.total += Number.isFinite(Number(r.amount)) ? Number(r.amount) : 0;
			bucket.count += 1;
		}
		return Array.from(byDay.entries())
			.sort((a, b) => b[0].localeCompare(a[0]))
			.slice(0, days)
			.map(([date, b]) => ({
				snapshotDate: date,
				totalAmount: b.total.toFixed(2),
				byCategory: b.byCategory,
				entryCount: b.count,
			}));
	}
	// No session (admin/system): read the global snapshot table as before.
	const rows = await prisma.costSnapshot.findMany({
		orderBy: { snapshotDate: "desc" },
		take: Math.max(1, Math.min(limit, 365)),
	});
	return rows.map((r) => {
		const by = (r.byCategory ?? {}) as Record<string, unknown>;
		const byCategory = emptyByCategory();
		for (const c of COST_CATEGORY_VALUES) {
			if (typeof by[c] === "string") byCategory[c] = by[c] as string;
		}
		return {
			snapshotDate: isoDateOnly(r.snapshotDate),
			totalAmount: r.totalAmount.toFixed(2),
			byCategory,
			entryCount: r.entryCount,
		};
	});
}

function currentMonthUtc(): string {
	return new Date().toISOString().slice(0, 7);
}

export interface ServerMonthlyCostSyncResult {
	month: string;
	synced: number;
	skipped: number;
	entries: CostEntryRecord[];
}

export async function syncServerMonthlyCosts(
	month = currentMonthUtc(),
): Promise<ServerMonthlyCostSyncResult> {
	const effectiveDate = startOfMonthUtc(month);
	const servers = await prisma.server.findMany({
		where: {
			enabled: true,
			costAutoSync: true,
			costMonthlyAmount: { not: null },
		},
		select: {
			id: true,
			name: true,
			host: true,
			costMonthlyAmount: true,
			costCurrency: true,
			costProvider: true,
			teamId: true,
		},
		take: 1000,
	});

	const entries: CostEntryRecord[] = [];
	let skipped = 0;
	for (const server of servers) {
		const amount = server.costMonthlyAmount?.toFixed(2);
		if (!amount || Number(amount) <= 0) {
			skipped += 1;
			continue;
		}
		const provider = server.costProvider?.trim() || server.name;
		const entry = await prisma.costEntry.upsert({
			where: {
				sourceType_sourceRef_effectiveDate: {
					sourceType: "server_monthly",
					sourceRef: server.id,
					effectiveDate,
				},
			},
			create: {
				category: "vps",
				provider,
				amount: new Prisma.Decimal(amount),
				currency: server.costCurrency,
				effectiveDate,
				notes: `Auto-collected: ${server.name} (${server.host}) ${month} VPS monthly fee`,
				sourceType: "server_monthly",
				sourceRef: server.id,
				createdById: null,
				teamId: server.teamId ?? null,
				tags: automaticTags("server_monthly", "vps", provider, server.id),
			},
			update: {
				provider,
				amount: new Prisma.Decimal(amount),
				currency: server.costCurrency,
				notes: `Auto-collected: ${server.name} (${server.host}) ${month} VPS monthly fee`,
				teamId: server.teamId ?? null,
				tags: automaticTags("server_monthly", "vps", provider, server.id),
			},
		});
		await prisma.server.update({
			where: { id: server.id },
			data: { costLastSyncedAt: new Date() },
		});
		entries.push(toRecord(entry));
	}

	return { month, synced: entries.length, skipped, entries };
}

/* ── Budgets ─────────────────────────────────────────────── */

type BudgetRow = {
	id: string;
	category: string;
	name: string;
	limitAmount: Prisma.Decimal;
	currency: string;
	period: string;
	alertThresholdPercent: number;
	enabled: boolean;
	createdAt: Date;
	updatedAt: Date;
};

export function getBudgetPeriodRange(period: CostBudgetPeriod, now = new Date()): { start: Date; endExclusive: Date } {
	const year = now.getUTCFullYear();
	const month = now.getUTCMonth();
	if (period === "monthly") {
		return { start: new Date(Date.UTC(year, month, 1)), endExclusive: new Date(Date.UTC(year, month + 1, 1)) };
	}
	if (period === "quarterly") {
		const quarterStart = Math.floor(month / 3) * 3;
		return { start: new Date(Date.UTC(year, quarterStart, 1)), endExclusive: new Date(Date.UTC(year, quarterStart + 3, 1)) };
	}
	return { start: new Date(Date.UTC(year, 0, 1)), endExclusive: new Date(Date.UTC(year + 1, 0, 1)) };
}

async function budgetToRecord(
	row: BudgetRow & { teamId?: string | null },
	now = new Date(),
	session?: TeamSession | null,
): Promise<CostBudgetRecord> {
	const range = getBudgetPeriodRange(row.period as CostBudgetPeriod, now);
	const aggregate = await prisma.costEntry.aggregate({
		where: {
			category: row.category,
			currency: row.currency,
			effectiveDate: { gte: range.start, lt: range.endExclusive },
			...(session ? teamWhere(session) : row.teamId ? { teamId: row.teamId } : {}),
		},
		_sum: { amount: true },
	});
	const usageAmount = aggregate._sum.amount?.toFixed(2) ?? "0.00";
	const limitAmount = row.limitAmount.toFixed(2);
	return {
		id: row.id,
		category: row.category as CostCategory,
		name: row.name,
		limitAmount,
		currency: row.currency as CostCurrency,
		period: row.period as CostBudgetPeriod,
		alertThresholdPercent: row.alertThresholdPercent,
		enabled: row.enabled,
		usageAmount,
		usagePercent: Number(((Number(usageAmount) / Number(limitAmount)) * 100).toFixed(1)),
		periodStart: isoDateOnly(range.start),
		periodEnd: isoDateOnly(new Date(range.endExclusive.getTime() - 1)),
		teamId: row.teamId ?? null,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
	};
}

export async function createCostBudget(input: unknown, session?: TeamSession | null): Promise<CostBudgetRecord> {
	const parsed = createCostBudgetSchema.parse(input);
	const teamId = session ? teamCreateData(session).teamId : null;
	const row = await prisma.costBudget.create({
		data: {
			category: parsed.category,
			name: parsed.name,
			limitAmount: new Prisma.Decimal(parsed.limitAmount),
			currency: parsed.currency ?? DEFAULT_CURRENCY,
			period: parsed.period ?? "monthly",
			alertThresholdPercent: parsed.alertThresholdPercent ?? 80,
			enabled: parsed.enabled ?? true,
			teamId: teamId ?? null,
		},
	});
	return budgetToRecord(row, new Date(), session);
}

export async function listCostBudgets(now = new Date(), session?: TeamSession | null): Promise<CostBudgetRecord[]> {
	const rows = await prisma.costBudget.findMany({
		where: session ? teamWhere(session) : {},
		orderBy: { createdAt: "desc" },
	});
	return Promise.all(rows.map((row) => budgetToRecord(row, now, session)));
}

export async function getCostBudget(id: string, now = new Date(), session?: TeamSession | null): Promise<CostBudgetRecord | null> {
	const row = session
		? await prisma.costBudget.findFirst({ where: { id, ...teamWhere(session) } })
		: await prisma.costBudget.findUnique({ where: { id } });
	return row ? budgetToRecord(row, now, session) : null;
}

export async function updateCostBudget(id: string, input: unknown, session?: TeamSession | null): Promise<CostBudgetRecord> {
	const parsed = updateCostBudgetSchema.parse(input);
	const data: Prisma.CostBudgetUpdateInput = { ...parsed };
	if (parsed.limitAmount !== undefined) data.limitAmount = new Prisma.Decimal(parsed.limitAmount);
	if (session) {
		const claimed = await prisma.costBudget.updateMany({ where: { id, ...teamWhere(session) }, data });
		if (claimed.count === 0) throw new NotFoundError("Cost budget not found");
		const row = await prisma.costBudget.findFirst({ where: { id, ...teamWhere(session) } });
		if (!row) throw new NotFoundError("Cost budget not found");
		return budgetToRecord(row, new Date(), session);
	}
	const row = await prisma.costBudget.update({ where: { id }, data });
	return budgetToRecord(row, new Date(), session);
}

export async function deleteCostBudget(id: string, session?: TeamSession | null): Promise<void> {
	if (session) {
		const claimed = await prisma.costBudget.deleteMany({ where: { id, ...teamWhere(session) } });
		if (claimed.count === 0) throw new NotFoundError("Cost budget not found");
		return;
	}
	await prisma.costBudget.delete({ where: { id } });
}

/**
 * Recipients for a budget alert: users with cost:manage.
 * When the budget is team-scoped, only members of that team (or team:manage
 * admins) receive the notice — never every global cost:manage user.
 */
async function listCostBudgetAlertManagers(budgetTeamId: string | null | undefined) {
	return prisma.user.findMany({
		where: {
			roles: { some: { role: { permissions: { some: { permission: { key: "cost:manage" } } } } } },
			...(budgetTeamId
				? {
						OR: [
							{ teamMemberships: { some: { teamId: budgetTeamId } } },
							{
								roles: {
									some: {
										role: { permissions: { some: { permission: { key: "team:manage" } } } },
									},
								},
							},
						],
					}
				: {}),
		},
		select: { id: true },
		take: 1000,
	});
}

export async function checkBudgetAlerts(now = new Date(), session?: TeamSession | null) {
	const budgets = await listCostBudgets(now, session);
	let triggered = 0;
	let notificationsSent = 0;
	let duplicatesSkipped = 0;
	for (const budget of budgets) {
		if (!budget.enabled || budget.usagePercent < budget.alertThresholdPercent) continue;
		triggered += 1;
		const actionUrl = `/cost-summary?budget=${budget.id}&periodStart=${budget.periodStart}`;
		// Resolve recipients per budget so team A alerts never fan out to team B managers.
		const managers = await listCostBudgetAlertManagers(budget.teamId);
		for (const manager of managers) {
			const duplicate = await prisma.notification.findFirst({
				where: { userId: manager.id, type: "system", actionUrl },
			});
			if (duplicate) {
				duplicatesSkipped += 1;
				continue;
			}
			await createNotification({
				userId: manager.id,
				type: "system",
				title: `Cost budget alert: ${budget.name}`,
				message: `${budget.usageAmount} ${budget.currency} used (${budget.usagePercent}%), threshold ${budget.alertThresholdPercent}% of ${budget.limitAmount} ${budget.currency}.`,
				actionUrl,
				teamId: budget.teamId ?? null,
			});
			notificationsSent += 1;
		}
	}
	return { checked: budgets.length, triggered, notificationsSent, duplicatesSkipped, budgets };
}

/* ── Snapshot writer (called by daily snapshot worker) ─────── */

export interface SnapshotWriteInput {
	snapshotDate: Date;
	totalAmount: string;
	byCategory: Record<CostCategory, string>;
	entryCount: number;
}

export async function upsertDailySnapshot(input: SnapshotWriteInput): Promise<CostSnapshotRecord> {
	const snap = await prisma.costSnapshot.upsert({
		where: { snapshotDate: input.snapshotDate },
		create: {
			snapshotDate: input.snapshotDate,
			totalAmount: new Prisma.Decimal(input.totalAmount),
			byCategory: input.byCategory as unknown as Prisma.InputJsonValue,
			entryCount: input.entryCount,
		},
		update: {
			totalAmount: new Prisma.Decimal(input.totalAmount),
			byCategory: input.byCategory as unknown as Prisma.InputJsonValue,
			entryCount: input.entryCount,
		},
	});
	return toSnapshot(snap);
}

export { toRecord as costEntryToRecord, toSnapshot as costSnapshotToRecord };
