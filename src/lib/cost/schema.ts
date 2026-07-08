/**
 * TR-031 E01: Cost tracking — zod schemas.
 *
 * Validation lives here (not in the route handler) so the service layer
 * can re-use the same shape for any direct programmatic call (e.g. the
 * daily snapshot worker ingesting a list).
 */
import { z } from "zod";

import { COST_CATEGORY_VALUES, COST_CURRENCY_VALUES } from "./types";

export const costCategorySchema = z.enum(COST_CATEGORY_VALUES);
export const costCurrencySchema = z.enum(COST_CURRENCY_VALUES);

/** YYYY-MM-DD date string. Empty / partial strings are rejected. */
export const costDateSchema = z
	.string()
	.regex(/^\d{4}-\d{2}-\d{2}$/u, "Date must be in YYYY-MM-DD format")
	.refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), {
		message: "Date is not a valid date",
	});

/** Decimal-as-string. Allow up to 12 integer + 2 decimal digits (matches schema). */
export const costAmountSchema = z
	.string()
	.regex(/^\d+(\.\d{1,2})?$/u, "Amount must be a number with at most 2 decimal places")
	.refine(
		(s) => {
			const num = Number(s);
			return Number.isFinite(num) && num >= 0 && num < 1e12;
		},
		{ message: "Amount must be between 0 and 1e12" },
	);

export const createCostEntrySchema = z.object({
	category: costCategorySchema,
	provider: z.string().trim().min(1, "Service provider is required").max(128),
	amount: costAmountSchema,
	currency: costCurrencySchema.optional(),
	effectiveDate: costDateSchema,
	notes: z.string().trim().max(500).optional().nullable(),
});

export const updateCostEntrySchema = z
	.object({
		category: costCategorySchema.optional(),
		provider: z.string().trim().min(1).max(128).optional(),
		amount: costAmountSchema.optional(),
		currency: costCurrencySchema.optional(),
		effectiveDate: costDateSchema.optional(),
		notes: z.string().trim().max(500).optional().nullable(),
	})
	.strict()
	.refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided" });

/** YYYY-MM month string. Validates the month component 01-12. */
export const costMonthSchema = z
	.string()
	.regex(/^\d{4}-\d{2}$/u, "month must be in YYYY-MM format")
	.refine(
		(s) => {
			const parts = s.split("-");
			const y = Number(parts[0]);
			const m = Number(parts[1]);
			return Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12;
		},
		{ message: "month is not a valid month" },
	);

/** Query string for /api/cost/entries?month=YYYY-MM&category=vps */
export const costQuerySchema = z.object({
	month: costMonthSchema.optional(),
	category: costCategorySchema.optional(),
	limit: z.coerce.number().int().min(1).max(500).optional(),
});

export type CreateCostEntryInput = z.infer<typeof createCostEntrySchema>;
export type UpdateCostEntryInput = z.infer<typeof updateCostEntrySchema>;
export type CostQueryInput = z.infer<typeof costQuerySchema>;
