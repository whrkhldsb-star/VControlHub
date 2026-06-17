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
	.regex(/^\d{4}-\d{2}-\d{2}$/u, "日期必须是 YYYY-MM-DD 格式")
	.refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), {
		message: "日期不是合法日期",
	});

/** Decimal-as-string. Allow up to 12 integer + 2 decimal digits (matches schema). */
export const costAmountSchema = z
	.string()
	.regex(/^\d+(\.\d{1,2})?$/u, "金额必须是数字, 最多 2 位小数")
	.refine(
		(s) => {
			const num = Number(s);
			return Number.isFinite(num) && num >= 0 && num < 1e12;
		},
		{ message: "金额必须在 0 到 1e12 之间" },
	);

export const createCostEntrySchema = z.object({
	category: costCategorySchema,
	provider: z.string().trim().min(1, "服务提供方不能为空").max(128),
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
	.refine((v) => Object.keys(v).length > 0, { message: "至少需要提供一个字段" });

/** YYYY-MM month string. Validates the month component 01-12. */
export const costMonthSchema = z
	.string()
	.regex(/^\d{4}-\d{2}$/u, "month 必须是 YYYY-MM 格式")
	.refine(
		(s) => {
			const parts = s.split("-");
			const y = Number(parts[0]);
			const m = Number(parts[1]);
			return Number.isFinite(y) && Number.isFinite(m) && m >= 1 && m <= 12;
		},
		{ message: "month 不是合法月份" },
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
