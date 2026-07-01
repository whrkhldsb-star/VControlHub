/**
 * TR-031 E01: Cost tracking — types.
 *
 * CostEntry is the source of truth for cost data (manual input).
 * CostSnapshot is a daily aggregate written by the daily snapshot job
 * (cost.snapshot worker, scheduled 01:00 local).
 */

export const COST_CATEGORY_VALUES = ["vps", "bandwidth", "storage", "other"] as const;
export type CostCategory = (typeof COST_CATEGORY_VALUES)[number];

export const COST_CURRENCY_VALUES = ["CNY", "USD", "EUR", "JPY", "HKD"] as const;
export type CostCurrency = (typeof COST_CURRENCY_VALUES)[number];

/** Parsed row from prisma.costEntry.findMany — Amount is Decimal, returned as string. */
export interface CostEntryRecord {
	id: string;
	category: CostCategory;
	provider: string;
	amount: string; // decimal string (avoid float drift)
	currency: CostCurrency;
	effectiveDate: string; // ISO date YYYY-MM-DD
	notes: string | null;
	createdById: string | null;
	sourceType: string | null;
	sourceRef: string | null;
	createdAt: string; // ISO timestamp
	updatedAt: string; // ISO timestamp
}

export interface CostSnapshotRecord {
	id: string;
	snapshotDate: string; // ISO date YYYY-MM-DD
	totalAmount: string; // decimal string
	byCategory: Record<CostCategory, string>; // { vps: "10.00", bandwidth: "5.00", ... }
	entryCount: number;
	createdAt: string; // ISO timestamp
}

/** Per-category totals for a date range (monthly summary aggregation). */
export interface CostSummary {
	month: string; // YYYY-MM
	currency: CostCurrency;
	totalAmount: string;
	byCategory: Record<CostCategory, string>;
	entryCount: number;
	/** First day of month ISO date used as range start. */
	rangeStart: string;
	/** Last day of month ISO date used as range end (inclusive). */
	rangeEnd: string;
}

export interface DailySnapshot {
	snapshotDate: string; // YYYY-MM-DD
	totalAmount: string;
	byCategory: Record<CostCategory, string>;
	entryCount: number;
}
