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

import { prisma } from "@/lib/db";

import { createCostEntrySchema, updateCostEntrySchema } from "./schema";
import type {
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
		createdAt: entry.createdAt.toISOString(),
		updatedAt: entry.updatedAt.toISOString(),
	};
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
): Promise<CostEntryRecord> {
	const parsed = createCostEntrySchema.parse(input);
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
			createdById: createdById ?? null,
		},
	});
	return toRecord(entry);
}

export async function updateCostEntry(
	id: string,
	input: unknown,
): Promise<CostEntryRecord> {
	const parsed = updateCostEntrySchema.parse(input);
	const data: Prisma.CostEntryUpdateInput = {};
	if (parsed.category !== undefined) data.category = parsed.category;
	if (parsed.provider !== undefined) data.provider = parsed.provider;
	if (parsed.amount !== undefined) data.amount = new Prisma.Decimal(parsed.amount);
	if (parsed.currency !== undefined) data.currency = parsed.currency;
	if (parsed.effectiveDate !== undefined) {
		data.effectiveDate = new Date(`${parsed.effectiveDate}T00:00:00Z`);
	}
	if (parsed.notes !== undefined) data.notes = parsed.notes;
	const entry = await prisma.costEntry.update({ where: { id }, data });
	return toRecord(entry);
}

export async function deleteCostEntry(id: string): Promise<void> {
	await prisma.costEntry.delete({ where: { id } });
}

export async function getCostEntry(id: string): Promise<CostEntryRecord | null> {
	const entry = await prisma.costEntry.findUnique({ where: { id } });
	return entry ? toRecord(entry) : null;
}

export interface ListCostEntriesOptions {
	month?: string;
	category?: CostCategory;
	limit?: number;
}

export async function listCostEntries(
	options: ListCostEntriesOptions = {},
): Promise<CostEntryRecord[]> {
	const where: Prisma.CostEntryWhereInput = {};
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
): Promise<CostSummary> {
	const start = startOfMonthUtc(month);
	const end = endOfMonthUtc(month);
	const rows = await prisma.costEntry.findMany({
		where: { effectiveDate: { gte: start, lt: end } },
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

export async function listRecentSnapshots(limit = 30): Promise<DailySnapshot[]> {
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
				notes: `自动采集：${server.name} (${server.host}) ${month} VPS 月费`,
				sourceType: "server_monthly",
				sourceRef: server.id,
				createdById: null,
			},
			update: {
				provider,
				amount: new Prisma.Decimal(amount),
				currency: server.costCurrency,
				notes: `自动采集：${server.name} (${server.host}) ${month} VPS 月费`,
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
