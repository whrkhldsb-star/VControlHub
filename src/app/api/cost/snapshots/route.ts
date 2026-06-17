/**
 * TR-031 E01: /api/cost/snapshots — recent daily snapshots for the trend chart.
 *
 * GET ?limit=30  →  { snapshots: DailySnapshot[] }  (cost:read)
 *
 * The list is ordered most-recent-first. Limit is clamped to [1, 365].
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { listRecentSnapshots } from "@/lib/cost/service";
import { z } from "zod";

export const dynamic = "force-dynamic";

const querySchema = z.object({
	limit: z.coerce.number().int().min(1).max(365).optional(),
});

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "cost:read",
			rateLimit: GENERAL_WRITE_LIMIT,
			querySchema,
			errorStatus: 500,
			errorMessage: "加载历史快照失败",
		},
		async ({ query }) => {
			const snapshots = await listRecentSnapshots(query.limit ?? 30);
			return NextResponse.json({ snapshots });
		},
	);
}
