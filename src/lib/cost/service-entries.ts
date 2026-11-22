import { Prisma } from "@prisma/client";
import { liveCustomerRowsWhere, serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { currentCopyLocale } from "@/lib/i18n/api-copy";
import { costMessage } from "./messages";
import { prisma } from "@/lib/db";
import { ConflictError, NotFoundError, ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { costAmountSchema, createCostEntrySchema, updateCostEntrySchema } from "./schema";
import type { CostCategory, CostCurrency, CostCurrencyBucket, CostEntryRecord, CostSummary, DailySnapshot } from "./types";
import { COST_CATEGORY_VALUES, isSourceManagedCost } from "./types";
import { CostDecimal, DEFAULT_CURRENCY, DEFAULT_LIST_LIMIT, addDecimal, automaticTags, emptyByCategory, endOfMonthUtc, isoDateOnly, lastDayIsoOfMonth, startOfMonthUtc, toRecord, toSnapshot, type TeamSession } from "./service-internals";
import { appTimeZoneDateKey } from "@/lib/datetime/time-zone";

export async function createCostEntry(input: unknown, createdById?: string | null, session?: TeamSession | null): Promise<CostEntryRecord> {
	const parsed = createCostEntrySchema.parse(input);
	const teamId = session ? teamCreateData(session).teamId : null;
	const data: Prisma.CostEntryUncheckedCreateInput = {
		category: parsed.category, provider: parsed.provider, amount: new Prisma.Decimal(parsed.amount),
		currency: parsed.currency ?? DEFAULT_CURRENCY, effectiveDate: new Date(`${parsed.effectiveDate}T00:00:00Z`),
		notes: parsed.notes ?? null, sourceType: "manual", sourceRef: null,
		tags: automaticTags("manual", parsed.category, parsed.provider), createdById: createdById ?? null, teamId: teamId ?? null,
	};
	if (!parsed.adjustmentForId) return toRecord(await prisma.costEntry.create({ data }));
	const sourceId = parsed.adjustmentForId;
	return prisma.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT id FROM cost_entries WHERE id = ${sourceId} FOR UPDATE`;
		const source = await tx.costEntry.findFirst({
			where: { id: sourceId, ...(session ? teamWhere(session) : {}), sourceType: { in: ["server_monthly", "cloud_billing"] } },
			select: { teamId: true },
		});
		if (!source) throw new NotFoundError(t("backend.cost.costEntryNotFound"));
		return toRecord(await tx.costEntry.create({ data: {
			...data, teamId: source.teamId, tags: [...automaticTags("manual", parsed.category, parsed.provider), `adjustment-for:${sourceId}`],
		} }));
	});
}

export async function updateCostEntry(id: string, input: unknown, session?: TeamSession | null): Promise<CostEntryRecord> {
	const parsed = updateCostEntrySchema.parse(input);
	const teamFilter = session ? teamWhere(session) : {};
	return prisma.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT id FROM cost_entries WHERE id = ${id} FOR UPDATE`;
		const current = await tx.costEntry.findFirst({ where: { id, ...teamFilter } });
		if (!current) throw new NotFoundError(t("backend.cost.costEntryNotFound"));
		const data: Prisma.CostEntryUpdateInput = {};
		if (parsed.category !== undefined) data.category = parsed.category;
		if (parsed.provider !== undefined) data.provider = parsed.provider;
		if (parsed.amount !== undefined) {
			if (!current.tags.some(tag => tag.startsWith("adjustment-for:"))) costAmountSchema.parse(parsed.amount);
			data.amount = new Prisma.Decimal(parsed.amount);
		}
		if (parsed.currency !== undefined) data.currency = parsed.currency;
		if (parsed.effectiveDate !== undefined && parsed.effectiveDate !== isoDateOnly(current.effectiveDate)) {
			if (isSourceManagedCost(current.sourceType)) throw new ValidationError(costMessage("sourceDate", currentCopyLocale()));
			data.effectiveDate = new Date(`${parsed.effectiveDate}T00:00:00Z`);
		}
		if (parsed.notes !== undefined) data.notes = parsed.notes;
		if (parsed.category !== undefined || parsed.provider !== undefined) {
			const labels = automaticTags(current.sourceType ?? "manual", (parsed.category ?? current.category) as CostCategory,
				parsed.provider ?? current.provider, current.sourceType === "server_monthly" ? current.sourceRef : null);
			data.tags = [...new Set([...labels, ...current.tags.filter(tag => !/^(source|category|provider):/.test(tag))])];
		}
		return toRecord(await tx.costEntry.update({ where: { id, ...teamFilter }, data }));
	});
}

