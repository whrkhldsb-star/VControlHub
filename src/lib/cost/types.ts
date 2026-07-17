/** Cost tracking shared types. */

export const COST_CATEGORY_VALUES = ["vps", "bandwidth", "storage", "other"] as const;
export type CostCategory = (typeof COST_CATEGORY_VALUES)[number];

export const COST_CURRENCY_VALUES = ["CNY", "USD", "EUR", "JPY", "HKD"] as const;
export type CostCurrency = (typeof COST_CURRENCY_VALUES)[number];

export const COST_BUDGET_PERIOD_VALUES = ["monthly", "quarterly", "yearly"] as const;
export type CostBudgetPeriod = (typeof COST_BUDGET_PERIOD_VALUES)[number];

export interface CostEntryRecord {
	id: string;
	category: CostCategory;
	provider: string;
	amount: string;
	currency: CostCurrency;
	effectiveDate: string;
	notes: string | null;
	createdById: string | null;
	sourceType: string | null;
	sourceRef: string | null;
	tags: string[];
	teamId?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CostBudgetRecord {
	id: string;
	category: CostCategory;
	name: string;
	limitAmount: string;
	currency: CostCurrency;
	period: CostBudgetPeriod;
	alertThresholdPercent: number;
	enabled: boolean;
	usageAmount: string;
	usagePercent: number;
	periodStart: string;
	periodEnd: string;
	teamId?: string | null;
	createdAt: string;
	updatedAt: string;
}

export interface CostSnapshotRecord {
	id: string;
	snapshotDate: string;
	totalAmount: string;
	byCategory: Record<CostCategory, string>;
	entryCount: number;
	createdAt: string;
}

export interface CostSummary {
	month: string;
	currency: CostCurrency;
	totalAmount: string;
	byCategory: Record<CostCategory, string>;
	entryCount: number;
	rangeStart: string;
	rangeEnd: string;
}

export interface DailySnapshot {
	snapshotDate: string;
	totalAmount: string;
	byCategory: Record<CostCategory, string>;
	entryCount: number;
}
