/**
 * TR-032 E02: /api/ai/ops/logs — list AI ops scan logs.
 *
 * GET ?mode=recommendation|autonomous&status=ok|warning|...&triggerType=manual|...&limit=20&offset=0
 *   → { logs: AiOpsLogRecord[], total: number, hasMore: boolean }
 *   Permission: ai:ops:read
 *
 * `limit` is clamped to [1, 200] (matches the service-layer cap).
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { countAiOpsLogs, listAiOpsLogs } from "@/lib/ai/ops/service";
import { aiOpsLogsQuerySchema } from "@/lib/ai/schema";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ai:ops:read",
			rateLimit: GENERAL_READ_LIMIT,
			querySchema: aiOpsLogsQuerySchema,
			errorStatus: 500,
			errorMessage: "Failed to load AI ops records",
		},
		async ({ query }) => {
			const requestedLimit = query.limit ?? 20;
			const filters = {
				mode: query.mode,
				status: query.status,
				triggerType: query.triggerType,
			};
			const offset = query.offset ?? 0;
			const [logs, total] = await Promise.all([
				listAiOpsLogs({ ...filters, limit: requestedLimit, offset }),
				countAiOpsLogs(filters),
			]);
			return NextResponse.json({
				logs,
				total,
				hasMore: offset + logs.length < total,
			});
		},
	);
}
