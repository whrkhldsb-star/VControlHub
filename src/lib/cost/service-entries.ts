import { Prisma } from "@prisma/client";
import { serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { createCostEntrySchema, updateCostEntrySchema } from "./schema";
import type { CostCategory, CostCurrency, CostCurrencyBucket, CostEntryRecord, CostSummary, DailySnapshot } from "./types";
import { COST_CATEGORY_VALUES } from "./types";
import { DEFAULT_CURRENCY, DEFAULT_LIST_LIMIT, addDecimal, automaticTags, emptyByCategory, endOfMonthUtc, isoDateOnly, lastDayIsoOfMonth, startOfMonthUtc, toRecord, type TeamSession } from "./service-internals";

export async function createCostEntry(input: unknown, createdById?: string | null, session?: TeamSession | null): Promise<CostEntryRecord> {
	const parsed = createCostEntrySchema.parse(input);
	const teamId = session ? teamCreateData(session).teamId : null;
	const entry = await prisma.costEntry.create({ data: {
		category: parsed.category, provider: parsed.provider, amount: new Prisma.Decimal(parsed.amount),
		currency: parsed.currency ?? DEFAULT_CURRENCY, effectiveDate: new Date(`${parsed.effectiveDate}T00:00:00Z`),
		notes: parsed.notes ?? null, sourceType: "manual", sourceRef: null,
		tags: automaticTags("manual", parsed.category, parsed.provider), createdById: createdById ?? null, teamId: teamId ?? null,
	} });
	return toRecord(entry);
}

export async function updateCostEntry(id: string, input: unknown, session?: TeamSession | null): Promise<CostEntryRecord> {
	const parsed = updateCostEntrySchema.parse(input);
	const teamFilter = session ? teamWhere(session) : {};
	const current = session ? await prisma.costEntry.findFirst({ where: { id, ...teamFilter } }) : await prisma.costEntry.findUnique({ where: { id } });
	if (!current) throw new NotFoundError(t("backend.cost.costEntryNotFound"));
	const data: Prisma.CostEntryUpdateInput = {};
	if (parsed.category !== undefined) data.category = parsed.category;
	if (parsed.provider !== undefined) data.provider = parsed.provider;
	if (parsed.amount !== undefined) data.amount = new Prisma.Decimal(parsed.amount);
	if (parsed.currency !== undefined) data.currency = parsed.currency;
	if (parsed.effectiveDate !== undefined) data.effectiveDate = new Date(`${parsed.effectiveDate}T00:00:00Z`);
	if (parsed.notes !== undefined) data.notes = parsed.notes;
	if (parsed.category !== undefined || parsed.provider !== undefined) data.tags = automaticTags(current.sourceType ?? "manual", (parsed.category ?? current.category) as CostCategory, parsed.provider ?? current.provider, current.sourceRef);
	if (session) {
		const claimed = await prisma.costEntry.updateMany({ where: { id, ...teamFilter }, data });
		if (claimed.count === 0) throw new NotFoundError(t("backend.cost.costEntryNotFound"));
		const entry = await prisma.costEntry.findFirst({ where: { id, ...teamFilter } });
		if (!entry) throw new NotFoundError(t("backend.cost.costEntryNotFound"));
		return toRecord(entry);
	}
	return toRecord(await prisma.costEntry.update({ where: { id }, data }));
}

export async function deleteCostEntry(id: string, session?: TeamSession | null): Promise<void> {
	if (session) {
		const claimed = await prisma.costEntry.deleteMany({ where: { id, ...teamWhere(session) } });
		if (claimed.count === 0) throw new NotFoundError(t("backend.cost.costEntryNotFound"));
		return;
	}
	await prisma.costEntry.delete({ where: { id } });
}

export async function getCostEntry(id: string, session?: TeamSession | null): Promise<CostEntryRecord | null> {
	const entry = session ? await prisma.costEntry.findFirst({ where: { id, ...teamWhere(session) } }) : await prisma.costEntry.findUnique({ where: { id } });
	return entry ? toRecord(entry) : null;
}

export interface ListCostEntriesOptions { month?: string; category?: CostCategory; limit?: number; session?: TeamSession | null; }
export async function listCostEntries(options: ListCostEntriesOptions = {}): Promise<CostEntryRecord[]> {
	const where: Prisma.CostEntryWhereInput = { ...(options.session ? teamWhere(options.session) : {}) };
	if (options.category) where.category = options.category;
	if (options.month) where.effectiveDate = { gte: startOfMonthUtc(options.month), lt: endOfMonthUtc(options.month) };
	return (await prisma.costEntry.findMany({ where, orderBy: { effectiveDate: "desc" }, take: options.limit ?? DEFAULT_LIST_LIMIT })).map(toRecord);
}

export async function summarizeMonth(month: string, currency: CostCurrency = DEFAULT_CURRENCY, session?: TeamSession | null): Promise<CostSummary> {
	const start = startOfMonthUtc(month); const end = endOfMonthUtc(month);
	const monthWhere: Prisma.CostEntryWhereInput = { effectiveDate: { gte: start, lt: end }, ...(session ? teamWhere(session) : {}) };
	const rows = await prisma.costEntry.groupBy({
		by: ["category"],
		where: { ...monthWhere, currency },
		_sum: { amount: true },
		_count: { _all: true },
	});
	const byCategory = emptyByCategory(); let total = 0; let count = 0;
	for (const row of rows) {
		const category = (COST_CATEGORY_VALUES as readonly string[]).includes(row.category) ? row.category as CostCategory : "other";
		const amount = row._sum.amount?.toString() ?? "0"; addDecimal(byCategory, category, amount); total += Number.isFinite(Number(amount)) ? Number(amount) : 0; count += row._count._all;
	}
	// Same month, every OTHER currency. Without an FX source we must not add
	// these into `total`, but hiding them makes the headline figure look like
	// the full monthly spend when it is not. Surface them so the UI can warn.
	const otherRows = await prisma.costEntry.groupBy({
		by: ["currency"],
		where: { ...monthWhere, currency: { not: currency } },
		_sum: { amount: true },
		_count: { _all: true },
	});
	const otherCurrencies: CostCurrencyBucket[] = otherRows
		.map((row) => ({
			currency: row.currency as CostCurrency,
			totalAmount: (Number(row._sum.amount?.toString() ?? "0") || 0).toFixed(2),
			entryCount: row._count._all,
		}))
		.sort((a, b) => a.currency.localeCompare(b.currency));
	return { month, currency, totalAmount: total.toFixed(2), byCategory, entryCount: count, rangeStart: isoDateOnly(start), rangeEnd: lastDayIsoOfMonth(month), otherCurrencies };
}

/**
 * Daily cost trend.
 *
 * With a session the trend is recomputed from `cost_entries` inside the
 * caller's tenant scope. WITHOUT a session it falls back to the
 * `cost_snapshots` table, whose rows are written by the snapshot worker as a
 * PLATFORM-WIDE aggregate (every tenant's spend in one row, see
 * `snapshot-worker.ts`). That branch therefore exists only for platform-level
 * reporting and must never back a tenant-facing surface — always pass the
 * session from a request.
 */
export async function listRecentSnapshots(limit = 30, session?: TeamSession | null, currency: CostCurrency = DEFAULT_CURRENCY, month?: string): Promise<DailySnapshot[]> {
	if (session) {
		const days = Math.max(1, Math.min(limit, 365));
		// When a month is selected the trend must cover THAT month, otherwise the
		// chart keeps showing "last N days" while the summary/entries below it
		// show a historical month — the numbers silently disagree.
		const dateFilter = month
			? { gte: startOfMonthUtc(month), lt: endOfMonthUtc(month) }
			: { gte: new Date(Date.now() - days * 86400000) };
		const rows = await prisma.costEntry.groupBy({
			by: ["effectiveDate", "category"],
			where: { ...teamWhere(session), currency, effectiveDate: dateFilter },
			_sum: { amount: true },
			_count: { _all: true },
			orderBy: { effectiveDate: "desc" },
		});
		const byDay = new Map<string, { total: number; byCategory: Record<string, string>; count: number }>();
		for (const row of rows) {
			const day = isoDateOnly(row.effectiveDate); const bucket = byDay.get(day) ?? { total: 0, byCategory: emptyByCategory(), count: 0 }; byDay.set(day, bucket);
			const category = (COST_CATEGORY_VALUES as readonly string[]).includes(row.category) ? row.category as CostCategory : "other";
			const amount = row._sum.amount?.toString() ?? "0";
			addDecimal(bucket.byCategory, category, amount); bucket.total += Number(amount); bucket.count += row._count._all;
		}
		// A month can hold 31 days, so a `limit` of 30 must not silently drop the
		// earliest day when an explicit month was requested.
		const maxDays = month ? 31 : days;
		return Array.from(byDay.entries()).sort((a,b) => b[0].localeCompare(a[0])).slice(0,maxDays).map(([snapshotDate,b]) => ({ snapshotDate, totalAmount: b.total.toFixed(2), byCategory: b.byCategory, entryCount: b.count }));
	}
	const rows = await prisma.costSnapshot.findMany({ orderBy: { snapshotDate: "desc" }, take: Math.max(1, Math.min(limit, 365)) });
	return rows.map((row) => {
		const source = (row.byCategory ?? {}) as Record<string, unknown>; const byCategory = emptyByCategory();
		for (const category of COST_CATEGORY_VALUES) if (typeof source[category] === "string") byCategory[category] = source[category] as string;
		return { snapshotDate: isoDateOnly(row.snapshotDate), totalAmount: row.totalAmount.toFixed(2), byCategory, entryCount: row.entryCount };
	});
}

export interface ServerMonthlyCostSyncSkip { serverId: string; serverName: string; reason: "missing_amount" | "non_positive_amount" | "missing_currency"; }
/**
 * Counts only. The synced entries themselves are deliberately NOT returned: this
 * walks the whole fleet in pages of 1000, and neither caller (the HTTP route,
 * which ships its result to the browser, nor the snapshot worker, which records
 * the counts on the job) ever read them — so materialising one record per server
 * was pure payload and heap weight proportional to fleet size.
 */
export interface ServerMonthlyCostSyncResult { month: string; synced: number; skipped: number; skippedDetails: ServerMonthlyCostSyncSkip[]; }
export async function syncServerMonthlyCosts(month = new Date().toISOString().slice(0, 7), session?: TeamSession | null): Promise<ServerMonthlyCostSyncResult> {
	const effectiveDate = startOfMonthUtc(month);
	let synced = 0; let skipped = 0; let cursor: { id: string } | undefined;
	// Skipping silently is a false success: the toast says "synced N, skipped M"
	// and the user has no way to learn WHICH server needs fixing.
	const skippedDetails: ServerMonthlyCostSyncSkip[] = [];
	do {
		const servers = await prisma.server.findMany({ where: { enabled: true, costAutoSync: true, costMonthlyAmount: { not: null }, ...(session ? serverTeamWhere(session) : {}) }, select: { id: true, name: true, host: true, costMonthlyAmount: true, costCurrency: true, costProvider: true, teamId: true }, orderBy: { id: "asc" }, take: 1000, ...(cursor ? { cursor, skip: 1 } : {}) });
		for (const server of servers) {
			const amount = server.costMonthlyAmount?.toFixed(2);
			const reason: ServerMonthlyCostSyncSkip["reason"] | null =
				!amount ? "missing_amount"
				: Number(amount) <= 0 ? "non_positive_amount"
				: !server.costCurrency?.trim() ? "missing_currency"
				: null;
			if (reason || !amount) {
				skipped += 1;
				// Cap the detail list so a fleet-wide misconfiguration cannot blow up
				// the response payload; the counter stays accurate either way.
				if (skippedDetails.length < 50) skippedDetails.push({ serverId: server.id, serverName: server.name, reason: reason ?? "missing_amount" });
				continue;
			}
		const provider = server.costProvider?.trim() || server.name; const tags = automaticTags("server_monthly", "vps", provider, server.id);
		const notes = `Auto-collected: ${server.name} (${server.host}) ${month} VPS monthly fee`;
		await prisma.costEntry.upsert({ where: { sourceType_sourceRef_effectiveDate: { sourceType: "server_monthly", sourceRef: server.id, effectiveDate } }, create: { category: "vps", provider, amount: new Prisma.Decimal(amount), currency: server.costCurrency, effectiveDate, notes, sourceType: "server_monthly", sourceRef: server.id, createdById: null, teamId: server.teamId ?? null, tags }, update: { provider, amount: new Prisma.Decimal(amount), currency: server.costCurrency, notes, tags } });
		await prisma.server.update({ where: { id: server.id }, data: { costLastSyncedAt: new Date() } }); synced += 1;
		}
		cursor = servers.length === 1000 ? { id: servers[servers.length - 1]!.id } : undefined;
	} while (cursor);
	return { month, synced, skipped, skippedDetails };
}
