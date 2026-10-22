import { z } from "zod";
import { isCalendarDate } from "./calendar-date";
import { COST_BUDGET_PERIOD_VALUES, COST_CATEGORY_VALUES, COST_CURRENCY_VALUES } from "./types";

export const costCategorySchema = z.enum(COST_CATEGORY_VALUES);
export const costCurrencySchema = z.enum(COST_CURRENCY_VALUES);
export const costBudgetPeriodSchema = z.enum(COST_BUDGET_PERIOD_VALUES);

export const costDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/u, "Date must be in YYYY-MM-DD format").refine(
	isCalendarDate,
	{ message: "Date is not a valid date" },
);

// The amount and limit columns are Decimal(12,2): 9,999,999,999.99 at most.
// Allowing up to 1e12 passed validation and then failed in the database.
export const costAmountSchema = z.string().regex(/^\d+(\.\d{1,2})?$/u, "Amount must be a number with at most 2 decimal places").refine(
	(s) => { const num = Number(s); return Number.isFinite(num) && num >= 0 && num <= 9_999_999_999.99; },
	{ message: "Amount must be between 0 and 9999999999.99" },
);

export const createCostEntrySchema = z.object({
	category: costCategorySchema,
	provider: z.string().trim().min(1, "Service provider is required").max(128),
	amount: costAmountSchema,
	currency: costCurrencySchema.optional(),
	effectiveDate: costDateSchema,
	notes: z.string().trim().max(500).optional().nullable(),
});

export const updateCostEntrySchema = createCostEntrySchema.partial().strict().refine(
	(v) => Object.keys(v).length > 0,
	{ message: "At least one field must be provided" },
);

export const createCostBudgetSchema = z.object({
	category: costCategorySchema,
	name: z.string().trim().min(1).max(128),
	limitAmount: costAmountSchema.refine((value) => Number(value) > 0, "Budget limit must be greater than zero"),
	currency: costCurrencySchema.optional(),
	period: costBudgetPeriodSchema.optional(),
	alertThresholdPercent: z.number().min(1).max(100).optional(),
	enabled: z.boolean().optional(),
});

export const updateCostBudgetSchema = createCostBudgetSchema.partial().strict().refine(
	(v) => Object.keys(v).length > 0,
	{ message: "At least one field must be provided" },
);

export const costMonthSchema = z.string().regex(/^\d{4}-\d{2}$/u, "month must be in YYYY-MM format").refine(
	(s) => { const parts = s.split("-"); const year = Number(parts[0]); const month = Number(parts[1]); return Number.isFinite(year) && Number.isFinite(month) && month >= 1 && month <= 12; },
	{ message: "month is not a valid month" },
);

export const costQuerySchema = z.object({
	month: costMonthSchema.optional(),
	category: costCategorySchema.optional(),
	limit: z.coerce.number().int().min(1).max(500).optional(),
});

