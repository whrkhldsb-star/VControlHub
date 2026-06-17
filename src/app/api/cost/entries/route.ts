/**
 * TR-031 E01: /api/cost/entries — list / create cost entries.
 *
 * GET  ?month=YYYY-MM&category=vps&limit=500
 *   → { entries: CostEntryRecord[] }
 *   Permission: cost:read
 *
 * POST { category, provider, amount, currency?, effectiveDate, notes? }
 *   → { entry: CostEntryRecord }
 *   Permission: cost:manage
 *
 * Validation is delegated to the zod schemas in `src/lib/cost/schema.ts`
 * via `withApiRoute({ bodySchema, querySchema })`. The service layer
 * returns decimal-as-string amounts (P-NEW-AK) so we never ship a
 * `number` over the wire for money.
 */
import { NextResponse } from "next/server";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import {
	createCostEntry,
	listCostEntries,
} from "@/lib/cost/service";
import {
	costQuerySchema,
	createCostEntrySchema,
} from "@/lib/cost/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "cost:read",
			rateLimit: GENERAL_WRITE_LIMIT,
			querySchema: costQuerySchema,
			errorStatus: 500,
			errorMessage: "加载成本条目失败",
		},
		async ({ query }) => {
			const entries = await listCostEntries({
				month: query.month,
				category: query.category,
				limit: query.limit,
			});
			return NextResponse.json({ entries });
		},
	);
}

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "cost:manage",
			rateLimit: GENERAL_WRITE_LIMIT,
			bodySchema: createCostEntrySchema,
			errorStatus: 400,
			errorMessage: "创建成本条目失败",
		},
		async ({ session, body }) => {
			const createdById = session?.userId ?? null;
			const entry = await createCostEntry(body, createdById);
			auditUserAction(createdById ?? "anonymous", "cost.create", {
				entryId: entry.id,
				category: entry.category,
				provider: entry.provider,
				amount: entry.amount,
				currency: entry.currency,
			});
			return NextResponse.json({ entry });
		},
	);
}