export async function deleteCostEntry(id: string, session?: TeamSession | null): Promise<void> {
	await prisma.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT id FROM cost_entries WHERE id = ${id} FOR UPDATE`;
		const where = { id, ...(session ? teamWhere(session) : {}) };
		const source = await tx.costEntry.findFirst({ where, select: { id: true } });
		if (!source) throw new NotFoundError(t("backend.cost.costEntryNotFound"));
		if (await tx.costEntry.count({ where: { tags: { has: `adjustment-for:${id}` } } })) {
			throw new ConflictError(costMessage("linkedAdjustments", currentCopyLocale()));
		}
		await tx.costEntry.delete({ where });
	});
}

/** Called inside a server ownership transfer (after locking the server). */
export async function transferMonthlyCost(tx: Prisma.TransactionClient, serverId: string, month: string, teamId: string) {
	const start = startOfMonthUtc(month);
	const sources = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM cost_entries WHERE "sourceType" = 'server_monthly'
		AND "sourceRef" = ${serverId} AND "effectiveDate" = ${start} FOR UPDATE`;
	if (!sources.length) return;
	const id = sources[0]!.id;
	await tx.costEntry.updateMany({ where: { OR: [{ id }, { tags: { has: `adjustment-for:${id}` },
		effectiveDate: { gte: start, lt: endOfMonthUtc(month) } }] }, data: { teamId } });
}

export async function getCostEntry(id: string, session?: TeamSession | null): Promise<CostEntryRecord | null> {
	const entry = session ? await prisma.costEntry.findFirst({ where: { id, ...teamWhere(session) } }) : await prisma.costEntry.findUnique({ where: { id } });
	return entry ? toRecord(entry) : null;
}

export interface ListCostEntriesOptions { month?: string; category?: CostCategory; limit?: number; session?: TeamSession | null; }
function entriesWhere(options: ListCostEntriesOptions) {
	const where: Prisma.CostEntryWhereInput = { ...(options.session ? teamWhere(options.session) : {}) };
	if (options.category) where.category = options.category;
	if (options.month) where.effectiveDate = { gte: startOfMonthUtc(options.month), lt: endOfMonthUtc(options.month) };
	return where;
}

const entryOrder = [{ effectiveDate: "desc" }, { id: "desc" }] satisfies Prisma.CostEntryOrderByWithRelationInput[];

export async function listCostEntries(options: ListCostEntriesOptions = {}): Promise<CostEntryRecord[]> {
	return (await prisma.costEntry.findMany({ where: entriesWhere(options), orderBy: entryOrder, take: options.limit ?? DEFAULT_LIST_LIMIT })).map(toRecord);
}

