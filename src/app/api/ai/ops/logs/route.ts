/**
 * TR-032 E02: /api/ai/ops/logs — list AI ops scan logs.
 *
 * GET ?mode=recommendation|autonomous&status=ok|warning|...&triggerType=manual|...&limit=50
 *   → { logs: AiOpsLogRecord[] }
 *   Permission: ai:ops:read
 *
 * `limit` is clamped to [1, 200] (matches the service-layer cap).
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { listAiOpsLogs } from "@/lib/ai/ops/service";
import {
	aiOpsModeSchema,
	aiOpsStatusSchema,
	aiOpsTriggerSchema,
} from "@/lib/ai/ops/schema";
import { z } from "zod";

export const dynamic = "force-dynamic";

const querySchema = z.object({
	mode: aiOpsModeSchema.optional(),
	status: aiOpsStatusSchema.optional(),
	triggerType: aiOpsTriggerSchema.optional(),
	limit: z.coerce.number().int().min(1).max(200).optional(),
});

export async function GET(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "ai:ops:read",
			rateLimit: GENERAL_WRITE_LIMIT,
			querySchema,
			errorStatus: 500,
			errorMessage: "Failed to load AI ops records",
		},
		async ({ query }) => {
			const logs = await listAiOpsLogs({
				mode: query.mode,
				status: query.status,
				triggerType: query.triggerType,
				limit: query.limit,
			});
			return NextResponse.json({ logs });
		},
	);
}
