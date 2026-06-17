/**
 * TR-031 E01: /api/cost/summary?month=YYYY-MM[&currency=CNY]
 *
 * Returns the monthly cost summary (total + per-category breakdown +
 * range). Multi-currency entries are NOT silently summed — only rows
 * matching the requested currency count (P-NEW-AK).
 *
 * Permission: cost:read
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { summarizeMonth } from "@/lib/cost/service";
import { costCurrencySchema, costMonthSchema } from "@/lib/cost/schema";
import { z } from "zod";

export const dynamic = "force-dynamic";

const summaryQuerySchema = z.object({
	month: costMonthSchema,
	currency: costCurrencySchema.optional(),
});

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "cost:read",
			rateLimit: GENERAL_WRITE_LIMIT,
			querySchema: summaryQuerySchema,
			errorStatus: 500,
			errorMessage: "加载成本汇总失败",
		},
		async ({ query }) => {
			const summary = await summarizeMonth(query.month, query.currency);
			return NextResponse.json({ summary });
		},
	);
}

