import { Prisma } from "@prisma/client";
import { serverTeamWhere, teamCreateData, teamWhere } from "@/lib/auth/team-scope";
import { prisma } from "@/lib/db";
import { NotFoundError } from "@/lib/errors";
import { t } from "@/lib/i18n/translations";
import { createCostEntrySchema, updateCostEntrySchema } from "./schema";
import type { CostCategory, CostCurrency, CostEntryRecord, CostSummary, DailySnapshot } from "./types";
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
	const rows = await prisma.costEntry.findMany({ where: { effectiveDate: { gte: start, lt: end }, ...(session ? teamWhere(session) : {}) }, select: { category: true, amount: true, currency: true }, take: 10000 });
	const byCategory = emptyByCategory(); let total = 0; let count = 0;
	for (const row of rows) {
		if (row.currency !== currency) continue;
		const category = (COST_CATEGORY_VALUES as readonly string[]).includes(row.category) ? row.category as CostCategory : "other";
		const amount = row.amount.toString(); addDecimal(byCategory, category, amount); total += Number.isFinite(Number(amount)) ? Number(amount) : 0; count += 1;
	}
	return { month, currency, totalAmount: total.toFixed(2), byCategory, entryCount: count, rangeStart: isoDateOnly(start), rangeEnd: lastDayIsoOfMonth(month) };
}

export async function listRecentSnapshots(limit = 30, session?: TeamSession | null, currency: CostCurrency = DEFAULT_CURRENCY): Promise<DailySnapshot[]> {
	if (session) {
		const days = Math.max(1, Math.min(limit, 365));
		const rows = await prisma.costEntry.findMany({ where: { ...teamWhere(session), effectiveDate: { gte: new Date(Date.now() - days * 86400000) } }, select: { effectiveDate: true, category: true, amount: true, currency: true }, take: 10000 });
		const byDay = new Map<string, { total: number; byCategory: Record<string, string>; count: number }>();
		for (const row of rows) {
			if (row.currency !== currency) continue;
			const day = isoDateOnly(row.effectiveDate); const bucket = byDay.get(day) ?? { total: 0, byCategory: emptyByCategory(), count: 0 }; byDay.set(day, bucket);
			const category = (COST_CATEGORY_VALUES as readonly string[]).includes(row.category) ? row.category as CostCategory : "other";
			addDecimal(bucket.byCategory, category, row.amount.toString()); bucket.total += Number(row.amount); bucket.count += 1;
		}
		return Array.from(byDay.entries()).sort((a,b) => b[0].localeCompare(a[0])).slice(0,days).map(([snapshotDate,b]) => ({ snapshotDate, totalAmount: b.total.toFixed(2), byCategory: b.byCategory, entryCount: b.count }));
	}
	const rows = await prisma.costSnapshot.findMany({ orderBy: { snapshotDate: "desc" }, take: Math.max(1, Math.min(limit, 365)) });
	return rows.map((row) => {
		const source = (row.byCategory ?? {}) as Record<string, unknown>; const byCategory = emptyByCategory();
		for (const category of COST_CATEGORY_VALUES) if (typeof source[category] === "string") byCategory[category] = source[category] as string;
		return { snapshotDate: isoDateOnly(row.snapshotDate), totalAmount: row.totalAmount.toFixed(2), byCategory, entryCount: row.entryCount };
	});
}

export interface ServerMonthlyCostSyncResult { month: string; synced: number; skipped: number; entries: CostEntryRecord[]; }
export async function syncServerMonthlyCosts(month = new Date().toISOString().slice(0, 7), session?: TeamSession | null): Promise<ServerMonthlyCostSyncResult> {
	const effectiveDate = startOfMonthUtc(month);
	const servers = await prisma.server.findMany({ where: { enabled: true, costAutoSync: true, costMonthlyAmount: { not: null }, ...(session ? serverTeamWhere(session) : {}) }, select: { id: true, name: true, host: true, costMonthlyAmount: true, costCurrency: true, costProvider: true, teamId: true }, take: 1000 });
	const entries: CostEntryRecord[] = []; let skipped = 0;
	for (const server of servers) {
		const amount = server.costMonthlyAmount?.toFixed(2); if (!amount || Number(amount) <= 0) { skipped += 1; continue; }
		const provider = server.costProvider?.trim() || server.name; const tags = automaticTags("server_monthly", "vps", provider, server.id);
		const notes = `Auto-collected: ${server.name} (${server.host}) ${month} VPS monthly fee`;
		const entry = await prisma.costEntry.upsert({ where: { sourceType_sourceRef_effectiveDate: { sourceType: "server_monthly", sourceRef: server.id, effectiveDate } }, create: { category: "vps", provider, amount: new Prisma.Decimal(amount), currency: server.costCurrency, effectiveDate, notes, sourceType: "server_monthly", sourceRef: server.id, createdById: null, teamId: server.teamId ?? null, tags }, update: { provider, amount: new Prisma.Decimal(amount), currency: server.costCurrency, notes, teamId: server.teamId ?? null, tags } });
		await prisma.server.update({ where: { id: server.id }, data: { costLastSyncedAt: new Date() } }); entries.push(toRecord(entry));
	}
	return { month, synced: entries.length, skipped, entries };
}