export async function listCostEntryPage(options: ListCostEntriesOptions & { page?: number }) {
	const pageSize = options.limit ?? DEFAULT_LIST_LIMIT;
	const where = entriesWhere(options);
	return prisma.$transaction(async tx => {
		const total = await tx.costEntry.count({ where });
		const page = Math.max(1, Math.min(options.page ?? 1, Math.ceil(total / pageSize)));
		const rows = await tx.costEntry.findMany({ where, orderBy: entryOrder, take: pageSize, skip: (page - 1) * pageSize });
		return { entries: rows.map(toRecord), total, page, pageSize };
	}, { isolationLevel: "RepeatableRead" });
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
	const byCategory = emptyByCategory(); let total = new CostDecimal(0); let count = 0;
	for (const row of rows) {
		const category = (COST_CATEGORY_VALUES as readonly string[]).includes(row.category) ? row.category as CostCategory : "other";
		const amount = row._sum.amount?.toString() ?? "0"; addDecimal(byCategory, category, amount); total = total.plus(amount); count += row._count._all;
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
			totalAmount: new CostDecimal(row._sum.amount?.toString() ?? "0").toFixed(2),
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
	const today = new Date(appTimeZoneDateKey());
	if (session) {
		const days = Math.max(1, Math.min(limit, 365));
		// When a month is selected the trend must cover THAT month, otherwise the
		// chart keeps showing "last N days" while the summary/entries below it
		// show a historical month — the numbers silently disagree.
		const dateFilter = month
			? { gte: startOfMonthUtc(month), lt: endOfMonthUtc(month) }
			: { gte: new Date(today.getTime() - (days - 1) * 86400000), lte: today };
		const rows = await prisma.costEntry.groupBy({
			by: ["effectiveDate", "category"],
			where: { ...teamWhere(session), currency, effectiveDate: dateFilter },
			_sum: { amount: true },
			_count: { _all: true },
			orderBy: { effectiveDate: "desc" },
		});
		const byDay = new Map<string, { total: Prisma.Decimal; byCategory: Record<string, string>; count: number }>();
		for (const row of rows) {
			const day = isoDateOnly(row.effectiveDate); const bucket = byDay.get(day) ?? { total: new CostDecimal(0), byCategory: emptyByCategory(), count: 0 }; byDay.set(day, bucket);
			const category = (COST_CATEGORY_VALUES as readonly string[]).includes(row.category) ? row.category as CostCategory : "other";
			const amount = row._sum.amount?.toString() ?? "0";
			addDecimal(bucket.byCategory, category, amount); bucket.total = bucket.total.plus(amount); bucket.count += row._count._all;
		}
		// A month can hold 31 days, so a `limit` of 30 must not silently drop the
		// earliest day when an explicit month was requested.
		const maxDays = month ? 31 : days;
		return Array.from(byDay.entries()).sort((a,b) => b[0].localeCompare(a[0])).slice(0,maxDays).map(([snapshotDate,b]) => ({ snapshotDate, totalAmount: b.total.toFixed(2), byCategory: b.byCategory, entryCount: b.count }));
	}
	const rows = await prisma.costSnapshot.findMany({ where: { snapshotDate: { lte: today } }, orderBy: { snapshotDate: "desc" }, take: Math.max(1, Math.min(limit, 365)) });
	return rows.map(row => {
		const { snapshotDate, totalAmount, byCategory, entryCount } = toSnapshot(row);
		return { snapshotDate, totalAmount, byCategory, entryCount };
	});
}

export interface ServerMonthlyCostSyncSkip {
	serverId: string; serverName: string;
	reason: "missing_amount" | "non_positive_amount" | "missing_currency" | "ownership_changed" | "unverified_history" | "already_recorded";
}
/**
 * Counts only. The synced entries themselves are deliberately NOT returned: this
 * walks the whole fleet in pages of 1000, and neither caller (the HTTP route,
 * which ships its result to the browser, nor the snapshot worker, which records
 * the counts on the job) ever read them — so materialising one record per server
 * was pure payload and heap weight proportional to fleet size.
 */
export interface ServerMonthlyCostSyncResult { month: string; synced: number; skipped: number; skippedDetails: ServerMonthlyCostSyncSkip[]; }
// The month turns at midnight application time, as budgets do (not at 08:00 UTC+8).
export async function syncServerMonthlyCosts(month = appTimeZoneDateKey().slice(0, 7), session?: TeamSession | null): Promise<ServerMonthlyCostSyncResult> {
	const effectiveDate = startOfMonthUtc(month);
	const monthEnd = lastDayIsoOfMonth(month);
	let synced = 0; let skipped = 0; let cursor: { id: string } | undefined;
	// Skipping silently is a false success: the toast says "synced N, skipped M"
	// and the user has no way to learn WHICH server needs fixing.
	const skippedDetails: ServerMonthlyCostSyncSkip[] = [];
	do {
		const scope = session ? serverTeamWhere(session) : liveCustomerRowsWhere();
		const eligible = { ...scope, enabled: true, costAutoSync: true };
		const servers = await prisma.server.findMany({ where: eligible, select: { id: true, name: true, teamId: true },
			orderBy: { id: "asc" }, take: 1000, ...(cursor ? { cursor, skip: 1 } : {}) });
		for (const candidate of servers) {
			const skipReason = await prisma.$transaction(async (tx): Promise<ServerMonthlyCostSyncSkip["reason"] | null> => {
				const teamId = candidate.teamId ?? null;
				const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM servers WHERE id = ${candidate.id} AND "teamId" IS NOT DISTINCT FROM ${teamId} FOR NO KEY UPDATE`;
				if (!locked.length) return "ownership_changed";
				const server = await tx.server.findFirst({
					where: { AND: [eligible, { id: candidate.id, teamId }] },
					select: { name: true, host: true, costMonthlyAmount: true, costCurrency: true, costProvider: true, createdAt: true, updatedAt: true },
				});
				if (!server) return "ownership_changed";
				const amount = server.costMonthlyAmount?.toFixed(2);
				if (!amount) return "missing_amount";
				if (Number(amount) <= 0) return "non_positive_amount";
				if (!server.costCurrency?.trim()) return "missing_currency";
				const provider = server.costProvider?.trim() || server.name;
				const fields = { provider, amount: new Prisma.Decimal(amount), currency: server.costCurrency,
					notes: t("backend.cost.serverMonthlyNote", { server: server.name, host: server.host, month }),
					tags: automaticTags("server_monthly", "vps", provider, candidate.id) };
				const source = { sourceType: "server_monthly", sourceRef: candidate.id, effectiveDate };
				const where = { sourceType_sourceRef_effectiveDate: source };
				const currentMonth = appTimeZoneDateKey().slice(0, 7);
				const historical = month < currentMonth;
				if (month !== currentMonth) {
					const existing = await tx.costEntry.findUnique({ where, select: { teamId: true } });
					if (existing && existing.teamId !== teamId) return "ownership_changed";
					if (historical && existing) return "already_recorded";
				}
				// The server has no rate/owner history. Its current values are evidence
				// for a closed month only if this version already existed at month end.
				if (historical && (appTimeZoneDateKey(server.createdAt) > monthEnd || appTimeZoneDateKey(server.updatedAt) > monthEnd)) {
					return "unverified_history";
				}
				// Preserve the billing version for subsequent closed-month backfills.
				await tx.server.updateMany({
					where: { id: candidate.id, teamId },
					data: { costLastSyncedAt: new Date(), updatedAt: server.updatedAt },
				});
				const create = { ...source, ...fields, teamId, category: "vps", createdById: null };
				if (historical) {
					const inserted = await tx.costEntry.createMany({ data: create, skipDuplicates: true });
					return inserted.count ? null : "already_recorded";
				}
				await tx.costEntry.upsert({ where, create, update: { ...fields, teamId } });
				return null;
			});
			if (!skipReason) synced += 1;
			else {
				skipped += 1;
				if (skippedDetails.length < 50) skippedDetails.push({ serverId: candidate.id, serverName: candidate.name, reason: skipReason });
			}
		}
		cursor = servers.length === 1000 ? { id: servers[servers.length - 1]!.id } : undefined;
	} while (cursor);
	return { month, synced, skipped, skippedDetails };
}
